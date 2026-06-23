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
  if (/IsleMind mobile runtime\.\s*MCP stdio is disabled/i.test(text)) return true
  if (/"contextPrompt"\s*:|"missingEvidence"\s*:|"fallbackReasons"\s*:/.test(text)) return true
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
  return isInternalChatDiagnosticOutput(text) ? internalOutputHiddenMessage() : text
}

export function sanitizeMessageInternalOutput(message: Message): Message {
  if (message.role !== 'assistant') return message
  const contentInternal = isInternalChatDiagnosticOutput(message.content)
  const responseInternal = isInternalChatDiagnosticOutput(message.responseText)
  if (!contentInternal && !responseInternal) return message
  const fallback = internalOutputHiddenMessage()
  return {
    ...message,
    content: contentInternal ? fallback : message.content,
    responseText: responseInternal || contentInternal ? fallback : message.responseText,
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
