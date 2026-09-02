import {
  createAssistantRunId,
  freezeChatRequest,
  systemClock,
  type AssistantRunId,
  type IdGenerator,
  type JsonRecord,
  type ChatReasoningReplayPart,
  type ChatToolCallProviderMetadata,
  type ChatRequest,
  type GenerationParameterSources,
  type Result,
  type StreamEvent,
} from '@/core'
import {
  createAssistantConversationDurableExecutionRuntime,
  createSqliteAssistantRunPersistence,
  type AssistantContextPlanReceipt,
  type AssistantConversationWorkspaceWritebackHandoff,
  type AssistantRun,
  type AssistantActivityExecutionResult,
  type AssistantRuntimeErrorCode,
  type AssistantModelOperationSession,
} from '@/modules/assistant-runtime'
import type { ProviderRuntimeCompletionResult } from '@/modules/providers'
import {
  createProviderRuntimeAdapter,
  streamProviderChat,
  toRuntimeChatRequest,
} from '@/bootstrap/providerRuntime'
import {
  createContextSnapshotAssembler,
  createSqliteContextSnapshotRepository,
  type ContextCitation,
  type ContextSourceReference,
} from '@/modules/knowledge'
import { createExpoSqliteDatabaseProvider } from '@/platform/storage'
import { projectConversationAssistantFailure } from '@/bootstrap/conversationAssistantMessageProjection'
import { conversationAssistantProviderDispatchRuntime } from '@/bootstrap/conversationAssistantProviderDispatchRuntime'
import { createAppContainer } from '@/bootstrap/createAppContainer'
import { st } from '@/i18n/service'
import type { Attachment, Message } from '@/types/chatContracts'
import type { RetrievalSource } from '@/types/contextContracts'
import { preserveMessageIdentity } from '@/bootstrap/plainChatMessageIdentity'

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
type ProviderDispatchShape = Omit<ProviderDispatchInput, 'buildStreamLifecycle'>
type ProviderDispatchOutcome = Awaited<ReturnType<
  typeof conversationAssistantProviderDispatchRuntime.dispatch
>>
type ProviderPreparedDispatch = ReturnType<
  typeof conversationAssistantProviderDispatchRuntime.prepare
>
type ProviderStreamLifecycle = ReturnType<
  ProviderDispatchInput['buildStreamLifecycle']
>
type ConversationAssistantFinalizationReceipt =
  | { readonly kind: 'completed'; readonly output: string }
  | { readonly kind: 'skipped' }
type ConversationAssistantDurableStreamLifecycle = Omit<
  ProviderStreamLifecycle,
  'complete'
> & {
  readonly complete: (
    ...args: Parameters<ProviderStreamLifecycle['complete']>
  ) => Promise<ConversationAssistantFinalizationReceipt>
}

export type ConversationAssistantDurableDispatchInput = ProviderDispatchShape & {
  readonly buildStreamLifecycle: (
    input: Parameters<ProviderDispatchInput['buildStreamLifecycle']>[0],
  ) => ConversationAssistantDurableStreamLifecycle
  readonly runId?: AssistantRunId
  readonly workspaceWritebackHandoff?: AssistantConversationWorkspaceWritebackHandoff
  readonly sourceMessages: readonly Message[]
  readonly requestMessageId?: string
  readonly requestText: string
  readonly approvedToolContextIds: readonly string[]
  readonly contextReceipt?: AssistantContextPlanReceipt
  readonly modelOperationSession?: AssistantModelOperationSession
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
    'prepare' | 'dispatchPrepared'
  >
  readonly createContextSnapshot: typeof createDurableContextSnapshot
  projectStartFailure(input: ConversationAssistantDurableDispatchInput): void
}

export function createConversationAssistantDurableExecutionRuntime(
  dependencies: ConversationAssistantDurableExecutionRuntimeDependencies,
) {
  return {
  async dispatch(
    input: ConversationAssistantDurableDispatchInput,
  ): Promise<ConversationAssistantDurableDispatchOutcome> {
    let preparedDispatch: ProviderPreparedDispatch
    let canonicalRequest: ChatRequest
    try {
      // Request preparation does not invoke the lifecycle callback. Keep the
      // caller's exact input object while viewing the richer completion return
      // through the legacy void-return provider-dispatch type.
      preparedDispatch = dependencies.providerDispatchRuntime.prepare(
        input as unknown as ProviderDispatchInput,
      )
      canonicalRequest = createCanonicalRichRequest(input, preparedDispatch.request)
      canonicalRequest = freezeChatRequest(
        input.modelOperationSession
          ? input.modelOperationSession.prepareRequest(canonicalRequest)
          : canonicalRequest,
      )
      preparedDispatch = bindCanonicalRichToolDeclarations(
        input,
        preparedDispatch,
        canonicalRequest,
      )
    } catch (error) {
      dependencies.projectStartFailure(input)
      return { kind: 'terminal', outcome: { kind: 'failed', error } }
    }

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
      request: canonicalRequest,
      contextReceipt: input.contextReceipt,
      context: contextOutcome.value.snapshot,
      workspaceWritebackHandoff: input.workspaceWritebackHandoff,
      cancellationSignal: input.requestController.signal,
      async execute({ signal, started, checkpointStreamEvent, continueProviderTurns }) {
        let terminalLifecycleStarted = false
        let activitySettled = false
        let checkpointFailure: unknown
        let checkpointTail = Promise.resolve()
        let projectMissingTerminal: ((error: unknown) => void) | undefined
        const firstCalls: Array<{
          callId: string
          name: string
          arguments: JsonRecord
          providerMetadata?: ChatToolCallProviderMetadata
        }> = []
        let firstReasoningReplay: readonly ChatReasoningReplayPart[] = Object.freeze([])
        let settleActivity!: (result: AssistantActivityExecutionResult) => void
        const activityCompletion = new Promise<AssistantActivityExecutionResult>((resolve) => {
          settleActivity = (result) => {
            if (activitySettled) return
            activitySettled = true
            resolve(result)
          }
        })
        const awaitActivityCompletion = async (): Promise<AssistantActivityExecutionResult> => {
          const result = await activityCompletion
          if (checkpointFailure) throw checkpointFailure
          return result
        }
        const failActivity = (error: unknown) => {
          settleActivity({
            outcome: 'failed',
            failureMessage: error instanceof Error
              ? error.message
            : 'The provider stream did not complete successfully.',
          })
        }
        // Provider callbacks are synchronous; serialize async journal writes and
        // wait for their barrier before allowing Rich terminal completion.
        const queueStreamEvent = (event: StreamEvent): void => {
          if (event.type === 'tool-call') {
            firstCalls.push({
              callId: event.toolCallId,
              name: event.toolName,
              arguments: event.arguments ?? {},
              ...(event.providerMetadata ? { providerMetadata: event.providerMetadata } : {}),
            })
          } else if (event.type === 'provider-continuation-state') {
            firstReasoningReplay = event.reasoningReplay ?? Object.freeze([])
          }
          if (typeof checkpointStreamEvent !== 'function' || checkpointFailure) return
          const next = checkpointTail.then(async () => {
            if (checkpointFailure) return
            try {
              await checkpointStreamEvent(event)
            } catch (error) {
              checkpointFailure = error
              input.requestController.abort(error)
              throw error
            }
          })
          checkpointTail = next.then(
            () => undefined,
            () => undefined,
          )
        }
        const settleFailureAfterCheckpoint = (
          error: unknown,
          callback: () => void,
        ) => {
          const projectFailure = () => {
            let callbackResult: void | PromiseLike<void>
            try {
              callbackResult = callback()
            } catch (callbackError) {
              failActivity(callbackError)
              return
            }
            void Promise.resolve(callbackResult).then(
              () => failActivity(error),
              (callbackError) => failActivity(callbackError),
            )
          }
          void checkpointTail.then(projectFailure, projectFailure)
        }
        const abortRequest = () => input.requestController.abort(signal.reason)
        signal.addEventListener('abort', abortRequest, { once: true })
        if (signal.aborted) abortRequest()

        try {
          const providerDispatchOutcome =
            await dependencies.providerDispatchRuntime.dispatchPrepared({
              ...input,
              onStreamEvent: queueStreamEvent,
              buildStreamLifecycle(lifecycleInput) {
                const lifecycle = input.buildStreamLifecycle(lifecycleInput)
                const durableLifecycle = {
                  ...lifecycle,
                  async complete(...args: Parameters<typeof lifecycle.complete>) {
                    terminalLifecycleStarted = true
                    try {
                      await checkpointTail
                      if (checkpointFailure) throw checkpointFailure
                      let [result, completionContext] = args
                      if (
                        firstCalls.length
                        && input.modelOperationSession
                        && continueProviderTurns
                      ) {
                        const continuationResults: ProviderRuntimeCompletionResult[] = []
                        const continuationResult = await continueProviderTurns({
                          request: canonicalRequest,
                          session: input.modelOperationSession,
                          calls: firstCalls,
                          reasoningReplay: firstReasoningReplay,
                          outputText: result.text,
                          stream: createProviderRuntimeAdapter({
                            provider: input.provider,
                            settings: input.settings,
                            streamChat: createRichContinuationStream(input, continuationResults),
                          }).stream,
                        })
                        result = {
                          ...mergeProviderCompletionResults(result, continuationResults),
                          text: continuationResult.outputText,
                          providerToolCalls: undefined,
                        }
                      }
                      const finalization = await lifecycle.complete(result, {
                        ...completionContext,
                        onStreamEvent: queueStreamEvent,
                      })
                      // Finalization may execute provider/MCP revisions that
                      // emit additional normalized events. Fence terminal run
                      // success on those writes as well.
                      await checkpointTail
                      if (checkpointFailure) throw checkpointFailure
                      const outputText = readFinalizationOutput(finalization)
                      settleActivity({
                        outcome: 'succeeded',
                        ...(outputText === undefined ? {} : { outputText }),
                      })
                    } catch (error) {
                      failActivity(error)
                      throw error
                    }
                  },
                  completionFailed(error: Parameters<typeof lifecycle.completionFailed>[0]) {
                    terminalLifecycleStarted = true
                    settleFailureAfterCheckpoint(error, () => lifecycle.completionFailed(error))
                  },
                  providerFailed(error: Parameters<typeof lifecycle.providerFailed>[0]) {
                    terminalLifecycleStarted = true
                    settleFailureAfterCheckpoint(error, () => lifecycle.providerFailed(error))
                  },
                  startFailed(error: Parameters<typeof lifecycle.startFailed>[0]) {
                    terminalLifecycleStarted = true
                    settleFailureAfterCheckpoint(error, () => lifecycle.startFailed(error))
                  },
                }
                projectMissingTerminal = durableLifecycle.startFailed
                return durableLifecycle
              },
            }, preparedDispatch)
          const streamingOutcome = providerDispatchOutcome.streamingOutcome
          if (streamingOutcome.kind !== 'started') {
            failActivity(
              streamingOutcome.kind === 'failed'
                ? streamingOutcome.error
                : new Error('The provider stream was cancelled before it started.'),
            )
            return await awaitActivityCompletion()
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

          return await awaitActivityCompletion()
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

function readFinalizationOutput(
  value: ConversationAssistantFinalizationReceipt,
): string | undefined {
  return value.kind === 'completed' ? value.output : undefined
}

function createCanonicalRichRequest(
  input: ConversationAssistantDurableDispatchInput,
  request: ProviderPreparedDispatch['request'],
): ChatRequest {
  const messages = preserveMessageIdentity(
    request.messages
      .flatMap((message) => (
        message.role === 'user' || message.role === 'assistant'
          ? [{
              role: message.role,
              content: typeof message.content === 'string' ? message.content : '',
            }]
          : []
      )),
    input.sourceMessages.map((message) => ({
      id: message.id,
      role: message.role,
      text: message.content,
    })),
  )
  const requestedCapabilities = [
    ...(request.attachments.length ? ['attachments'] : []),
    ...(request.providerToolDeclarations?.length ? ['provider-tools'] : []),
    ...(request.webSearchMode !== 'off' ? ['web-search'] : []),
    ...(request.remoteCompactEligible ? ['remote-compact'] : []),
  ]
  return {
    schema: 'islemind.chat-request.v1',
    conversationId: request.conversationId,
    providerId: request.provider.id,
    model: request.model,
    messages,
    ...(request.systemPrompt || request.contextPrompt
      ? { systemPrompt: [request.systemPrompt, request.contextPrompt].filter(Boolean).join('\n\n') }
      : {}),
    temperature: request.temperature,
    topP: request.topP,
    topK: request.topK,
    reasoningEffort: request.reasoningEffort,
    maxTokens: request.maxTokens,
    generationParameterSources: request.generationParameterSources,
    requestedCapabilities: requestedCapabilities.length
      ? Object.freeze(requestedCapabilities)
      : undefined,
  }
}

function bindCanonicalRichToolDeclarations(
  input: ConversationAssistantDurableDispatchInput,
  prepared: ProviderPreparedDispatch,
  canonicalRequest: ChatRequest,
): ProviderPreparedDispatch {
  const declarations = input.modelOperationSession
    ? toRuntimeChatRequest(
        { provider: input.provider, settings: input.settings },
        canonicalRequest,
      ).providerToolDeclarations
    : prepared.request.providerToolDeclarations
  return Object.freeze({
    request: Object.freeze({
      ...prepared.request,
      providerToolDeclarations: declarations?.length
        ? freezePreparedValue(declarations)
        : undefined,
    }),
  })
}

function freezePreparedValue<Value>(value: Value): Value {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    freezePreparedValue(child)
  }
  return Object.freeze(value)
}

function createRichContinuationStream(
  input: ConversationAssistantDurableDispatchInput,
  results: ProviderRuntimeCompletionResult[],
) {
  return async (
    request: Parameters<NonNullable<Parameters<typeof createProviderRuntimeAdapter>[0]['streamChat']>>[0],
    onChunk: Parameters<NonNullable<Parameters<typeof createProviderRuntimeAdapter>[0]['streamChat']>>[1],
    onDone: Parameters<NonNullable<Parameters<typeof createProviderRuntimeAdapter>[0]['streamChat']>>[2],
    onError: Parameters<NonNullable<Parameters<typeof createProviderRuntimeAdapter>[0]['streamChat']>>[3],
    onCitations?: Parameters<NonNullable<Parameters<typeof createProviderRuntimeAdapter>[0]['streamChat']>>[4],
    onTrace?: Parameters<NonNullable<Parameters<typeof createProviderRuntimeAdapter>[0]['streamChat']>>[5],
  ) => streamProviderChat({
    ...request,
    attachments: input.attachments,
    contextPrompt: input.contextPrompt,
    retrievalSources: input.retrievalSources,
    webSearchMode: input.webSearchMode,
    fallbackProviders: input.fallbackProviders,
    remoteCompactEligible: false,
    remoteCompactFallback: undefined,
    previousResponseId: undefined,
  }, onChunk, (result) => {
      results.push(result)
      onDone(result)
    }, onError, onCitations, onTrace).then((handle) => {
    void handle.done.catch(() => undefined)
    return handle
  })
}

function mergeProviderCompletionResults(
  initial: ProviderRuntimeCompletionResult,
  continuations: readonly ProviderRuntimeCompletionResult[],
): ProviderRuntimeCompletionResult {
  let merged = initial
  for (const continuation of continuations) {
    merged = {
      ...merged,
      ...continuation,
      text: continuation.text || merged.text,
      usage: mergeProviderUsage(merged.usage, continuation.usage),
      citations: mergeProviderCitations(merged.citations, continuation.citations),
      traces: [...(merged.traces ?? []), ...(continuation.traces ?? [])],
      providerToolCalls: continuation.providerToolCalls,
    }
  }
  return merged
}

function mergeProviderUsage(
  base: ProviderRuntimeCompletionResult['usage'],
  extra: ProviderRuntimeCompletionResult['usage'],
): ProviderRuntimeCompletionResult['usage'] {
  if (!base) return extra
  if (!extra) return base
  const add = (left?: number, right?: number): number | undefined => {
    if (typeof left !== 'number') return right
    if (typeof right !== 'number') return left
    return left + right
  }
  return {
    source: base.source === 'provider' && extra.source === 'provider' ? 'provider' : 'estimated',
    inputTokens: add(base.inputTokens, extra.inputTokens),
    outputTokens: add(base.outputTokens, extra.outputTokens),
    totalTokens: add(base.totalTokens, extra.totalTokens),
    ...(add(base.cacheCreationInputTokens, extra.cacheCreationInputTokens) === undefined
      ? {}
      : { cacheCreationInputTokens: add(base.cacheCreationInputTokens, extra.cacheCreationInputTokens) }),
    ...(add(base.cacheReadInputTokens, extra.cacheReadInputTokens) === undefined
      ? {}
      : { cacheReadInputTokens: add(base.cacheReadInputTokens, extra.cacheReadInputTokens) }),
    ...(add(base.cachedInputTokens, extra.cachedInputTokens) === undefined
      ? {}
      : { cachedInputTokens: add(base.cachedInputTokens, extra.cachedInputTokens) }),
    ...(add(base.reasoningTokens, extra.reasoningTokens) === undefined
      ? {}
      : { reasoningTokens: add(base.reasoningTokens, extra.reasoningTokens) }),
  }
}

function mergeProviderCitations(
  base: ProviderRuntimeCompletionResult['citations'],
  extra: ProviderRuntimeCompletionResult['citations'],
): ProviderRuntimeCompletionResult['citations'] {
  if (!base?.length) return extra
  if (!extra?.length) return base
  const seen = new Set<string>()
  return [...base, ...extra].filter((citation) => {
    const key = JSON.stringify(citation)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
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
