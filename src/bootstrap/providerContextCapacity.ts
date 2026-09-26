import { estimateTextTokens } from '@/core'
import type { AIProvider } from '@/types/providerContracts'
import { getModelConfig } from '@/types/modelCatalog'
import { checkProviderContextCapacity, ProviderContextCapacityError, getWireProviderType, providerContextOverflowMessage,
  resolveProviderLocalCompressionPrivacy, type ProviderRuntimeChatRequest, type ProviderRuntimeTraceCallback } from '@/modules/providers'
import { summarizeContextPackingHistory, UNTRUSTED_HISTORY_SUMMARY_PREAMBLE } from '@/modules/assistant-runtime'
import { assertExecutionResourcesAvailable } from './executionResources'
import { providerTokenCalibration } from './providerTokenCalibration'
import { providerRemoteCompactLifecycle } from './providerRemoteCompactLifecycle'
import { createProviderTrace } from './providerTracePolicy'

type WireBody = Record<string, unknown>
type RecoveryTrigger = 'local_capacity' | 'server_overflow'
const recoveryAttempts = new WeakMap<AbortSignal, Set<RecoveryTrigger>>()
const HISTORY_SUMMARY_PREFIX = '历史摘要\n'
const RECENT_MESSAGE_COUNT = 8

function parseWireBody(body: WireBody | string): WireBody {
  // Check before parsing, including opaque media. This is not a Hermes heap claim.
  if (typeof body !== 'string') return body
  if (body.length > 16 * 1024 * 1024) throw new ProviderContextCapacityError('request_too_large')
  const parsed: unknown = JSON.parse(body)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ProviderContextCapacityError('invalid_capacity')
  return parsed as WireBody
}

/** Strict gate for every fully assembled request, including retry/rectification bodies. */
export function checkFinalProviderRequestCapacity(input: {
  provider: AIProvider; model: string; body: WireBody | string
}) {
  assertExecutionResourcesAvailable()
  const body = parseWireBody(input.body)
  const capacity = getModelConfig(input.model, input.provider.type, input.provider.modelConfigs)
  const outputLimit = capacity.outputTokenLimit
  const wire = getWireProviderType(input.provider)
  const calibrationKey = JSON.stringify([input.provider.id, input.model, wire, Array.isArray(body.input) ? 'responses' : Array.isArray(body.contents) ? 'contents' : 'messages'])
  return { ...checkProviderContextCapacity({ body, providerType: wire, model: input.model,
    inputCalibrationFactor: providerTokenCalibration.factor(calibrationKey),
    contextWindow: capacity.contextWindow,
    // A remote model row may still contain inferred/clamped display defaults.
    // Only field-level provider/catalog evidence can bound an uncapped request.
    modelMaxOutputTokens: outputLimit?.source === 'provider' || outputLimit?.source === 'catalog'
      ? outputLimit.tokens : undefined }), calibrationKey }
}

export function providerCapacityCompressionAllowed(req: ProviderRuntimeChatRequest): boolean {
  return req.settings?.modelContextCompressionEnabled !== false
    && resolveProviderLocalCompressionPrivacy(req.settings).allowed
    && (!req.conversationId || !providerRemoteCompactLifecycle.getCompactionGuardState(req.conversationId).autoDisabled)
}

/**
 * One local repair and, independently, one server-overflow repair per dispatch
 * controller. HTTP, WebSocket and fallback routes share this budget. No model
 * call or tool execution occurs here; only plain old history is summarized.
 */
export function prepareFinalProviderRequestCapacity(input: {
  req: ProviderRuntimeChatRequest
  body: WireBody | string
  signal: AbortSignal
  onTrace?: ProviderRuntimeTraceCallback
  trigger?: RecoveryTrigger
}): { body: WireBody; capacity: ReturnType<typeof checkFinalProviderRequestCapacity>; compressed: boolean } {
  if (input.signal.aborted) throw input.signal.reason ?? new DOMException('Stopped', 'AbortError')
  assertExecutionResourcesAvailable()
  const body = parseWireBody(input.body)
  const check = (value: WireBody) => checkFinalProviderRequestCapacity({ provider: input.req.provider, model: input.req.model, body: value })
  const trigger = input.trigger ?? 'local_capacity'
  try {
    const capacity = check(body)
    if (trigger === 'local_capacity') return { body, capacity, compressed: false }
  } catch (error) {
    // Unknown media and hard envelope limits cannot be made safe by text packing.
    if (!(error instanceof ProviderContextCapacityError) || error.code !== 'context_capacity') throw error
  }
  const attempts = recoveryAttempts.get(input.signal) ?? new Set<RecoveryTrigger>()
  recoveryAttempts.set(input.signal, attempts)
  if (attempts.has(trigger) || !providerCapacityCompressionAllowed(input.req)) throw new ProviderContextCapacityError('context_capacity')
  attempts.add(trigger)
  const model = getModelConfig(input.req.model, input.req.provider.type, input.req.provider.modelConfigs)
  const recovered = summarizePlainHistory(body, Math.max(64, Math.min(
    trigger === 'server_overflow' ? 512 : 1024, Math.floor(model.contextWindow * 0.03),
  )))
  if (!recovered) throw new ProviderContextCapacityError('context_capacity')
  // A summary is not evidence of fit. Never dispatch until the rebuilt wire
  // envelope (tools, system, media, output reservation included) passes again.
  const capacity = check(recovered.body)
  input.onTrace?.(createProviderTrace('system', getWireProviderType(input.req.provider),
    'Context capacity recovery', 'Older plain-text history was locally summarized; the current turn and protocol state were preserved.',
    'done', `capacity-${trigger}`, { trigger, strategy: 'local-structured-v2', sourceMessageCount: recovered.count,
      estimatedSavedTokens: recovered.savedTokens, finalInputTokens: capacity.estimatedInputTokens, finalLimit: capacity.limit }))
  if (input.signal.aborted) throw input.signal.reason ?? new DOMException('Stopped', 'AbortError')
  return { body: recovered.body, capacity, compressed: true }
}

/** Only explicit context-window errors, not generic parameter or output-cap errors. */
export function isProviderContextOverflow(status: number | undefined, text: string): boolean {
  if (status !== undefined && ![400, 409, 413, 422].includes(status)) return false
  return providerContextOverflowMessage(text)
}

function summarizePlainHistory(body: WireBody, summaryBudget: number): { body: WireBody; count: number; savedTokens: number } | undefined {
  // Opaque server history cannot be silently detached or assumed materialized.
  if (body.previous_response_id || body.conversation) return undefined
  const key = Array.isArray(body.messages) ? 'messages' : Array.isArray(body.input) ? 'input' : Array.isArray(body.contents) ? 'contents' : undefined
  if (!key) return undefined
  const entries = body[key] as unknown[]
  // The strict gate already bounds traversal/text; also bound the packing work.
  if (entries.length > 2048) return undefined
  const plain = entries.map((entry) => plainHistoryMessage(entry, key))
  let currentUser = -1
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index] as WireBody | undefined
    if (entry?.role === 'user' && !hasToolResult(entry, key)) { currentUser = index; break }
  }
  if (currentUser < 0) return undefined
  let end = Math.min(currentUser, Math.max(0, entries.length - RECENT_MESSAGE_COUNT))
  let start = 0
  // Static instructions are never summary input or moved into a different role.
  while (start < end && isInstruction(entries[start])) start++
  let firstOpaque = start
  while (firstOpaque < entries.length && plain[firstOpaque]) firstOpaque++
  if (firstOpaque < entries.length && !isInstruction(entries[firstOpaque])) {
    // Preserve the entire user turn leading to any tool/media/reasoning state,
    // including synthetic follow-up messages after tool results.
    let userBeforeOpaque = firstOpaque - 1
    while (userBeforeOpaque >= start && plain[userBeforeOpaque]?.role !== 'user') userBeforeOpaque--
    end = Math.min(end, Math.max(start, userBeforeOpaque))
  }
  end = Math.min(end, firstOpaque)
  if (end <= start) return undefined
  const history = plain.slice(start, end) as { role: 'user' | 'assistant'; content: string }[]
  // Re-summarizing our previous summary can disguise no progress as recovery.
  if (history.some((message) => message.content.startsWith(HISTORY_SUMMARY_PREFIX))) return undefined
  const summary = summarizeContextPackingHistory(history, summaryBudget, estimateTextTokens)
  if (!summary.text) return undefined
  const content = `${HISTORY_SUMMARY_PREFIX}${UNTRUSTED_HISTORY_SUMMARY_PREAMBLE}\n${summary.text}`
  const savedTokens = history.reduce((total, message) => total + estimateTextTokens(message.content), 0) - estimateTextTokens(content)
  if (savedTokens <= 0) return undefined
  const replacement = key === 'contents' ? { role: 'user', parts: [{ text: content }] }
    : key === 'input' ? { role: 'user', content: [{ type: 'input_text', text: content }] }
    : { role: 'user', content }
  return { body: { ...body, [key]: [...entries.slice(0, start), replacement, ...entries.slice(end)] }, count: history.length, savedTokens }
}

function isInstruction(entry: unknown): boolean {
  const role = entry && typeof entry === 'object' ? (entry as WireBody).role : undefined
  return role === 'system' || role === 'developer'
}

function hasToolResult(entry: WireBody, key: string): boolean {
  const parts = key === 'contents' ? entry.parts : entry.content
  return Array.isArray(parts) && parts.some((part) => part && typeof part === 'object'
    && ((part as WireBody).type === 'tool_result' || (part as WireBody).functionResponse))
}

function plainHistoryMessage(entry: unknown, key: string): { role: 'user' | 'assistant'; content: string } | undefined {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined
  const value = entry as WireBody
  const role = value.role === 'model' && key === 'contents' ? 'assistant' : value.role
  if (role !== 'user' && role !== 'assistant') return undefined
  const field = key === 'contents' ? 'parts' : 'content'
  // IDs, signatures, tool calls, cached/opaque blocks and unknown metadata are
  // exact protocol state, never plain text even when they have a text field.
  if (Object.keys(value).some((name) => name !== 'role' && name !== field && !(key === 'input' && name === 'type' && value.type === 'message'))) return undefined
  const source = value[field]
  if (typeof source === 'string') return { role, content: source }
  if (!Array.isArray(source) || !source.length) return undefined
  const texts: string[] = []
  for (const part of source) {
    if (!part || typeof part !== 'object' || Array.isArray(part)) return undefined
    const record = part as WireBody
    if (typeof record.text !== 'string' || Object.keys(record).some((name) => name !== 'text' && name !== 'type')) return undefined
    if (key === 'contents' ? record.type !== undefined : !['text', 'input_text', 'output_text'].includes(String(record.type))) return undefined
    texts.push(record.text)
  }
  return { role, content: texts.join('\n') }
}
