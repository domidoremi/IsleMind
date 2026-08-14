import type { TFunction } from 'i18next'

import type { Conversation } from '@/types/chatContracts'

export function getProviderHeaderState(
  conversation: Conversation,
  t: TFunction
): { title: string } {
  return {
    title: conversation.title.trim() || t('chat.startChat'),
  }
}
