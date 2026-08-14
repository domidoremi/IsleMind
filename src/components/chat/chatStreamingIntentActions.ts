import { useCallback, useEffect } from 'react'

import type { ConversationChatWorkflowRuntimeRequestedOutput } from '@/modules/tasks'
import type { Attachment, Conversation } from '@/types/chatContracts'

import type { StreamingInputIntent } from './StreamingIntentSheet'

const STREAMING_INTERRUPT_REPLAY_DELAY_MS = 30

export interface PendingStreamingMessage {
  intent: Exclude<StreamingInputIntent, 'interrupt'>
  content: string
  attachments: Attachment[]
  requestedOutput: ConversationChatWorkflowRuntimeRequestedOutput
}

export interface IntentDraft {
  content: string
  attachments: Attachment[]
  requestedOutput: ConversationChatWorkflowRuntimeRequestedOutput
}

type ApplyStarterDraft = (draft: string, attachments?: Attachment[], restoreIfEmpty?: boolean) => void

type SendStreamingMessage = (input: {
  conversation: Conversation
  content: string
  attachments: Attachment[]
  requestedOutput: ConversationChatWorkflowRuntimeRequestedOutput
}) => Promise<unknown>

type ScrollToLatestMessage = (
  animated?: boolean,
  delay?: number,
  options?: { replacePending?: boolean; force?: boolean }
) => void

export interface ChatStreamingSubmitActions {
  submit: (content: string, attachments: Attachment[]) => Promise<void>
  submitWhileStreaming: (content: string, attachments: Attachment[]) => void
  cancelStreamingIntent: () => boolean
  applyStreamingIntent: (intent: StreamingInputIntent) => boolean
}

export function createStreamingIntentDraft({
  content,
  attachments,
  requestedOutput,
}: {
  content: string
  attachments: Attachment[]
  requestedOutput: ConversationChatWorkflowRuntimeRequestedOutput
}): IntentDraft {
  return { content, attachments, requestedOutput }
}

export function cancelStreamingIntentDraft({
  draft,
  onApplyStarter,
  setIntentDraft,
}: {
  draft: IntentDraft | null
  onApplyStarter: ApplyStarterDraft
  setIntentDraft: (draft: IntentDraft | null) => void
}): boolean {
  if (!draft) return false
  onApplyStarter(draft.content, draft.attachments, true)
  setIntentDraft(null)
  return true
}

export async function sendActiveChatMessage({
  attachments,
  content,
  conversation,
  requestedOutput,
  scrollToLatestMessage,
  sendMessage,
}: {
  attachments: Attachment[]
  content: string
  conversation: Conversation
  requestedOutput: ConversationChatWorkflowRuntimeRequestedOutput
  scrollToLatestMessage: ScrollToLatestMessage
  sendMessage: SendStreamingMessage
}): Promise<void> {
  scrollToLatestMessage(false, 0, { force: true, replacePending: true })
  await sendMessage({ conversation, content, attachments, requestedOutput })
}

export function usePendingStreamingMessageDispatch({
  active,
  conversation,
  isStreaming,
  onApplyStarter,
  pendingStreamingMessage,
  sendMessage,
  setPendingStreamingMessage,
}: {
  active: boolean
  conversation: Conversation | null | undefined
  isStreaming: boolean
  onApplyStarter: ApplyStarterDraft
  pendingStreamingMessage: PendingStreamingMessage | null
  sendMessage: SendStreamingMessage
  setPendingStreamingMessage: (message: PendingStreamingMessage | null) => void
}) {
  useEffect(() => {
    if (!active) return
    if (isStreaming || !pendingStreamingMessage || !conversation) return
    const queued = pendingStreamingMessage
    setPendingStreamingMessage(null)
    void sendMessage({
      conversation,
      content: queued.content,
      attachments: queued.attachments,
      requestedOutput: queued.requestedOutput,
    }).catch(() => {
      onApplyStarter(queued.content, queued.attachments, true)
    })
  }, [active, conversation, isStreaming, onApplyStarter, pendingStreamingMessage, sendMessage, setPendingStreamingMessage])
}

export function useChatStreamingSubmitActions({
  conversation,
  getLatestConversation,
  intentDraft,
  onApplyStarter,
  requestedOutput,
  scrollToLatestMessage,
  sendMessage,
  setIntentDraft,
  setPendingStreamingMessage,
  stopStreaming,
}: {
  conversation: Conversation
  getLatestConversation: (conversationId: string) => Conversation | undefined
  intentDraft: IntentDraft | null
  onApplyStarter: ApplyStarterDraft
  requestedOutput: ConversationChatWorkflowRuntimeRequestedOutput
  scrollToLatestMessage: ScrollToLatestMessage
  sendMessage: SendStreamingMessage
  setIntentDraft: (draft: IntentDraft | null) => void
  setPendingStreamingMessage: (message: PendingStreamingMessage | null) => void
  stopStreaming: (conversationId: string) => void
}): ChatStreamingSubmitActions {
  const scrollToSubmitTarget = useCallback(() => {
    scrollToLatestMessage(false, 0, { force: true, replacePending: true })
  }, [scrollToLatestMessage])

  const submit = useCallback(async (content: string, attachments: Attachment[]) => {
    await sendActiveChatMessage({
      attachments,
      content,
      conversation,
      requestedOutput,
      scrollToLatestMessage,
      sendMessage,
    })
  }, [conversation, requestedOutput, scrollToLatestMessage, sendMessage])

  const submitWhileStreaming = useCallback((content: string, attachments: Attachment[]) => {
    setIntentDraft(createStreamingIntentDraft({ content, attachments, requestedOutput }))
  }, [requestedOutput, setIntentDraft])

  const cancelStreamingIntent = useCallback(() => cancelStreamingIntentDraft({
    draft: intentDraft,
    onApplyStarter,
    setIntentDraft,
  }), [intentDraft, onApplyStarter, setIntentDraft])

  const applyStreamingIntent = useCallback((intent: StreamingInputIntent) => applyStreamingIntentDraft({
    conversation,
    draft: intentDraft,
    getLatestConversation,
    intent,
    onApplyStarter,
    scrollToLatestMessage: scrollToSubmitTarget,
    sendMessage,
    setIntentDraft,
    setPendingStreamingMessage,
    stopStreaming,
  }), [
    conversation,
    getLatestConversation,
    intentDraft,
    onApplyStarter,
    scrollToSubmitTarget,
    sendMessage,
    setIntentDraft,
    setPendingStreamingMessage,
    stopStreaming,
  ])

  return {
    applyStreamingIntent,
    cancelStreamingIntent,
    submit,
    submitWhileStreaming,
  }
}

export function applyStreamingIntentDraft({
  conversation,
  draft,
  getLatestConversation,
  intent,
  onApplyStarter,
  scrollToLatestMessage,
  sendMessage,
  setIntentDraft,
  setPendingStreamingMessage,
  stopStreaming,
  interruptReplayDelayMs = STREAMING_INTERRUPT_REPLAY_DELAY_MS,
}: {
  conversation: Conversation
  draft: IntentDraft | null
  getLatestConversation: (conversationId: string) => Conversation | undefined
  intent: StreamingInputIntent
  onApplyStarter: ApplyStarterDraft
  scrollToLatestMessage: () => void
  sendMessage: SendStreamingMessage
  setIntentDraft: (draft: IntentDraft | null) => void
  setPendingStreamingMessage: (message: PendingStreamingMessage | null) => void
  stopStreaming: (conversationId: string) => void
  interruptReplayDelayMs?: number
}): boolean {
  if (!draft) return false

  setIntentDraft(null)
  if (intent === 'interrupt') {
    scrollToLatestMessage()
    stopStreaming(conversation.id)
    setPendingStreamingMessage(null)
    setTimeout(() => {
      const latestConversation = getLatestConversation(conversation.id)
      if (!latestConversation) {
        onApplyStarter(draft.content, draft.attachments, true)
        return
      }
      void sendMessage({
        conversation: latestConversation,
        content: draft.content,
        attachments: draft.attachments,
        requestedOutput: draft.requestedOutput,
      }).catch(() => {
        onApplyStarter(draft.content, draft.attachments, true)
      })
    }, interruptReplayDelayMs)
    return true
  }

  scrollToLatestMessage()
  setPendingStreamingMessage({
    intent,
    content: draft.content,
    attachments: draft.attachments,
    requestedOutput: draft.requestedOutput,
  })
  return true
}
