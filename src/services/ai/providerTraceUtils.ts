import { st } from '@/i18n/service'
import { buildAgentToolCallTraceMetadata, inferAgentToolNameFromTraceContent } from '@/services/agent/agentToolCallTrace'
import { asRecord, safeJsonPreview, stringValue, stringifyReasoningDetails } from '@/services/ai/providerJsonUtils'
import { extractOpenAIContentReasoning, stringifyOpenAIReasoningItem } from '@/services/ai/providerResponseText'
import { dedupeTraces } from '@/services/ai/providerStreamUtils'
import type { ProcessTrace, ProviderType } from '@/types'
import { redactSensitiveText } from '@/utils/traceSafety'

export interface ProviderTraceExtractionOptions {
  includeReasoning?: boolean
}

export function stableTraceId(json: any, fallback: string): string {
  const raw = [
    fallback,
    json?.id,
    json?.item_id,
    json?.output_index,
    json?.content_block?.id,
    json?.content_block?.name,
    json?.index,
    json?.type,
  ].filter((part) => part !== undefined && part !== null).join('-')
  return raw || `${fallback}-${Date.now()}`
}

export function isReasoningEventType(type: unknown): boolean {
  if (typeof type !== 'string') return false
  return type.includes('reasoning') || type.includes('thinking') || type.includes('summary')
}

export function isToolEventType(type: unknown): boolean {
  if (typeof type !== 'string') return false
  return type.includes('tool') || type.includes('function_call') || type.includes('web_search')
}

export function isDoneEvent(type: unknown): boolean {
  return typeof type === 'string' && (type.endsWith('.done') || type.endsWith('_stop') || type.endsWith('.completed'))
}

export function summarizeToolEvent(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const records = collectProviderToolEventRecords(value)
  const name = findProviderToolEventName(records)
  const input = findProviderToolEventInput(records) ?? value
  const inputText = typeof input === 'string' ? input : safeJsonPreview(input)
  return [name ? st('providerTrace.toolNameLine', { name }) : '', inputText ? st('providerTrace.toolArgsLine', { input: inputText }) : ''].filter(Boolean).join('\n')
}

export function createProviderTrace(
  type: ProcessTrace['type'],
  providerType: ProviderType,
  title: string,
  content: string,
  status: ProcessTrace['status'],
  id: string,
  metadata?: Record<string, unknown>
): ProcessTrace {
  const now = Date.now()
  const toolCallMetadata = type === 'tool'
    ? buildAgentToolCallTraceMetadata({
        mode: 'native-provider',
        source: 'provider',
        toolName: inferAgentToolNameFromTraceContent(title, content),
        status,
        providerType,
      })
    : {}
  return {
    id,
    type,
    title,
    content: sanitizeTraceContent(content),
    status,
    startedAt: now,
    completedAt: status === 'done' || status === 'error' || status === 'skipped' ? now : undefined,
    metadata: {
      providerType,
      source: 'provider',
      ...toolCallMetadata,
      ...metadata,
    },
  }
}

export function extractTracesFromJson(json: any, providerType: ProviderType, options: ProviderTraceExtractionOptions = {}): ProcessTrace[] {
  const traces: ProcessTrace[] = []
  const includeReasoning = options.includeReasoning !== false
  if (providerType === 'openai' || providerType === 'openai-compatible' || providerType === 'xiaomi-mimo') {
    if (includeReasoning) {
      const reasoning = [
        json.choices?.[0]?.message?.reasoning_content,
        json.choices?.[0]?.message?.reasoning,
        extractOpenAIContentReasoning(json.choices?.[0]?.message?.content),
        stringifyReasoningDetails(json.choices?.[0]?.message?.reasoning_details),
        stringifyReasoningDetails(json.reasoning_details),
        json.reasoning?.summary?.map?.((item: { text?: string }) => item.text ?? '').join('\n'),
        Array.isArray(json.output)
          ? json.output
              .filter((item: Record<string, unknown>) => stringValue(item.type).includes('reasoning'))
              .map((item: Record<string, unknown>) => stringifyOpenAIReasoningItem(item))
              .filter(Boolean)
              .join('\n')
          : '',
      ].map(stringValue).filter(Boolean).join('\n')
      if (reasoning) traces.push(createProviderTrace('reasoning', providerType, st('providerTrace.reasoningSummary'), reasoning, 'done', stableTraceId(json, 'reasoning-json')))
    }
    if (Array.isArray(json.output)) {
      for (const item of json.output) {
        const record = item as Record<string, unknown>
        if (isToolEventType(record.type)) {
          traces.push(createProviderTrace('tool', providerType, st('providerTrace.toolCall'), summarizeToolEvent(record), 'done', stableTraceId(record, 'tool-json')))
        }
      }
    }
  }
  if (providerType === 'anthropic' && Array.isArray(json.content)) {
    for (const part of json.content) {
      const item = part as Record<string, unknown>
      if (includeReasoning && item.type === 'thinking') traces.push(createProviderTrace('reasoning', providerType, st('providerTrace.reasoningSummary'), stringValue(item.thinking), 'done', stableTraceId(item, 'thinking-json')))
      if (item.type === 'tool_use') traces.push(createProviderTrace('tool', providerType, st('providerTrace.toolCallNamed', { name: stringValue(item.name) || 'tool' }), summarizeToolEvent(item), 'done', stableTraceId(item, 'tool-json')))
    }
  }
  if (providerType === 'google') {
    const parts = json.candidates?.[0]?.content?.parts
    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (includeReasoning && part.thought && part.text) traces.push(createProviderTrace('reasoning', providerType, st('providerTrace.reasoningSummary'), stringValue(part.text), 'done', stableTraceId(part, 'thought-json')))
        if (part.functionCall) traces.push(createProviderTrace('tool', providerType, st('providerTrace.functionCallNamed', { name: part.functionCall.name ?? 'function' }), summarizeToolEvent(part.functionCall), 'done', stableTraceId(part.functionCall, 'function-json')))
        if (includeReasoning && part.thoughtSignature) traces.push(createProviderTrace('reasoning', providerType, st('providerTrace.thoughtSignature'), st('providerTrace.thoughtSignatureSaved'), 'done', stableTraceId(part, 'thought-signature-json'), { hiddenSignature: true }))
      }
    }
  }
  return dedupeTraces(traces)
}

function sanitizeTraceContent(content: string): string | undefined {
  const trimmed = redactSensitiveText(content.trim())
  if (!trimmed) return undefined
  return trimmed.length > 760 ? `${trimmed.slice(0, 760)}...` : trimmed
}

function collectProviderToolEventRecords(value: unknown): Record<string, unknown>[] {
  const root = asRecord(value)
  if (!root) return []
  const records: Record<string, unknown>[] = []
  const addRecord = (record: unknown) => {
    const item = asRecord(record)
    if (item) records.push(item)
  }
  const addRecordArray = (items: unknown) => {
    if (!Array.isArray(items)) return
    items.forEach(addRecord)
  }

  addRecord(root)
  addRecord(root.tool_call)
  addRecord(root.item)
  addRecord(root.content_block)
  addRecordArray(root.tool_calls)

  for (const choice of Array.isArray(root.choices) ? root.choices : []) {
    const choiceRecord = asRecord(choice)
    const delta = asRecord(choiceRecord?.delta)
    const message = asRecord(choiceRecord?.message)
    addRecord(delta)
    addRecord(delta?.function_call)
    addRecordArray(delta?.tool_calls)
    addRecord(message)
    addRecord(message?.function_call)
    addRecordArray(message?.tool_calls)
  }

  return records
}

function findProviderToolEventName(records: Record<string, unknown>[]): string {
  for (const item of records) {
    const name =
      stringValue(item.name) ||
      stringValue(item.toolName) ||
      stringValue((item.function as Record<string, unknown> | undefined)?.name) ||
      stringValue((item.tool_call as Record<string, unknown> | undefined)?.name) ||
      stringValue((item.item as Record<string, unknown> | undefined)?.name) ||
      stringValue((item.content_block as Record<string, unknown> | undefined)?.name)
    if (name) return name
  }
  return ''
}

function findProviderToolEventInput(records: Record<string, unknown>[]): unknown {
  for (const item of records) {
    const input =
      item.input ??
      item.arguments ??
      item.args ??
      (item.function as Record<string, unknown> | undefined)?.arguments ??
      (item.tool_call as Record<string, unknown> | undefined)?.arguments ??
      (item.item as Record<string, unknown> | undefined)?.input ??
      (item.content_block as Record<string, unknown> | undefined)?.input
    if (input !== undefined) return input
  }
  return undefined
}
