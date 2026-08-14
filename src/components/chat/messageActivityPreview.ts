import type { TFunction } from 'i18next'

import type { Attachment, Message } from '@/types/chatContracts'

import { collectMessageTraces, getActiveTraceStageLabel, getActiveTraceTitle } from './tracePresentation'

const SYSTEM_STATUS_NOTIFICATION_PREVIEW_LIMIT = 96

export function getMessageActivityLabel(message: Message, t: TFunction, assistantDisplayName?: string): string {
  const traces = collectMessageTraces(message)
  const active = message.status === 'streaming' || message.status === 'sending'
  if (assistantDisplayName && active && traces.length === 0) {
    return getAssistantThinkingLabel(assistantDisplayName, t)
  }
  const stageLabel = getActiveTraceStageLabel(traces, message.status)
  if (stageLabel && active) {
    return t('messageBubble.traceGenerating', {
      title: stageLabel,
      defaultValue: `${stageLabel}...`,
    })
  }
  const activeTitle = getActiveTraceTitle(traces, message.status)
  if (activeTitle) return activeTitle
  if (assistantDisplayName && active) {
    return getAssistantThinkingLabel(assistantDisplayName, t)
  }
  return messageActivityStatusLabel(message, t)
}

export function getAssistantThinkingLabel(assistantDisplayName: string, t: TFunction): string {
  return t('messageBubble.namedThinking', {
    name: assistantDisplayName,
    defaultValue: `${assistantDisplayName} is thinking...`,
  })
}

function messageActivityStatusLabel(message: Message, t: TFunction): string {
  switch (message.status) {
    case 'sending':
      return t('chat.statusPreparing')
    case 'streaming':
      return t('chat.generating')
    case 'error':
      return t('messageBubble.failed')
    case 'cancelled':
      return t('messageBubble.stopped')
    case 'done':
      return t('common.done')
  }
}

export function previewSystemStatusMessage(message: Message, t: TFunction): string {
  const text = (message.responseText ?? message.content ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return messageActivityStatusLabel(message, t)
  return text.length > SYSTEM_STATUS_NOTIFICATION_PREVIEW_LIMIT
    ? `${text.slice(0, SYSTEM_STATUS_NOTIFICATION_PREVIEW_LIMIT - 1)}...`
    : text
}

export function previewPendingText(content: string, attachments: Attachment[], t: TFunction): string {
  const text = content.trim().replace(/\s+/g, ' ')
  const label = text ? (text.length > 24 ? `${text.slice(0, 24)}...` : text) : t('chat.attachmentMessage')
  return attachments.length ? `${label} · ${t('chat.attachmentCount', { count: attachments.length })}` : label
}

export function buildPendingStreamingNotice(
  pending: { intent: 'guide' | 'queue'; content: string; attachments: Attachment[] } | null | undefined,
  t: TFunction
): string | undefined {
  if (!pending) return undefined
  const intentLabel = pending.intent === 'guide' ? t('chat.pendingGuide') : t('chat.pendingQueue')
  return `${intentLabel} · ${previewPendingText(pending.content, pending.attachments, t)}`
}
