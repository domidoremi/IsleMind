import {
  CHAT_MULTIMODAL_ENTRIES,
  type ChatMultimodalPolicy,
} from '@/presentation/features/chat/chatMultimodalPolicy'

export function shouldRenderChatSetupBoundaryStatus(
  policy: Pick<ChatMultimodalPolicy, 'entries'>,
): boolean {
  return CHAT_MULTIMODAL_ENTRIES.some(
    (entry) => policy.entries[entry].source !== 'provider-missing',
  )
}
