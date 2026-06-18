import type { Settings } from '@/types'
import { numberValue } from '@/services/ai/providerUsage'

export interface AnthropicRectificationInput {
  req: {
    settings?: Pick<Settings, 'requestRectificationEnabled' | 'anthropicThinkingSignatureRectificationEnabled' | 'anthropicThinkingBudgetRectificationEnabled'>
  }
  body: string
  errorText: string
  rectified?: boolean
  rectifiedSignature?: boolean
  rectifiedBudget?: boolean
}

export type AnthropicRectificationResult = { kind: 'thinking_signature' | 'thinking_budget'; body: Record<string, unknown> }

export function rectifyAnthropicRequestBody(input: AnthropicRectificationInput): AnthropicRectificationResult | undefined {
  if (input.req.settings?.requestRectificationEnabled !== true) return undefined
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(input.body) as Record<string, unknown>
  } catch {
    return undefined
  }
  const text = input.errorText.toLowerCase()
  const signatureEnabled = input.req.settings?.anthropicThinkingSignatureRectificationEnabled === true
  const budgetEnabled = input.req.settings?.anthropicThinkingBudgetRectificationEnabled === true
  const alreadyRectified = input.rectified === true
  if (signatureEnabled && !alreadyRectified && !input.rectifiedSignature && /thinking|signature|tool_use|invalid_request|invalid request/.test(text) && /signature|thinking/.test(text)) {
    return { kind: 'thinking_signature', body: stripThinkingBlocks(parsed) }
  }
  if (budgetEnabled && !alreadyRectified && !input.rectifiedBudget && /budget_tokens|thinking budget|at least 1024|minimum.*1024|1024/.test(text)) {
    return { kind: 'thinking_budget', body: normalizeAnthropicThinkingBudgetBody(parsed) }
  }
  return undefined
}

export function stripThinkingBlocks(body: Record<string, unknown>): Record<string, unknown> {
  const next = { ...body }
  delete next.thinking
  delete next.output_config
  next.messages = Array.isArray(next.messages)
    ? next.messages.map((message) => {
        if (!message || typeof message !== 'object') return message
        const record = message as Record<string, unknown>
        if (!Array.isArray(record.content)) return record
        return {
          ...record,
          content: record.content.filter((part) => !isThinkingContentPart(part)),
        }
      })
    : next.messages
  return next
}

export function normalizeAnthropicThinkingBudgetBody(body: Record<string, unknown>): Record<string, unknown> {
  return {
    ...body,
    thinking: { type: 'enabled', budget_tokens: 32000 },
    max_tokens: Math.max(numberValue(body.max_tokens) ?? 0, 64000),
  }
}

function isThinkingContentPart(part: unknown): boolean {
  if (!part || typeof part !== 'object') return false
  const type = stringValue((part as Record<string, unknown>).type).toLowerCase()
  return type.includes('thinking') || type.includes('signature')
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
