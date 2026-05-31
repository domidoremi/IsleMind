import type { Attachment } from '@/types'
import type { PayloadPolicyMode } from '@/types'

export type PayloadRuleId = 'empty_messages' | 'oversized_body' | 'attachment_base64' | 'too_many_messages'

export interface PayloadRuleInput {
  body: unknown
  messages: { role: string; content: unknown }[]
  attachments?: Attachment[]
  mode?: PayloadPolicyMode
  maxBodyBytes?: number
  maxMessages?: number
}

export interface PayloadRuleFinding {
  id: PayloadRuleId
  severity: 'warn' | 'block'
  message: string
  value?: number
  limit?: number
}

export interface PayloadRuleResult {
  mode: PayloadPolicyMode
  blocked: boolean
  findings: PayloadRuleFinding[]
  bodyKeys: string[]
  messageCount: number
  attachmentCount: number
}

const DEFAULT_MAX_BODY_BYTES = 1800000
const DEFAULT_MAX_MESSAGES = 256

export function evaluatePayloadRules(input: PayloadRuleInput): PayloadRuleResult {
  const mode = input.mode ?? 'warn'
  const bodyKeys = input.body && typeof input.body === 'object' && !Array.isArray(input.body)
    ? Object.keys(input.body as Record<string, unknown>).sort()
    : []
  const messageCount = input.messages.length
  const attachmentCount = input.attachments?.length ?? 0
  const findings: PayloadRuleFinding[] = []
  if (!messageCount) {
    findings.push(finding('empty_messages', mode, 'payload has no chat messages'))
  }
  if (messageCount > (input.maxMessages ?? DEFAULT_MAX_MESSAGES)) {
    findings.push(finding('too_many_messages', mode, 'payload exceeds message count limit', messageCount, input.maxMessages ?? DEFAULT_MAX_MESSAGES))
  }
  const bodyBytes = estimateJsonBytes(input.body)
  if (bodyBytes > (input.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES)) {
    findings.push(finding('oversized_body', mode, 'payload exceeds body size limit', bodyBytes, input.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES))
  }
  if (attachmentCount && hasEmbeddedAttachmentData(input.body)) {
    findings.push(finding('attachment_base64', mode, 'payload contains inline attachment data', attachmentCount))
  }
  return {
    mode,
    blocked: mode === 'block' && findings.length > 0,
    findings,
    bodyKeys,
    messageCount,
    attachmentCount,
  }
}

function finding(id: PayloadRuleId, mode: PayloadPolicyMode, message: string, value?: number, limit?: number): PayloadRuleFinding {
  return { id, severity: mode === 'block' ? 'block' : 'warn', message, value, limit }
}

function estimateJsonBytes(value: unknown): number {
  try {
    return encodeURIComponent(JSON.stringify(value)).replace(/%[A-F\d]{2}/gi, 'x').length
  } catch {
    return 0
  }
}

function hasEmbeddedAttachmentData(value: unknown): boolean {
  try {
    return /data:[^;]+;base64,|file_data|image_url/i.test(JSON.stringify(value))
  } catch {
    return false
  }
}
