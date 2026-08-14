import type { Conversation, Message, MessageUsage } from '@/types/chatContracts'
import type { MessageCitation } from '@/types/contextContracts'
import type { ChatErrorCode } from '@/types/providerContracts'

type UsageInputMessage = Pick<Message, 'role' | 'content' | 'attachments'>

export interface ConversationAssistantMessageProjectionDependencies {
  buildEstimatedUsage(inputMessages: UsageInputMessage[], outputText: string): MessageUsage
  estimateTextTokens(text: string): number
}

export interface ConversationAssistantTaskCompletion {
  status: 'done' | 'failed'
  error?: string
  metadata: {
    providerId?: string
    model?: string
    outputTokens?: number
    totalTokens?: number
    errorCode?: ChatErrorCode
  }
}

export interface ConversationAssistantSuccessPlan {
  kind: 'project'
  messagePatch: Pick<Message, 'status' | 'content' | 'responseText' | 'citations' | 'completedAt' | 'durationMs' | 'estimatedTokens' | 'tokenCount'> & {
    usage: MessageUsage
  }
  taskCompletion: ConversationAssistantTaskCompletion
}

export interface ConversationAssistantFailurePlan {
  kind: 'project'
  messagePatch: Pick<Message, 'status' | 'content' | 'responseText' | 'errorCode' | 'errorProviderId' | 'completedAt' | 'durationMs' | 'estimatedTokens' | 'tokenCount'> & {
    usage: MessageUsage
  }
  taskCompletion: ConversationAssistantTaskCompletion
  error: string
}

export interface ConversationAssistantProjectionSkipped {
  kind: 'skip'
  reason: 'message_missing' | 'message_not_streaming' | 'message_cancelled'
}

export type ConversationAssistantSuccessOutcome = ConversationAssistantSuccessPlan | ConversationAssistantProjectionSkipped

export interface ConversationAssistantSuccessInput {
  conversation?: Pick<Conversation, 'messages'>
  message?: Message
  outputText: string
  citations: MessageCitation[]
  providerUsage?: MessageUsage
  providerId: string
  model: string
  completedAt: number
}

export interface ConversationAssistantFailureInput {
  conversation?: Pick<Conversation, 'messages'>
  message?: Message
  content: string
  errorCode: ChatErrorCode
  providerId?: string
  completedAt: number
}

export interface ConversationAssistantProjectionExecutorDependencies {
  flushActiveStream(): void
  commitStreamingText(): void
  commitStreamingTraces(): void
  updateMessage(patch: ConversationAssistantSuccessPlan['messagePatch'] | ConversationAssistantFailurePlan['messagePatch']): void
  clearStreaming(): void
  finishTask(completion: ConversationAssistantTaskCompletion): void
  reportError(error: ConversationAssistantFailurePlan['error']): void
}

export function createConversationAssistantProjectionExecutor(
  dependencies: ConversationAssistantProjectionExecutorDependencies,
) {
  return {
    commitSuccess(plan: ConversationAssistantSuccessPlan): void {
      dependencies.updateMessage(plan.messagePatch)
      dependencies.finishTask(plan.taskCompletion)
    },

    projectFailure(buildPlan: () => ConversationAssistantFailurePlan): ConversationAssistantFailurePlan {
      dependencies.flushActiveStream()
      dependencies.commitStreamingText()
      dependencies.commitStreamingTraces()
      const plan = buildPlan()
      dependencies.updateMessage(plan.messagePatch)
      dependencies.clearStreaming()
      dependencies.finishTask(plan.taskCompletion)
      dependencies.reportError(plan.error)
      return plan
    },
  }
}

export function createConversationAssistantMessageProjectionPolicy(
  dependencies: ConversationAssistantMessageProjectionDependencies,
) {
  return {
    buildSuccessPlan(input: ConversationAssistantSuccessInput): ConversationAssistantSuccessOutcome {
      const message = input.message
      if (!message) return { kind: 'skip', reason: 'message_missing' }
      if (message.status === 'cancelled') return { kind: 'skip', reason: 'message_cancelled' }
      if (message.status !== 'streaming') return { kind: 'skip', reason: 'message_not_streaming' }
      const inputMessages = selectUsageInputMessages(input.conversation, message.id)
      const usage = input.providerUsage?.source === 'provider'
        ? {
            ...input.providerUsage,
            totalTokens: input.providerUsage.totalTokens
              ?? (input.providerUsage.inputTokens ?? 0) + (input.providerUsage.outputTokens ?? 0),
          }
        : dependencies.buildEstimatedUsage(inputMessages, input.outputText)

      return {
        kind: 'project',
        messagePatch: {
          status: 'done',
          content: input.outputText,
          responseText: input.outputText,
          citations: input.citations.length ? [...input.citations] : message.citations,
          completedAt: input.completedAt,
          durationMs: message.startedAt ? input.completedAt - message.startedAt : undefined,
          usage,
          estimatedTokens: usage.source === 'estimated',
          tokenCount: usage.outputTokens ?? dependencies.estimateTextTokens(input.outputText),
        },
        taskCompletion: {
          status: 'done',
          metadata: {
            providerId: input.providerId,
            model: input.model,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
          },
        },
      }
    },

    buildFailurePlan(input: ConversationAssistantFailureInput): ConversationAssistantFailurePlan {
      const message = input.message
      const outputText = input.content || message?.content || ''
      const usage = dependencies.buildEstimatedUsage(
        selectUsageInputMessages(input.conversation, message?.id ?? ''),
        outputText,
      )

      return {
        kind: 'project',
        messagePatch: {
          status: 'error',
          content: outputText,
          responseText: outputText,
          errorCode: input.errorCode,
          errorProviderId: input.providerId,
          completedAt: input.completedAt,
          durationMs: message?.startedAt ? input.completedAt - message.startedAt : message?.durationMs,
          usage,
          estimatedTokens: true,
          tokenCount: dependencies.estimateTextTokens(outputText),
        },
        taskCompletion: {
          status: 'failed',
          error: input.content,
          metadata: { errorCode: input.errorCode, providerId: input.providerId },
        },
        error: input.content,
      }
    },
  }
}

function selectUsageInputMessages(
  conversation: Pick<Conversation, 'messages'> | undefined,
  responseMessageId: string,
): UsageInputMessage[] {
  return (conversation?.messages ?? [])
    .filter((message) => message.id !== responseMessageId && message.status !== 'error')
    .map(({ role, content, attachments }) => ({ role, content, attachments }))
}
