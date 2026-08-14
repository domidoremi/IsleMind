import type { TFunction } from 'i18next'

import type { Message } from '@/types/chatContracts'

const MESSAGE_QUOTE_DRAFT_LIMIT = 6000

export function isMessageSelectable(message: Message): boolean {
  return message.status !== 'sending' && message.status !== 'streaming'
}

export function toggleSelectedMessageIds(current: ReadonlySet<string>, messageId: string): Set<string> {
  const next = new Set(current)
  if (next.has(messageId)) next.delete(messageId)
  else next.add(messageId)
  return next
}

export function buildSelectedMessagesExportFileName(conversationTitle: string | undefined, conversationId: string): string {
  const safeTitle = (conversationTitle || conversationId).replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || conversationId
  return `${safeTitle}-messages.md`
}

function messageFinalText(message: Message): string {
  return (message.responseText ?? message.content ?? '').trim()
}

function messageRoleLabel(message: Message, t: TFunction): string {
  return message.role === 'user'
    ? t('messageBubble.roleUser')
    : t('messageBubble.roleAssistant')
}

function limitMessageTextForDraft(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit).trimEnd()}\n\n…`
}

export function buildQuotedMessageDraft(message: Message, t: TFunction): string {
  const role = messageRoleLabel(message, t)
  const text = limitMessageTextForDraft(messageFinalText(message) || t('messageBubble.emptyResponse'), MESSAGE_QUOTE_DRAFT_LIMIT)
  const quoted = text.split(/\r\n|\r|\n/).map((line) => `> ${line}`).join('\n')
  return `${t('messageBubble.quoteDraftHeader', { role })}\n${quoted}\n\n`
}

export function formatSelectedMessagesForExport(messages: Message[], t: TFunction): string {
  return messages.map((message, index) => {
    const role = messageRoleLabel(message, t)
    const timestamp = new Date(message.timestamp).toLocaleString()
    const body = messageFinalText(message) || t('messageBubble.emptyResponse')
    return `## ${index + 1}. ${role} · ${timestamp}\n\n${body}`
  }).join('\n\n---\n\n')
}
