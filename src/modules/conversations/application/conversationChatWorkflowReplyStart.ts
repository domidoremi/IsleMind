import type { Clock } from '@/core'
import type {
  AssistantChatWorkflowAssembledContext,
  AssistantChatWorkflowRunHandle,
  AssistantChatWorkflowRunRuntime,
  StartAssistantChatWorkflowRunInput,
} from '@/modules/assistant-runtime'
import type {
  ConversationChatWorkflowContextRetriever,
  ConversationChatWorkflowRuntimeInput,
  ConversationChatWorkflowRuntimeRequestedOutput,
  ConversationChatWorkflowRuntimeResolution,
  ConversationChatWorkflowRuntimeRunLimits,
  ConversationChatWorkflowRuntimeToolManifest,
  ConversationChatWorkflowRuntimeToolRequest,
  ConversationTaskCancellationAuthorityStatus,
  WorkflowCheckpointStore,
  WorkflowRuntimeBlockState,
} from '@/modules/tasks'
import type { Conversation, Message, MessageUsage } from '@/types/chatContracts'
import type { ChatErrorCode } from '@/types/providerContracts'
import type { Settings } from '@/types/settingsContracts'

export interface ConversationChatWorkflowReplyStartOptions {
  explicitToolRequest?: ConversationChatWorkflowRuntimeToolRequest
  workflowId?: string
  requestedOutput?: ConversationChatWorkflowRuntimeRequestedOutput
  manifests?: ConversationChatWorkflowRuntimeToolManifest[]
  enabledWorkflowIds?: string[]
  blockedWorkflowStates?: WorkflowRuntimeBlockState[]
  limits?: Partial<ConversationChatWorkflowRuntimeRunLimits>
  userConfirmed?: boolean
}

export interface ConversationChatWorkflowReplyRuntime
  extends AssistantChatWorkflowRunRuntime<AssistantChatWorkflowAssembledContext> {
  workflowCheckpoints: WorkflowCheckpointStore
}

export interface ConversationChatWorkflowReplyRunStartInput extends Omit<
  StartAssistantChatWorkflowRunInput<AssistantChatWorkflowAssembledContext>,
  'cancellationSignal'
> {
  runtime: ConversationChatWorkflowReplyRuntime
  controller: AbortController
}

export interface ConversationChatWorkflowReplyActiveStream {
  controller: AbortController
  messageId: string
  done?: Promise<void>
  flush?: () => void
}

export interface ConversationChatWorkflowReplyActivityStartInput {
  kind: 'chat-workflow'
  conversationId: string
  messageId: string
  title: string
  metadata: {
    requestedOutput: ConversationChatWorkflowRuntimeRequestedOutput
  }
}

export interface ConversationChatWorkflowReplyActivityFinishUpdates {
  error?: string
  metadata?: Record<string, unknown>
}

export interface ConversationChatWorkflowReplyStartDependencies {
  clock: Clock
  createMessageId(): string
  createTraceId(prefix: string): string
  createAbortController(): AbortController
  stopConversation(conversationId: string): void
  addMessage(conversationId: string, message: Message): void
  getConversation(conversationId: string): Conversation | undefined
  getMessage(conversationId: string, messageId: string): Message | undefined
  updateMessage(
    conversationId: string,
    messageId: string,
    updates: Partial<Message>,
  ): void
  removeMessage(conversationId: string, messageId: string): void
  startConversationTaskActivity(input: ConversationChatWorkflowReplyActivityStartInput, now: number): void
  bindConversationTaskCancellation(input: {
    conversationId: string
    messageId: string
    assistantRunId: string
    requestCancellation(): Promise<ConversationTaskCancellationAuthorityStatus>
  }): () => void
  finishConversationTaskActivity(
    conversationId: string,
    messageId: string,
    status: 'done' | 'failed' | 'cancelled',
    updates?: ConversationChatWorkflowReplyActivityFinishUpdates,
  ): void
  getActiveStream(
    conversationId: string,
  ): ConversationChatWorkflowReplyActiveStream | undefined
  setActiveStream(
    conversationId: string,
    stream: ConversationChatWorkflowReplyActiveStream,
  ): void
  clearActiveStream(conversationId: string): void
  commitStreamingText(conversationId: string, messageId: string): void
  commitStreamingTraces(conversationId: string, messageId: string): void
  clearStreaming(conversationId: string, messageId: string): void
  readSettings(): Settings
  resolveRunLimits(settings: Settings): ConversationChatWorkflowRuntimeRunLimits
  retrieveContext: ConversationChatWorkflowContextRetriever
  createChatWorkflowRuntime(): ConversationChatWorkflowReplyRuntime
  startChatWorkflowRun(
    input: ConversationChatWorkflowReplyRunStartInput,
  ): AssistantChatWorkflowRunHandle
  resolveChatWorkflowReply(
    input: ConversationChatWorkflowRuntimeInput,
  ): Promise<ConversationChatWorkflowRuntimeResolution>
  startOrdinaryReply(conversationId: string): Promise<void>
  classifyChatError(message: string): ChatErrorCode
  toUserFacingError(message: string): string
  sendFailedFallback(): string
  reportError(message: string): void
  buildEstimatedUsage(
    inputMessages: Message[],
    outputText: string,
  ): MessageUsage
  estimateTextTokens(text: string): number
}

export type ConversationChatWorkflowReplyStarter = (
  conversation: Conversation,
  content: string,
  options?: ConversationChatWorkflowReplyStartOptions,
) => Promise<void>

/**
 * Starts one structured Chat workflow after presentation has projected the user turn.
 * Durable recovery remains owned by the injected Chat workflow runtime; this use case
 * never retries or replays workflow side effects.
 */
export function createConversationChatWorkflowReplyStarter(
  dependencies: ConversationChatWorkflowReplyStartDependencies,
): ConversationChatWorkflowReplyStarter {
  return async (
    conversation: Conversation,
    content: string,
    options: ConversationChatWorkflowReplyStartOptions = {},
  ): Promise<void> => {
    dependencies.stopConversation(conversation.id)

    const startedAt = dependencies.clock.now()
    const assistantMessage: Message = {
      id: dependencies.createMessageId(),
      role: 'assistant',
      providerId: conversation.providerId,
      model: conversation.model,
      content: '',
      responseText: '',
      timestamp: startedAt,
      status: 'streaming',
      startedAt,
      reasoning: [
        {
          id: dependencies.createTraceId('agent-runtime'),
          type: 'system',
          title: 'Chat workflow',
          content: 'Chat workflow is running.',
          status: 'running',
          startedAt,
        },
      ],
    }

    dependencies.addMessage(conversation.id, assistantMessage)
    dependencies.startConversationTaskActivity(
      {
        kind: 'chat-workflow',
        conversationId: conversation.id,
        messageId: assistantMessage.id,
        title: 'Chat workflow',
        metadata: { requestedOutput: options.requestedOutput ?? 'auto' },
      },
      startedAt,
    )

    const requestController = dependencies.createAbortController()
    dependencies.setActiveStream(conversation.id, {
      controller: requestController,
      messageId: assistantMessage.id,
    })
    let releaseTaskCancellation = (): void => undefined

    try {
      const settings = dependencies.readSettings()
      const requestMessage = [...conversation.messages]
        .reverse()
        .find((message) => message.role === 'user')
      const runtime = dependencies.createChatWorkflowRuntime()
      const handle = dependencies.startChatWorkflowRun({
        runtime,
        controller: requestController,
        conversationId: conversation.id,
        conversationMessageIds: conversation.messages.map(
          (message) => message.id,
        ),
        ...(requestMessage ? { requestMessageId: requestMessage.id } : {}),
        requestText: content,
        responseMessageId: assistantMessage.id,
        executor: {
          execute: async ({ run, signal }) => {
            const resolution = await dependencies.resolveChatWorkflowReply({
              conversation,
              content,
              assistantRunId: run.id,
              workflowCheckpointStore: runtime.workflowCheckpoints,
              explicitToolRequest: options.explicitToolRequest,
              workflowId: options.workflowId,
              requestedOutput: options.requestedOutput,
              settings,
              manifests: options.manifests,
              enabledWorkflowIds: options.enabledWorkflowIds,
              blockedWorkflowStates: options.blockedWorkflowStates,
              limits: options.limits ?? dependencies.resolveRunLimits(settings),
              retrieveContext: dependencies.retrieveContext,
              startedAt,
              intentVisible: true,
              userConfirmed: options.userConfirmed,
              signal,
            })

            if (
              isReplyCancelled(
                dependencies,
                conversation.id,
                assistantMessage.id,
                requestController,
              )
            ) {
              return { outputText: '', eventCount: 0 }
            }

            if (resolution.handled && resolution.patch) {
              projectChatWorkflowReplyPatch(
                dependencies,
                conversation.id,
                assistantMessage.id,
                resolution.patch,
              )
              const terminalStatus =
                resolution.patch.status === 'error'
                  ? 'failed'
                  : resolution.patch.status === 'cancelled'
                    ? 'cancelled'
                    : 'done'
              dependencies.finishConversationTaskActivity(
                conversation.id,
                assistantMessage.id,
                terminalStatus,
                {
                  ...(terminalStatus === 'failed'
                    ? { error: resolution.reply.content }
                    : {}),
                  metadata: { handled: true, assistantRunId: run.id },
                },
              )
              const workflowEventCount = resolution.reply.run?.steps.length ?? 0
              if (resolution.patch.status === 'error') {
                return {
                  outputText: resolution.reply.content,
                  eventCount: workflowEventCount,
                  outcome: 'failed' as const,
                  failureMessage: `Chat workflow failed: ${resolution.reply.failureCode ?? 'execution_failed'}.`,
                }
              }
              return {
                outputText: resolution.reply.content,
                eventCount: workflowEventCount,
              }
            }

            dependencies.clearActiveStream(conversation.id)
            dependencies.finishConversationTaskActivity(
              conversation.id,
              assistantMessage.id,
              'cancelled',
              {
                metadata: {
                  reason: 'delegated_to_chat_reply',
                  assistantRunId: run.id,
                },
              },
            )
            dependencies.removeMessage(conversation.id, assistantMessage.id)
            void dependencies
              .startOrdinaryReply(conversation.id)
              .catch((error: unknown) => {
                const message =
                  error instanceof Error
                    ? error.message
                    : dependencies.sendFailedFallback()
                dependencies.reportError(message)
              })
            return { outputText: '', eventCount: 0 }
          },
        },
      })
      releaseTaskCancellation = dependencies.bindConversationTaskCancellation({
        conversationId: conversation.id,
        messageId: assistantMessage.id,
        assistantRunId: handle.runId,
        requestCancellation: () => requestChatWorkflowCancellation(
          runtime,
          handle,
          requestController,
        ),
      })

      dependencies.setActiveStream(conversation.id, {
        controller: requestController,
        messageId: assistantMessage.id,
        done: handle.completion.then(() => undefined),
      })
      const completed = await handle.completion
      if (
        !completed.ok &&
        !requestController.signal.aborted &&
        dependencies.getMessage(conversation.id, assistantMessage.id)
          ?.status === 'streaming'
      ) {
        finishWithError(
          dependencies,
          conversation.id,
          assistantMessage.id,
          dependencies.toUserFacingError(completed.error.message),
          dependencies.classifyChatError(completed.error.message),
        )
      }
    } catch (error) {
      if (
        requestController.signal.aborted ||
        dependencies.getMessage(conversation.id, assistantMessage.id)
          ?.status === 'cancelled'
      ) {
        return
      }
      const message =
        error instanceof Error
          ? error.message
          : dependencies.sendFailedFallback()
      finishWithError(
        dependencies,
        conversation.id,
        assistantMessage.id,
        dependencies.toUserFacingError(message),
        dependencies.classifyChatError(message),
      )
    } finally {
      releaseTaskCancellation()
      if (
        dependencies.getActiveStream(conversation.id)?.messageId ===
        assistantMessage.id
      ) {
        dependencies.clearActiveStream(conversation.id)
      }
    }
  }
}

async function requestChatWorkflowCancellation(
  runtime: ConversationChatWorkflowReplyRuntime,
  handle: AssistantChatWorkflowRunHandle,
  requestController: AbortController,
): Promise<ConversationTaskCancellationAuthorityStatus> {
  const requested = await runtime.cancel(handle.runId)
  if (!requested.ok) {
    if (requested.error.code === 'run_not_active') return 'unavailable'
    if (requested.error.code !== 'run_not_found') return 'failed'
  }

  requestController.abort()
  const completed = await handle.completion
  if (
    (!completed.ok && completed.error.code === 'cancelled')
    || (completed.ok && completed.value.status === 'cancelled')
  ) {
    return 'cancelled'
  }
  return requested.ok ? 'failed' : 'unavailable'
}

function projectChatWorkflowReplyPatch(
  dependencies: ConversationChatWorkflowReplyStartDependencies,
  conversationId: string,
  messageId: string,
  patch: NonNullable<ConversationChatWorkflowRuntimeResolution['patch']>,
): void {
  const durationMs = patch.durationMs ?? 0
  dependencies.updateMessage(conversationId, messageId, {
    content: patch.content,
    responseText: patch.responseText,
    status: patch.status,
    errorCode: patch.errorCode,
    startedAt: Math.max(0, patch.completedAt - durationMs),
    completedAt: patch.completedAt,
    durationMs,
    reasoning: patch.reasoning,
    retrievalTrace: patch.retrievalTrace,
    toolCalls: patch.toolCalls,
    usage: patch.usage,
    estimatedTokens: patch.usage.source === 'estimated',
    tokenCount: patch.tokenCount,
  })
}

function finishWithError(
  dependencies: ConversationChatWorkflowReplyStartDependencies,
  conversationId: string,
  messageId: string,
  content: string,
  errorCode: ChatErrorCode,
): void {
  const active = dependencies.getActiveStream(conversationId)
  if (active?.messageId === messageId) {
    active.flush?.()
    dependencies.clearActiveStream(conversationId)
  }
  dependencies.commitStreamingText(conversationId, messageId)
  dependencies.commitStreamingTraces(conversationId, messageId)
  const current = dependencies.getMessage(conversationId, messageId)
  const conversation = dependencies.getConversation(conversationId)
  const inputMessages =
    conversation?.messages.filter(
      (message) => message.id !== messageId && message.status !== 'error',
    ) ?? []
  const completedAt = dependencies.clock.now()
  const outputText = content || current?.content || ''
  dependencies.updateMessage(conversationId, messageId, {
    status: 'error',
    content: outputText,
    responseText: outputText,
    errorCode,
    errorProviderId: undefined,
    completedAt,
    durationMs: current?.startedAt
      ? completedAt - current.startedAt
      : current?.durationMs,
    usage: dependencies.buildEstimatedUsage(inputMessages, outputText),
    estimatedTokens: true,
    tokenCount: dependencies.estimateTextTokens(outputText),
  })
  dependencies.clearStreaming(conversationId, messageId)
  dependencies.finishConversationTaskActivity(conversationId, messageId, 'failed', {
    error: content,
    metadata: { errorCode, providerId: undefined },
  })
  dependencies.reportError(content)
}

function isReplyCancelled(
  dependencies: Pick<ConversationChatWorkflowReplyStartDependencies, 'getMessage'>,
  conversationId: string,
  messageId: string,
  controller: AbortController,
): boolean {
  if (controller.signal.aborted) return true
  return (
    dependencies.getMessage(conversationId, messageId)?.status === 'cancelled'
  )
}
