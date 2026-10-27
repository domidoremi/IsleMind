import type { Conversation, Message } from '@/types/chatContracts'

export interface ConversationActionToolRequest {
  toolId?: string
  name?: string
  source?: string
  serverId?: string
  arguments?: Record<string, unknown>
}

export interface ConversationActionPendingAction<
  TRequest extends ConversationActionToolRequest = ConversationActionToolRequest,
> {
  id: string
  toolName?: string
  toolId?: string
  serverId?: string
  source?: string
  permission?: string
  confirmable: boolean
  resumeToolRequest?: TRequest
}

export interface ConversationActionConfirmationControllerDependencies<
  TRequest extends ConversationActionToolRequest,
  TPendingAction extends ConversationActionPendingAction<TRequest>,
  TToolManifest,
  TRunLimits,
> {
  getConversation(conversationId: string): Conversation | undefined
  getPendingAction(message: Message): TPendingAction | undefined
  listToolManifests(): Promise<TToolManifest[]>
  resolveConfirmedTool(input: {
    pendingAction: TPendingAction
    manifests: TToolManifest[]
  }): TToolManifest | undefined
  getRunLimits(): TRunLimits
  stopConversation(conversationId: string): void | Promise<void>
  removeMessage(conversationId: string, messageId: string): void
  startWorkflowReply(
    conversation: Conversation,
    content: string,
    options: {
      explicitToolRequest: TRequest
      limits: TRunLimits
      userConfirmed: true
    },
  ): Promise<void>
}

export interface ConversationActionConfirmationController {
  confirm(conversationId: string, assistantMessageId: string, signal?: AbortSignal): Promise<boolean>
}

interface ConfirmationTarget<
  TRequest extends ConversationActionToolRequest,
  TPendingAction extends ConversationActionPendingAction<TRequest>,
> {
  assistantIndex: number
  assistantMessage: Pick<Message, 'id' | 'timestamp'>
  lastNonCancelledMessageId: string
  pendingAction: TPendingAction
  previousUser: Pick<Message, 'id' | 'content' | 'timestamp'>
  request: TRequest
  context: Omit<Conversation, 'messages' | 'updatedAt'>
  remainingMessages: Message[]
}

/**
 * Presentation-owned confirmation transition. All mutable stores, registry
 * lookups, settings, cancellation, and durable workflow startup stay injected.
 */
export function createConversationActionConfirmationController<
  TRequest extends ConversationActionToolRequest,
  TPendingAction extends ConversationActionPendingAction<TRequest>,
  TToolManifest,
  TRunLimits,
>(
  dependencies: ConversationActionConfirmationControllerDependencies<
    TRequest,
    TPendingAction,
    TToolManifest,
    TRunLimits
  >,
): ConversationActionConfirmationController {
  const confirming = new Set<string>()

  function readTarget(conversation: Conversation, assistantMessageId: string): ConfirmationTarget<TRequest, TPendingAction> | undefined {
    const assistantIndex = conversation.messages.findIndex((message) => message.id === assistantMessageId)
    const assistantMessage = assistantIndex >= 0 ? conversation.messages[assistantIndex] : undefined
    if (!assistantMessage || assistantMessage.role !== 'assistant' || assistantMessage.status === 'cancelled') return undefined
    if (conversation.messages.slice(assistantIndex + 1).some((message) => message.status !== 'cancelled')) return undefined

    const pendingAction = dependencies.getPendingAction(assistantMessage)
    const request = pendingAction?.resumeToolRequest
    if (!pendingAction?.confirmable || !request) return undefined

    const previousUser = [...conversation.messages.slice(0, assistantIndex)]
      .reverse()
      .find((message) => message.role === 'user')
    if (!previousUser) return undefined

    const lastNonCancelledMessage = [...conversation.messages]
      .reverse()
      .find((message) => message.status !== 'cancelled')
    if (!lastNonCancelledMessage || lastNonCancelledMessage.id !== assistantMessage.id) return undefined

    return {
      assistantIndex,
      assistantMessage: { id: assistantMessage.id, timestamp: assistantMessage.timestamp },
      lastNonCancelledMessageId: lastNonCancelledMessage.id,
      pendingAction: snapshotJsonValue(pendingAction),
      previousUser: { id: previousUser.id, content: previousUser.content, timestamp: previousUser.timestamp },
      request: snapshotJsonValue(request),
      context: snapshotConversationContext(conversation),
      remainingMessages: snapshotJsonValue(conversation.messages.filter(message => message.id !== assistantMessageId)),
    }
  }

  return {
    async confirm(conversationId, assistantMessageId, signal) {
      if (signal?.aborted || confirming.has(conversationId)) return false
      confirming.add(conversationId)
      try {
        const initialConversation = dependencies.getConversation(conversationId)
        if (!initialConversation) return false
        const initial = readTarget(initialConversation, assistantMessageId)
        if (!initial) return false

        const manifests = await dependencies.listToolManifests()

        // Capture consent by value and revalidate after each asynchronous owner.
        if (signal?.aborted) return false
        const currentConversation = dependencies.getConversation(conversationId)
        if (!currentConversation) return false
        const current = readTarget(currentConversation, assistantMessageId)
        if (!current || !sameConfirmationTarget(initial, current)) return false
        if (!dependencies.resolveConfirmedTool({
          pendingAction: current.pendingAction,
          manifests,
        })) return false

        if (signal?.aborted) return false
        await dependencies.stopConversation(conversationId)
        if (signal?.aborted) return false
        const stoppedConversation = dependencies.getConversation(conversationId)
        const stopped = stoppedConversation && readTarget(stoppedConversation, assistantMessageId)
        if (!stopped || !sameConfirmationTarget(initial, stopped)) return false

        dependencies.removeMessage(conversationId, initial.assistantMessage.id)
        const nextConversation = dependencies.getConversation(conversationId)
        if (!nextConversation || signal?.aborted
          || !sameJsonValue(initial.context, snapshotConversationContext(nextConversation))
          || !sameJsonValue(initial.remainingMessages, nextConversation.messages)) return false

        const limits = dependencies.getRunLimits()
        if (signal?.aborted) return false
        await dependencies.startWorkflowReply(nextConversation, initial.previousUser.content, {
          explicitToolRequest: initial.request,
          limits,
          userConfirmed: true,
        })
        return true
      } finally {
        confirming.delete(conversationId)
      }
    },
  }
}

function sameConfirmationTarget<
  TRequest extends ConversationActionToolRequest,
  TPendingAction extends ConversationActionPendingAction<TRequest>,
>(left: ConfirmationTarget<TRequest, TPendingAction>, right: ConfirmationTarget<TRequest, TPendingAction>): boolean {
  return left.assistantIndex === right.assistantIndex
    && left.lastNonCancelledMessageId === right.lastNonCancelledMessageId
    && left.assistantMessage.id === right.assistantMessage.id
    && left.assistantMessage.timestamp === right.assistantMessage.timestamp
    && left.previousUser.id === right.previousUser.id
    && left.previousUser.content === right.previousUser.content
    && left.previousUser.timestamp === right.previousUser.timestamp
    && left.pendingAction.id === right.pendingAction.id
    && left.pendingAction.confirmable === right.pendingAction.confirmable
    && left.pendingAction.toolId === right.pendingAction.toolId
    && left.pendingAction.toolName === right.pendingAction.toolName
    && left.pendingAction.serverId === right.pendingAction.serverId
    && left.pendingAction.source === right.pendingAction.source
    && left.pendingAction.permission === right.pendingAction.permission
    && sameJsonValue(left.pendingAction, right.pendingAction)
    && sameToolRequest(left.request, right.request)
    && sameJsonValue(left.context, right.context)
    && sameJsonValue(left.remainingMessages, right.remainingMessages)
}

function snapshotConversationContext(conversation: Conversation): Omit<Conversation, 'messages' | 'updatedAt'> {
  const { messages: _messages, updatedAt: _updatedAt, ...context } = conversation
  return snapshotJsonValue(context)
}

function snapshotJsonValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map(snapshotJsonValue) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshotJsonValue(item)])) as T
  }
  return value
}

function sameToolRequest(left: ConversationActionToolRequest, right: ConversationActionToolRequest): boolean {
  return left.toolId === right.toolId
    && left.name === right.name
    && left.source === right.source
    && left.serverId === right.serverId
    && sameJsonValue(left.arguments, right.arguments)
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => sameJsonValue(value, right[index]))
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false

  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord).sort()
  const rightKeys = Object.keys(rightRecord).sort()
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && sameJsonValue(leftRecord[key], rightRecord[key]))
}
