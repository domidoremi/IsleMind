import type { TFunction } from 'i18next'

import { containsSensitiveText, redactSensitiveText } from '@/core'
import type { Message } from '@/types/chatContracts'
import { safeHttpUrl } from '@/utils/sourceUrlSafety'

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

function formatSourceTitle(title: string): string {
  const text = redactSensitiveText(title)
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/g, ' ')
    .trim()
  if (!text) return ''
  // Code spans keep even linkified URLs and raw HTML in a title inert. A longer
  // delimiter plus padding also preserves titles containing their own backticks.
  const longestBackticks = (text.match(/`+/g) ?? []).reduce((longest, run) => Math.max(longest, run.length), 0)
  const delimiter = '`'.repeat(longestBackticks + 1)
  return `${delimiter} ${text} ${delimiter}`
}

function formatMessageSources(message: Message, t: TFunction): string {
  if (!message.citations?.length) return ''
  // Match the source reader's retained order, without global Markdown reference
  // definitions that could rebind another message's [1]. Never read source bodies.
  const sources = message.citations.map((citation, index) => {
    const title = formatSourceTitle(citation.title) || t('source.capturedCitation')
    const url = safeHttpUrl(citation.url)
    const link = url && !containsSensitiveText(url)
      ? `<${new URL(url).href}>`
      : t('messageBubble.exportSourceNoLink')
    return `- \\[${index + 1}\\] ${title} — ${t(`source.${citation.type}`)}\n  ${link}`
  })
  return `\n\n### ${t('messageBubble.exportSourcesTitle')}\n\n${t('messageBubble.exportSourcesNotice')}\n\n${sources.join('\n')}`
}

export function formatSelectedMessagesForExport(
  messages: Message[],
  t: TFunction,
  { includeSources = false }: { includeSources?: boolean } = {},
): string {
  return messages.map((message, index) => {
    const role = messageRoleLabel(message, t)
    const timestamp = new Date(message.timestamp).toLocaleString()
    const body = messageFinalText(message) || t('messageBubble.emptyResponse')
    return `## ${index + 1}. ${role} · ${timestamp}\n\n${body}${includeSources ? formatMessageSources(message, t) : ''}`
  }).join('\n\n---\n\n')
}
