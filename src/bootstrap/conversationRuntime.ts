import {
  asAssistantRunId,
  systemClock,
  type IdGenerator,
} from '@/core'
import {
  buildAssistantContextPlanReceipt,
  planUnifiedConversationCapabilities,
} from '@/modules/assistant-runtime'
import {
  createConversationRunUseCase,
  createSqliteConversationRepository,
  type ConversationRunRequestPreparation,
  type ConversationRunUseCase,
} from '@/modules/conversations'
import {
  appendProviderContext,
  createContextSnapshotAssembler,
  createConversationContextRetrievalPort,
  createKnowledgeContextRetriever,
  createSqliteContextSnapshotRepository,
  type AssembledContext,
  type KnowledgeContextRetriever,
} from '@/modules/knowledge'
import {
  createSameProviderFallbackResolver,
  createProviderGateway,
  snapshotProviderConfiguration,
  type ProviderRuntimeChatSettings,
  type SameProviderFallbackDescriptor,
  type ProviderChatExecutionConstraint,
} from '@/modules/providers'
import { createExpoSqliteDatabaseProvider } from '@/platform/storage'
import type { Conversation, Message } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import { getModelConfig } from '@/types/modelCatalog'
import type { RetrievalSource } from '@/types/contextContracts'
import type { Settings } from '@/types/settingsContracts'
import { applicationAssistantRuntime, assistantRunPersistence as runPersistence, bindAssistantRuntimeGateway } from './applicationAssistantRuntime'
import { assistantExecutionHost } from './assistantExecutionHostRuntime'
import { buildChatContextRuntime } from './contextContributionRuntime'
import { planChatContext } from './contextPlanning'
import { retrieveConversationKnowledgeContext } from './knowledgeContextRuntime'
import { createProviderRuntimeAdapter } from './providerRuntime'
import { createConversationModelOperationSession } from './conversationModelOperationRuntime'
import { preserveMessageIdentity } from './plainChatMessageIdentity'
import { buildSystemPrompt } from '@/services/promptEngineering'
import { resolveProviderModelAlias } from '@/utils/providerModels'

const databaseProvider = createExpoSqliteDatabaseProvider()
const conversations = createSqliteConversationRepository(databaseProvider)
const contextSnapshots = createSqliteContextSnapshotRepository(databaseProvider)
let idSequence = 0

const ids: IdGenerator = {
  next(prefix) {
    idSequence += 1
    return `${prefix}-${Date.now().toString(36)}-${idSequence.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  },
}

export interface ConversationRuntimeOptions {
  provider?: AIProvider
  providerSettings?: ProviderRuntimeChatSettings
  executionConstraint?: ProviderChatExecutionConstraint
  providerFallbackDescriptors?: readonly SameProviderFallbackDescriptor[]
  contextRetriever?: KnowledgeContextRetriever
  requestPreparation?: ConversationRunRequestPreparation
  createModelOperationSession?: () => ReturnType<typeof createConversationModelOperationSession>
}

export interface PlainChatRuntimeInput {
  conversation: Conversation
  provider: AIProvider
  settings: Settings
  executionConstraint?: ProviderChatExecutionConstraint
}

/** Read-only reconstruction; looking up a terminal run never resumes its effects. */
export function getLatestConversationResponseRun(conversationId: string, responseMessageId: string) {
  return runPersistence.getLatestForResponseMessage(conversationId, responseMessageId)
}

/** Stop is local run control, independent of provider credentials or admission. */
export async function cancelConversationResponseRun(runId: Parameters<typeof applicationAssistantRuntime.cancel>[0]) {
  const result = await applicationAssistantRuntime.cancel(runId)
  if (result.ok) return result.value
  if (result.error.code === 'run_not_active') {
    const run = await applicationAssistantRuntime.getRun(runId)
    if (run && (run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled')) return run
  }
  throw new Error(result.error.message)
}

export function createConversationRuntime(
  options: ConversationRuntimeOptions = {},
): ConversationRunUseCase {
  const assistantRuntime = bindAssistantRuntimeGateway(createProviderGateway(options.provider
      ? [createProviderRuntimeAdapter({ provider: options.provider, ...(options.providerSettings ? { settings: options.providerSettings } : {}),
          ...(options.executionConstraint ? { executionConstraint: options.executionConstraint } : {}) })]
      : []))
  const contextSnapshotAssembler = createContextSnapshotAssembler({
    clock: systemClock,
    ids,
    repository: contextSnapshots,
    ...(options.contextRetriever ? { retriever: options.contextRetriever } : {}),
  })
  // The generic factory is also used by deferred recovery. Do not let a
  // recovery-only instance accidentally dispatch an unplanned full history.
  const requestPreparation = options.requestPreparation ?? {
    prepare() {
      throw new Error(
        'A bounded Chat request preparation policy is required for new turns. Use createPlainChatRuntime.',
      )
    },
  } satisfies ConversationRunRequestPreparation
  return createConversationRunUseCase({
    clock: systemClock,
    ids,
    conversations,
    assistantRuntime,
    contextSnapshotAssembler,
    requestPreparation,
    ...(options.providerFallbackDescriptors?.length ? {
      providerGatewayOptions: {
        resolveFallbackRoutes: createSameProviderFallbackResolver(options.providerFallbackDescriptors),
      },
    } : {}),
    ...(options.createModelOperationSession ? {
      createModelOperationSession: options.createModelOperationSession,
    } : {}),
  })
}

/**
 * Bootstrap-only composition for the plain-chat presentation controller. The
 * target feature receives this factory instead of importing legacy adapters.
 */
export function createPlainChatRuntime(
  input: PlainChatRuntimeInput,
): ConversationRunUseCase {
  input = {
    ...input,
    conversation: snapshotProviderConfiguration(input.conversation),
    provider: snapshotProviderConfiguration(input.provider),
    settings: snapshotProviderConfiguration(input.settings),
    ...(input.executionConstraint ? { executionConstraint: snapshotProviderConfiguration(input.executionConstraint) } : {}),
  }
  return createConversationRuntime({
    provider: input.provider,
    providerSettings: input.settings,
    // Chat has exactly one route-fallback executor. The generic gateway resolver
    // remains available to other consumers, but must not wrap Chat's executor.
    ...(input.executionConstraint ? { executionConstraint: input.executionConstraint } : {}),
    contextRetriever: createKnowledgeContextRetriever({
      port: createConversationContextRetrievalPort<Message, Conversation>({
        conversation: input.conversation,
        retrieveContext: (conversation, message, { signal }) => (
          retrieveConversationKnowledgeContext(conversation, message, signal, { settings: input.settings, provider: input.provider })
        ),
      }),
    }),
    requestPreparation: createPlainChatRequestPreparation({
      provider: input.provider,
      settings: input.settings,
      executionModel: input.conversation.model ?? undefined,
    }),
    createModelOperationSession: () => createConversationModelOperationSession(input),
  })
}

function createPlainChatRequestPreparation(input: {
  provider: AIProvider
  settings: Settings
  executionModel?: string
}): ConversationRunRequestPreparation {
  input = { ...input, provider: snapshotProviderConfiguration(input.provider), settings: snapshotProviderConfiguration(input.settings) }
  return {
    async prepare(preparation) {
      throwIfAborted(preparation.cancellationSignal)
      // The canonical source was loaded through the unchanged full-save barrier.
      // Apply only the admitted request-local route, never to that stored source.
      preparation = { ...preparation, request: { ...preparation.request,
        providerId: input.provider.id, model: input.executionModel ?? preparation.request.model } }

      // The Rich path already plans against the admission-normalized upstream
      // model. Keep the Plain request's requested model intact, but use that
      // same upstream identity for capabilities, packing, and its receipt.
      const upstreamModel = resolveProviderModelAlias(
        input.provider,
        preparation.request.model,
      )
      const modelConfig = getModelConfig(
        upstreamModel,
        input.provider.type,
        input.provider.modelConfigs,
      )
      const retrievedSources = toRetrievalSources(preparation.assembledContext)
      const contextRuntime = buildChatContextRuntime({
        retrievedContext: {
          sources: retrievedSources,
          prompt: preparation.assembledContext?.providerContext ?? '',
        },
      })
      const retrievalSources = contextRuntime.retrievalSources
      const systemPrompt = buildSystemPrompt({
        baseSystemPrompt: preparation.conversation.systemPrompt,
        language: input.settings.language,
        modelConfig,
        provider: input.provider,
        hasMemory: contextRuntime.counts.memory > 0,
        hasKnowledge: contextRuntime.counts.knowledge > 0,
        hasWeb: false,
        retrievalSources,
      })
      const contextSources = contextRuntime.contextSources
      const planningMessages = preparation.request.messages
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .map((message) => ({
          role: message.role as 'user' | 'assistant',
          content: message.text,
        }))
      const latestUserMessage = [...planningMessages]
        .reverse()
        .find((message) => message.role === 'user')

      // The canonical ConversationRun path does not yet carry the native
      // remote-compact handoff fields. Force the planner to emit the exact
      // local packed request rather than persisting a plan that would require
      // a second provider-specific compaction decision downstream.
      const plan = planChatContext({
        messages: planningMessages,
        ...(latestUserMessage ? { draft: { text: latestUserMessage.content } } : {}),
        contextSources,
        modelContextWindow: modelConfig.contextWindow,
        maxOutputTokens: preparation.request.maxTokens ?? modelConfig.defaultMaxTokens,
        modelManifest: modelConfig,
        systemPrompt,
        reasoningEffort: preparation.request.reasoningEffort,
        provider: input.provider,
        providerType: input.provider.type,
        model: upstreamModel,
        settings: {
          ...input.settings,
          remoteCompactMode: 'off',
        },
        retrievalSources,
        memorySourceCount: contextRuntime.counts.memory,
      })
      throwIfAborted(preparation.cancellationSignal)

      const capabilityPlan = planUnifiedConversationCapabilities({
        conversationId: preparation.request.conversationId,
        text: latestUserMessage?.content ?? '',
        hasAttachments: false,
        retrievalEnabled: contextRuntime.counts.memory + contextRuntime.counts.knowledge > 0,
        webEnabled: false,
        workspaceAvailable: false,
        readOnlyToolsAvailable: preparation.request.toolDefinitions?.some(
          (tool) => tool.permission === 'read-only',
        ) === true,
        mobile: true,
        estimatedInputTokens: plan.packed.estimatedInputTokens,
        tokenBudget: plan.packed.budgetTokens,
      })

      const plannedMessages = preserveMessageIdentity(
        plan.messages,
        preparation.request.messages,
      )
      const plannedSystemPrompt = appendProviderContext(
        systemPrompt,
        plan.contextPrompt,
      )
      return {
        request: {
          ...preparation.request,
          messages: plannedMessages,
          ...(plannedSystemPrompt ? { systemPrompt: plannedSystemPrompt } : {}),
        },
        contextReceipt: buildAssistantContextPlanReceipt({
          providerId: preparation.request.providerId,
          model: upstreamModel,
          conversationId: preparation.request.conversationId,
          sourceMessageIds: preparation.request.messages.map((message) => message.id),
          capabilityPlan,
          plan,
          activePrompt: plan.packed,
        }),
      }
    },
  }
}

function toRetrievalSources(
  assembled: AssembledContext | undefined,
): RetrievalSource[] {
  if (!assembled) return []
  const citations = assembled.citations
    .filter((citation) => citation.type === 'memory' || citation.type === 'knowledge' || citation.type === 'web')
    .map((citation) => ({
      ...citation,
      content: citation.excerpt ?? citation.title,
    }))
  if (citations.length) return citations
  return assembled.sources.flatMap<RetrievalSource>((source) => {
    if (source.kind !== 'memory' && source.kind !== 'knowledge' && source.kind !== 'web') return []
    return [{
      id: source.id,
      type: source.kind,
      title: source.title ?? source.id,
      content: source.title ?? source.id,
      ...(source.sourceUri ? { sourceUri: source.sourceUri } : {}),
      ...(source.score === undefined ? {} : { score: source.score }),
    }]
  })
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  const error = new Error('Conversation request preparation was cancelled.')
  error.name = 'AbortError'
  throw error
}

export async function resumeConversationModelOperation(input: {
  conversation: Conversation
  provider: AIProvider
  settings: Settings
  runId: string
  approved: boolean
  continuationToken: string
  continuationDigest: string
  cancellationSignal?: AbortSignal
  projection: Parameters<ConversationRunUseCase['resumeModelOperation']>[0]['projection']
}): Promise<boolean> {
  if (input.cancellationSignal?.aborted) return false
  // This entry is invoked by the visible confirmation UI, never by a notification.
  assistantExecutionHost.prepareUserResume(asAssistantRunId(input.runId))
  const runtime = createPlainChatRuntime(input)
  const result = await runtime.resumeModelOperation({
    runId: asAssistantRunId(input.runId),
    approved: input.approved,
    continuationToken: input.continuationToken,
    continuationDigest: input.continuationDigest,
    ...(input.cancellationSignal ? { cancellationSignal: input.cancellationSignal } : {}),
    projection: input.projection,
  })
  return result.ok && result.value.status !== 'awaiting-confirmation'
}

export async function resumePausedConversationRun(input: {
  conversation: Conversation
  provider: AIProvider
  settings: Settings
  runId: string
  expectedJournalSequence: number
  cancellationSignal?: AbortSignal
  projection: Parameters<ConversationRunUseCase['resumePausedRun']>[0]['projection']
  onSettled?: Parameters<ConversationRunUseCase['resumePausedRun']>[0]['onSettled']
}): Promise<boolean> {
  if (input.cancellationSignal?.aborted) return false
  assistantExecutionHost.prepareUserResume(asAssistantRunId(input.runId))
  const runtime = createPlainChatRuntime(input)
  // The Harness reuses its checkpoint request and completed receipts. This is
  // not a new turn, history trim, preference rewrite, or approval of a tool.
  const result = await runtime.resumePausedRun({
    runId: asAssistantRunId(input.runId),
    expectedJournalSequence: input.expectedJournalSequence,
    ...(input.cancellationSignal ? { cancellationSignal: input.cancellationSignal } : {}),
    projection: input.projection,
    ...(input.onSettled ? { onSettled: input.onSettled } : {}),
  })
  return result.ok && result.value.status !== 'paused'
}
