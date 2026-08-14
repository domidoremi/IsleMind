import {
  createAssistantRunId,
  systemClock,
  type AssistantRunId,
  type IdGenerator,
  type Result,
} from '@/core'
import {
  createAssistantConversationDurableExecutionRuntime,
  createSqliteAssistantRunPersistence,
  type AssistantConversationWorkspaceWritebackHandoff,
  type AssistantRun,
  type AssistantActivityExecutionResult,
  type AssistantRuntimeErrorCode,
} from '@/modules/assistant-runtime'
import {
  createContextSnapshotAssembler,
  createSqliteContextSnapshotRepository,
  type ContextCitation,
  type ContextSourceReference,
} from '@/modules/knowledge'
import { createExpoSqliteDatabaseProvider } from '@/platform/storage'
import { projectConversationAssistantFailure } from '@/bootstrap/conversationAssistantMessageProjection'
import { conversationAssistantProviderDispatchRuntime } from '@/bootstrap/conversationAssistantProviderDispatchRuntime'
import { conversationProviderGateway } from '@/bootstrap/conversationProviderGateway'
import { createAppContainer } from '@/bootstrap/createAppContainer'
import { st } from '@/i18n/service'
import { useChatStore } from '@/store/chatStore'
import type { Attachment, Message } from '@/types/chatContracts'
import type { RetrievalSource } from '@/types/contextContracts'

const databaseProvider = createExpoSqliteDatabaseProvider()
const contextSnapshots = createSqliteContextSnapshotRepository(databaseProvider)
const runPersistence = createSqliteAssistantRunPersistence(databaseProvider)
let idSequence = 0

const ids: IdGenerator = {
  next(prefix) {
    idSequence += 1
    return `${prefix}-${Date.now().toString(36)}-${idSequence.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  },
}

const assistantRuntime = createAppContainer({
  clock: systemClock,
  ids,
  providerAdapters: [],
  providerGateway: conversationProviderGateway,
  runPersistence,
}).assistantRuntime

const assistantConversationDurableExecutionRuntime =
  createAssistantConversationDurableExecutionRuntime({
  ids,
  activityRuntime: assistantRuntime,
})

type ProviderDispatchInput = Parameters<
  typeof conversationAssistantProviderDispatchRuntime.dispatch
>[0]
type ProviderDispatchOutcome = Awaited<ReturnType<
  typeof conversationAssistantProviderDispatchRuntime.dispatch
>>

export interface ConversationAssistantDurableDispatchInput
  extends ProviderDispatchInput {
  readonly runId?: AssistantRunId
  readonly workspaceWritebackHandoff?: AssistantConversationWorkspaceWritebackHandoff
  readonly sourceMessages: readonly Message[]
  readonly requestMessageId?: string
  readonly requestText: string
  readonly approvedToolContextIds: readonly string[]
}

export type ConversationAssistantDurableDispatchOutcome =
  | {
      readonly kind: 'terminal'
      readonly outcome:
        | { readonly kind: 'cancelled' }
        | { readonly kind: 'failed'; readonly error: unknown }
    }
  | {
      readonly kind: 'dispatched'
      readonly runId: AssistantRunId
      readonly completion: Promise<Result<AssistantRun, AssistantRuntimeErrorCode>>
      readonly providerDispatchOutcome: ProviderDispatchOutcome
    }

export interface ConversationAssistantDurableExecutionRuntimeDependencies {
  readonly durableExecutionRuntime: ReturnType<
    typeof createAssistantConversationDurableExecutionRuntime
  >
  readonly providerDispatchRuntime: Pick<
    typeof conversationAssistantProviderDispatchRuntime,
    'dispatch'
  >
  readonly createContextSnapshot: typeof createDurableContextSnapshot
  readAssistantOutput(conversationId: string, assistantMessageId: string): string
  projectStartFailure(input: ConversationAssistantDurableDispatchInput): void
}

export function createConversationAssistantDurableExecutionRuntime(
  dependencies: ConversationAssistantDurableExecutionRuntimeDependencies,
) {
  return {
  async dispatch(
    input: ConversationAssistantDurableDispatchInput,
  ): Promise<ConversationAssistantDurableDispatchOutcome> {
    const contextOutcome = await dependencies.createContextSnapshot(input)
    if (!contextOutcome.ok) {
      if (contextOutcome.error.code === 'cancelled') {
        return { kind: 'terminal', outcome: { kind: 'cancelled' } }
      }
      dependencies.projectStartFailure(input)
      return {
        kind: 'terminal',
        outcome: { kind: 'failed', error: contextOutcome.error },
      }
    }

    const durableOutcome = await dependencies.durableExecutionRuntime.start<ProviderDispatchOutcome>({
      runId: input.runId,
      conversationId: input.conversationId,
      responseMessageId: input.assistantMessageId,
      providerId: input.provider.id,
      model: input.upstreamModel,
      context: contextOutcome.value.snapshot,
      workspaceWritebackHandoff: input.workspaceWritebackHandoff,
      cancellationSignal: input.requestController.signal,
      async execute({ signal, started }) {
        let terminalLifecycleStarted = false
        let activitySettled = false
        let projectMissingTerminal: ((error: unknown) => void) | undefined
        let settleActivity!: (result: AssistantActivityExecutionResult) => void
        const activityCompletion = new Promise<AssistantActivityExecutionResult>((resolve) => {
          settleActivity = (result) => {
            if (activitySettled) return
            activitySettled = true
            resolve(result)
          }
        })
        const failActivity = (error: unknown) => {
          settleActivity({
            outcome: 'failed',
            failureMessage: error instanceof Error
              ? error.message
              : 'The provider stream did not complete successfully.',
          })
        }
        const abortRequest = () => input.requestController.abort(signal.reason)
        signal.addEventListener('abort', abortRequest, { once: true })
        if (signal.aborted) abortRequest()

        try {
          const providerDispatchOutcome =
            await dependencies.providerDispatchRuntime.dispatch({
              ...input,
              buildStreamLifecycle(lifecycleInput) {
                const lifecycle = input.buildStreamLifecycle(lifecycleInput)
                const durableLifecycle = {
                  ...lifecycle,
                  async complete(...args: Parameters<typeof lifecycle.complete>) {
                    terminalLifecycleStarted = true
                    try {
                      await lifecycle.complete(...args)
                      settleActivity({
                        outcome: 'succeeded',
                        outputText: dependencies.readAssistantOutput(
                          input.conversationId,
                          input.assistantMessageId,
                        ),
                      })
                    } catch (error) {
                      failActivity(error)
                      throw error
                    }
                  },
                  completionFailed(error: Parameters<typeof lifecycle.completionFailed>[0]) {
                    terminalLifecycleStarted = true
                    try {
                      lifecycle.completionFailed(error)
                    } finally {
                      failActivity(error)
                    }
                  },
                  providerFailed(error: Parameters<typeof lifecycle.providerFailed>[0]) {
                    terminalLifecycleStarted = true
                    try {
                      lifecycle.providerFailed(error)
                    } finally {
                      failActivity(error)
                    }
                  },
                  startFailed(error: Parameters<typeof lifecycle.startFailed>[0]) {
                    terminalLifecycleStarted = true
                    try {
                      lifecycle.startFailed(error)
                    } finally {
                      failActivity(error)
                    }
                  },
                }
                projectMissingTerminal = durableLifecycle.startFailed
                return durableLifecycle
              },
            })
          const streamingOutcome = providerDispatchOutcome.streamingOutcome
          if (streamingOutcome.kind !== 'started') {
            failActivity(
              streamingOutcome.kind === 'failed'
                ? streamingOutcome.error
                : new Error('The provider stream was cancelled before it started.'),
            )
            return await activityCompletion
          }

          const publication = started(providerDispatchOutcome)
          if (publication.kind !== 'published') {
            input.requestController.abort()
            failActivity(new Error(`Durable Chat start publication was rejected: ${publication.reason}`))
            return await activityCompletion
          }

          void streamingOutcome.handle.done.then(
            async () => {
              await Promise.resolve()
              if (terminalLifecycleStarted) return
              if (signal.aborted || input.requestController.signal.aborted) {
                failActivity(new Error('The provider stream was cancelled.'))
                return
              }
              const error = new Error('The provider stream ended without a terminal lifecycle callback.')
              projectMissingTerminal?.(error)
              failActivity(error)
            },
            (error) => {
              if (terminalLifecycleStarted) return
              failActivity(error)
            },
          )

          return await activityCompletion
        } finally {
          signal.removeEventListener('abort', abortRequest)
        }
      },
    })

    if (durableOutcome.kind === 'terminal') {
      if (!durableOutcome.result.ok && durableOutcome.result.error.code === 'cancelled') {
        return { kind: 'terminal', outcome: { kind: 'cancelled' } }
      }
      dependencies.projectStartFailure(input)
      return {
        kind: 'terminal',
        outcome: {
          kind: 'failed',
          error: durableOutcome.result.ok
            ? new Error('Durable Chat execution completed before provider start publication.')
            : durableOutcome.result.error,
        },
      }
    }

    return {
      kind: 'dispatched',
      runId: durableOutcome.runId,
      completion: durableOutcome.completion,
      providerDispatchOutcome: durableOutcome.value,
    }
  },
  }
}

export const conversationAssistantDurableExecutionRuntime =
  createConversationAssistantDurableExecutionRuntime({
    durableExecutionRuntime: assistantConversationDurableExecutionRuntime,
    providerDispatchRuntime: conversationAssistantProviderDispatchRuntime,
    createContextSnapshot: createDurableContextSnapshot,
    readAssistantOutput,
    projectStartFailure: projectDurableStartFailure,
  })

export function allocateConversationAssistantRunId(): AssistantRunId {
  return createAssistantRunId(ids)
}

async function createDurableContextSnapshot(
  input: ConversationAssistantDurableDispatchInput,
) {
  const sources = buildContextSources(
    input.retrievalSources,
    input.attachments,
    input.approvedToolContextIds,
  )
  const citations = buildContextCitations(input.retrievalSources)
  const assembler = createContextSnapshotAssembler({
    clock: systemClock,
    ids,
    repository: contextSnapshots,
    retriever: {
      async retrieve() {
        return {
          providerContext: input.contextPrompt,
          sources,
          citations,
        }
      },
    },
  })
  return assembler.assemble({
    conversationId: input.conversationId,
    conversationMessageIds: input.sourceMessages.map((message) => message.id),
    ...(input.requestMessageId ? { requestMessageId: input.requestMessageId } : {}),
    requestText: input.requestText,
    cancellationSignal: input.requestController.signal,
  })
}

function buildContextSources(
  retrievalSources: readonly RetrievalSource[],
  attachments: readonly Attachment[],
  approvedToolContextIds: readonly string[],
): ContextSourceReference[] {
  return [
    ...retrievalSources.map((source) => ({
      id: source.id,
      kind: source.type,
      title: source.title,
      ...(source.url ?? source.sourceUri
        ? { sourceUri: source.url ?? source.sourceUri }
        : {}),
      ...(typeof (source.rerankScore ?? source.score) === 'number'
        ? { score: source.rerankScore ?? source.score }
        : {}),
    })),
    ...attachments.map((attachment) => ({
      id: attachment.id,
      kind: 'attachment' as const,
      title: attachment.name,
      sourceUri: attachment.uri,
    })),
    ...approvedToolContextIds.map((id) => ({
      id,
      kind: 'tool' as const,
      title: id,
    })),
  ]
}

function buildContextCitations(
  retrievalSources: readonly RetrievalSource[],
): ContextCitation[] {
  return retrievalSources.map((source) => ({
    id: source.id,
    type: source.type,
    title: source.title,
    ...(source.excerpt ?? source.content
      ? { excerpt: source.excerpt ?? source.content }
      : {}),
    ...(source.url ? { url: source.url } : {}),
    ...(source.documentId ? { documentId: source.documentId } : {}),
    ...(source.chunkId ? { chunkId: source.chunkId } : {}),
    ...(typeof (source.rerankScore ?? source.score) === 'number'
      ? { score: source.rerankScore ?? source.score }
      : {}),
  }))
}

function readAssistantOutput(
  conversationId: string,
  assistantMessageId: string,
): string {
  return useChatStore.getState().conversations
    .find((conversation) => conversation.id === conversationId)
    ?.messages.find((message) => message.id === assistantMessageId)
    ?.content ?? ''
}

function projectDurableStartFailure(
  input: ConversationAssistantDurableDispatchInput,
): void {
  projectConversationAssistantFailure({
    conversationId: input.conversationId,
    assistantMessageId: input.assistantMessageId,
    content: st('chatRunner.error.sendFailed'),
    errorCode: 'unknown',
    providerId: input.provider.id,
  })
}
