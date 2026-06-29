import type { Message } from '@/types'
import { st } from '@/i18n/service'

export function internalOutputHiddenMessage(): string {
  return st(
    'chatRunner.error.internalOutputHidden',
    undefined,
    '这条回复包含内部工具输出，已隐藏。请重新发送问题。'
  )
}

export function isInternalChatDiagnosticOutput(value: string | undefined): boolean {
  const text = normalizeDiagnosticText(value)
  if (!text) return false
  if (formatAndroidIntentDiagnosticOutput(text)) return true
  if (/IsleMind mobile runtime\.\s*MCP stdio is disabled/i.test(text)) return true
  if (/"contextPrompt"\s*:|"missingEvidence"\s*:|"fallbackReasons"\s*:/.test(text)) return true
  if (/^\{[\s\S]*\}$/.test(text) && /"theme(Id)?"\s*:|"memoryEnabled"\s*:|"knowledgeEnabled"\s*:|"mcpEnabled"\s*:/.test(text)) return true
  if (!/^\{[\s\S]*\}$/.test(text)) return false
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    return Boolean(
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      (
        'contextPrompt' in parsed ||
        'missingEvidence' in parsed ||
        'fallbackReasons' in parsed ||
        ('sourceCount' in parsed && 'citationCount' in parsed && 'confidence' in parsed)
      )
    )
  } catch {
    return false
  }
}

export function sanitizeInternalChatOutputText(value: string | undefined): string {
  const text = value ?? ''
  const androidIntentOutput = formatAndroidIntentDiagnosticOutput(normalizeDiagnosticText(text))
  if (androidIntentOutput) return androidIntentOutput
  return isInternalChatDiagnosticOutput(text) ? internalOutputHiddenMessage() : text
}

export function sanitizeMessageInternalOutput(message: Message): Message {
  if (message.role !== 'assistant') return message
  const contentReplacement = formatAndroidIntentDiagnosticOutput(normalizeDiagnosticText(message.content))
  const responseReplacement = formatAndroidIntentDiagnosticOutput(normalizeDiagnosticText(message.responseText))
  const contentInternal = isInternalChatDiagnosticOutput(message.content)
  const responseInternal = isInternalChatDiagnosticOutput(message.responseText)
  if (!contentInternal && !responseInternal) return message
  const fallback = internalOutputHiddenMessage()
  const replacement = responseReplacement ?? contentReplacement ?? fallback
  return {
    ...message,
    content: contentReplacement ?? (contentInternal ? fallback : message.content),
    responseText: responseInternal || contentInternal ? replacement : message.responseText,
  }
}

function normalizeDiagnosticText(value: string | undefined): string {
  const text = (value ?? '').trim()
  if (!text) return ''
  return text
    .replace(/^```(?:json|jsonc)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

function formatAndroidIntentDiagnosticOutput(text: string): string | undefined {
  const record = parseDiagnosticObject(text)
  if (!record || (record.opened !== true && record.requestSent !== true) || typeof record.target !== 'string') return undefined
  switch (record.target) {
    case 'alarm': {
      const hour = readInteger(record.hour, 0, 23)
      const minutes = readInteger(record.minutes, 0, 59)
      if (hour === undefined || minutes === undefined) return undefined
      const message = readOptionalText(record.message)
      const messageSuffix = message
        ? st('androidTool.alarmMessageSuffix', { message }, ' with label "{{message}}"')
        : ''
      if (record.requestSent === true && record.requiresExternalConfirmation !== true) {
        return st(
          'androidTool.alarmCreationRequested',
          { time: formatClockTime(hour, minutes), messageSuffix },
          'Android Clock alarm creation was requested for {{time}}{{messageSuffix}}. If the Clock app still shows an editor, confirm it there.'
        )
      }
      return st(
        'androidTool.alarmIntentOpened',
        { time: formatClockTime(hour, minutes), messageSuffix },
        'Android Clock is open for {{time}}{{messageSuffix}}. Confirm it in the system Clock app to create the alarm.'
      )
    }
    case 'calendar-event': {
      const title = readOptionalText(record.title)
      if (!title) return undefined
      return st(
        'androidTool.calendarEventIntentOpened',
        { title, time: formatDiagnosticDateTime(record.beginTimeMs, record.beginTimeIso) },
        'Android Calendar is open for "{{title}}" at {{time}}. Confirm it in the system Calendar app to create the event.'
      )
    }
    case 'calendar-todo': {
      const title = readOptionalText(record.title)
      if (!title) return undefined
      return st(
        'androidTool.reminderIntentOpened',
        { title, time: formatDiagnosticDateTime(record.dueTimeMs, record.dueTimeIso) },
        'Android Calendar is open for the reminder "{{title}}" due {{time}}. Confirm it in the system app to create it.'
      )
    }
    default:
      return undefined
  }
}

function parseDiagnosticObject(text: string): Record<string, unknown> | undefined {
  if (!/^\{[\s\S]*\}$/.test(text)) return undefined
  try {
    const parsed = JSON.parse(text) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

function readInteger(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) return undefined
  return value
}

function readOptionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function formatClockTime(hour: number, minutes: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function formatDiagnosticDateTime(timestampMs: unknown, iso: unknown): string {
  if (typeof iso === 'string' && iso.trim()) return iso.trim()
  if (typeof timestampMs === 'number' && Number.isFinite(timestampMs)) {
    const date = new Date(timestampMs)
    if (Number.isFinite(date.getTime())) return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')
  }
  return st('androidTool.unspecifiedTime', undefined, 'the requested time')
}
