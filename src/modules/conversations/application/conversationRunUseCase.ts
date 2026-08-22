import {
  CHAT_REQUEST_SCHEMA,
  createAssistantRunId,
  createContextSnapshotId,
  err,
  ok,
  resolveGenerationParameterSources,
  type AssistantRunId,
  type ChatRequest,
  type Result,
} from '@/core'
import type { AssistantRun, ContextSnapshot } from '@/modules/assistant-runtime'
import {
  appendProviderContext,
  type AssembledContext,
  type ContextCitation,
} from '@/modules/knowledge'
import type {
  ConversationRunErrorCode,
  ConversationRunPreparedRequest,
  ConversationRunProjection,
  ConversationRunUseCase,
  ConversationRunUseCaseDependencies,
  StartConversationRunInput,
} from '../contracts'
import type { ConversationSnapshot } from '../domain/conversationSnapshot'

export function createConversationRunUseCase(
  dependencies: ConversationRunUseCaseDependencies,
): ConversationRunUseCase {
  return {
    start(input) {
      const runId = input.runId ?? createAssistantRunId(dependencies.ids)
      return {
        runId,
        completion: runConversation(dependencies, { ...input, runId }),
      }
    },

    async cancel(runId) {
      return dependencies.assistantRuntime.cancel(runId)
    },

    async resumeModelOperation(input) {
      let session
      try {
        session = await dependencies.createModelOperationSession?.()
      } catch (error) {
        return err(
          'provider_failed',
          error instanceof Error ? error.message : 'The model operation catalog could not be restored.',
          { retryable: true },
        )
      }
      if (!session) {
        return err('provider_failed', 'The model operation catalog is unavailable.', { retryable: true })
      }
      return dependencies.assistantRuntime.resumeModelOperation({
        runId: input.runId,
        approved: input.approved,
        session,
        ...(input.cancellationSignal ? { cancellationSignal: input.cancellationSignal } : {}),
        ...(dependencies.providerGatewayOptions ? { providerGatewayOptions: dependencies.providerGatewayOptions } : {}),
        onPersisted: async ({ run, journalEntry }) => {
          await project(input.projection, { conversationId: run.conversationId, run, journalEntry })
        },
      })
    },

    async recoverInterruptedRuns(projection) {
      const recovery = await dependencies.assistantRuntime.recoverInterruptedRuns()
      if (!recovery.ok) return recovery
      for (const run of recovery.value) {
        await project(projection, { conversationId: run.conversationId, run })
      }
      return recovery
    },
  }
}

async function runConversation(
  dependencies: ConversationRunUseCaseDependencies,
  input: StartConversationRunInput & { runId: AssistantRunId },
): Promise<Result<AssistantRun, ConversationRunErrorCode>> {
  let conversation: ConversationSnapshot | undefined
  try {
    conversation = await dependencies.conversations.get(input.conversationId)
  } catch {
    return err('conversation_load_failed', 'The persisted conversation could not be loaded.', { retryable: true })
  }
  if (!conversation) {
    return err('conversation_not_found', 'The persisted conversation does not exist.', { retryable: false })
  }

  const latestUserMessage = [...conversation.messages].reverse().find((message) => message.role === 'user')
  let context: ContextSnapshot = {
    schema: 'islemind.context-snapshot.v1' as const,
    id: createContextSnapshotId(dependencies.ids),
    createdAt: dependencies.clock.now(),
    conversationMessageIds: conversation.messages.map((message) => message.id),
    memoryIds: [],
    knowledgeSourceIds: [],
    attachmentIds: [],
    approvedToolContextIds: [],
  }
  let systemPrompt = conversation.systemPrompt
  let contextCitations: readonly ContextCitation[] = []
  let assembledContext: AssembledContext | undefined

  if (dependencies.contextSnapshotAssembler) {
    let assembled: Awaited<ReturnType<NonNullable<ConversationRunUseCaseDependencies['contextSnapshotAssembler']>['assemble']>>
    try {
      assembled = await dependencies.contextSnapshotAssembler.assemble({
        conversationId: conversation.id,
        conversationMessageIds: context.conversationMessageIds,
        ...(latestUserMessage ? { requestMessageId: latestUserMessage.id, requestText: latestUserMessage.text } : { requestText: '' }),
        ...(input.cancellationSignal ? { cancellationSignal: input.cancellationSignal } : {}),
      })
    } catch (error) {
      if (input.cancellationSignal?.aborted || isAbortError(error)) {
        return err('cancelled', 'Context assembly was cancelled.', { retryable: true })
      }
      return err(
        'context_assembly_failed',
        error instanceof Error ? error.message : 'The conversation context could not be assembled.',
        { retryable: true },
      )
    }
    if (!assembled.ok) {
      if (assembled.error.code === 'cancelled') {
        return err('cancelled', assembled.error.message, { retryable: assembled.error.retryable })
      }
      return err('context_assembly_failed', assembled.error.message, { retryable: assembled.error.retryable })
    }
    context = assembled.value.snapshot
    assembledContext = assembled.value
    systemPrompt = appendProviderContext(systemPrompt, assembled.value.providerContext)
    contextCitations = assembled.value.citations
  }

  let request: ChatRequest = {
    schema: CHAT_REQUEST_SCHEMA,
    conversationId: conversation.id,
    providerId: conversation.providerId,
    model: conversation.model,
    messages: conversation.messages,
    ...(systemPrompt ? { systemPrompt } : {}),
    ...(conversation.temperature === undefined ? {} : { temperature: conversation.temperature }),
    ...(conversation.topP === undefined ? {} : { topP: conversation.topP }),
    ...(conversation.topK === undefined ? {} : { topK: conversation.topK }),
    ...(conversation.reasoningEffort ? { reasoningEffort: conversation.reasoningEffort } : {}),
    ...(conversation.maxTokens === undefined ? {} : { maxTokens: conversation.maxTokens }),
    generationParameterSources: resolveGenerationParameterSources({
      values: conversation,
      overrides: conversation.generationParameterOverrides,
    }),
  }
  let contextReceipt: ConversationRunPreparedRequest['contextReceipt']

  if (dependencies.requestPreparation) {
    try {
      const prepared = await dependencies.requestPreparation.prepare({
        conversation,
        request,
        context,
        ...(assembledContext ? { assembledContext } : {}),
        ...(input.cancellationSignal ? { cancellationSignal: input.cancellationSignal } : {}),
      })
      if (isPreparedRequest(prepared)) {
        request = prepared.request
        contextReceipt = prepared.contextReceipt
      } else {
        request = prepared
      }
    } catch (error) {
      if (input.cancellationSignal?.aborted || isAbortError(error)) {
        return err('cancelled', 'Conversation request preparation was cancelled.', { retryable: true })
      }
      return err(
        'context_assembly_failed',
        error instanceof Error ? error.message : 'The conversation request could not be prepared.',
        { retryable: true },
      )
    }
  }

  let modelOperationSession
  try {
    modelOperationSession = await dependencies.createModelOperationSession?.()
  } catch (error) {
    return err(
      'provider_failed',
      error instanceof Error ? error.message : 'The model operation catalog could not be created.',
      { retryable: true },
    )
  }

  return dependencies.assistantRuntime.execute({
    runId: input.runId,
    request,
    context,
    ...(contextReceipt ? { contextReceipt } : {}),
    ...(input.responseMessageId ? { responseMessageId: input.responseMessageId } : {}),
    ...(input.cancellationSignal ? { cancellationSignal: input.cancellationSignal } : {}),
    ...(dependencies.providerGatewayOptions ? { providerGatewayOptions: dependencies.providerGatewayOptions } : {}),
    ...(modelOperationSession ? { modelOperationSession } : {}),
    onPersisted: async ({ run, journalEntry }) => {
      await project(input.projection, { conversationId: conversation.id, run, journalEntry, contextCitations })
    },
  })
}

function isPreparedRequest(
  value: ChatRequest | ConversationRunPreparedRequest,
): value is ConversationRunPreparedRequest {
  return Boolean(value)
    && typeof value === 'object'
    && 'request' in value
    && Boolean(value.request)
    && value.request.schema === CHAT_REQUEST_SCHEMA
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

async function project(
  projection: ConversationRunProjection | undefined,
  event: Parameters<NonNullable<ConversationRunProjection>>[0],
): Promise<void> {
  try {
    await projection?.(event)
  } catch {
    // Projections are disposable; durable run state has already been committed.
  }
}
