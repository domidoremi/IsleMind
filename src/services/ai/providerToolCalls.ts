import type { ProviderType } from '@/types'
import { asRecord, stringValue } from '@/services/ai/providerJsonUtils'
import { isToolEventType } from '@/services/ai/providerTraceUtils'
import { numberValue } from '@/services/ai/providerUsage'

export interface ProviderToolCall {
  id?: string
  callId?: string
  index?: number
  name: string
  arguments: Record<string, unknown>
  rawArguments?: unknown
  thoughtSignature?: string
  argumentsComplete?: boolean
}

type ProviderToolCallInput = {
  id?: string
  callId?: string
  index?: number
  name?: string
  rawArguments?: unknown
  arguments?: unknown
  thoughtSignature?: string
}

export function extractProviderToolCalls(value: unknown, providerType: ProviderType): ProviderToolCall[] | undefined {
  const root = asRecord(value)
  if (!root) return undefined
  const calls: ProviderToolCall[] = []
  const add = (input: ProviderToolCallInput) => {
    const call = normalizeProviderToolCall(input)
    if (call) calls.push(call)
  }

  if (providerType === 'openai' || providerType === 'openai-compatible' || providerType === 'xiaomi-mimo') {
    collectOpenAIProviderToolCalls(root, add)
  } else if (providerType === 'anthropic') {
    collectAnthropicProviderToolCalls(root, add)
  } else if (providerType === 'google') {
    collectGoogleProviderToolCalls(root, add)
  }

  return calls.length ? mergeProviderToolCallParts(calls) : undefined
}

function collectOpenAIProviderToolCalls(root: Record<string, unknown>, add: (input: ProviderToolCallInput) => void) {
  const addOpenAIToolCall = (value: unknown, fallback: { id?: string; index?: number; name?: string; rawArguments?: unknown } = {}) => {
    const record = asRecord(value)
    if (!record) return
    const fn = asRecord(record.function) ?? asRecord(record.function_call)
    add({
      id: stringValue(record.id) || stringValue(record.call_id) || stringValue(record.item_id) || fallback.id,
      callId: stringValue(record.call_id),
      index: numberValue(record.index) ?? fallback.index,
      name: stringValue(record.name) || stringValue(fn?.name) || fallback.name,
      rawArguments: record.arguments ?? record.input ?? fn?.arguments ?? fn?.input ?? fallback.rawArguments,
    })
  }
  const addOpenAIArray = (items: unknown, fallback: { index?: number } = {}) => {
    if (!Array.isArray(items)) return
    items.forEach((item, index) => addOpenAIToolCall(item, { index: fallback.index ?? index }))
  }

  addOpenAIArray(root.tool_calls)
  if (isToolEventType(root.type) || root.name || root.arguments || root.input) {
    addOpenAIToolCall(root)
  }
  addOpenAIToolCall(root.tool_call)
  addOpenAIToolCall(root.function_call)
  addOpenAIToolCall(root.item)
  if (root.type === 'response.function_call_arguments.delta' || root.type === 'response.function_call_arguments.done') {
    add({
      id: stringValue(root.item_id) || stringValue(root.id) || stringValue(root.call_id),
      callId: stringValue(root.call_id),
      index: numberValue(root.output_index),
      rawArguments: root.arguments ?? root.delta,
    })
  }

  for (const choice of Array.isArray(root.choices) ? root.choices : []) {
    const choiceRecord = asRecord(choice)
    const delta = asRecord(choiceRecord?.delta)
    const message = asRecord(choiceRecord?.message)
    addOpenAIArray(delta?.tool_calls)
    addOpenAIToolCall(delta?.function_call)
    addOpenAIArray(message?.tool_calls)
    addOpenAIToolCall(message?.function_call)
  }

  for (const output of Array.isArray(root.output) ? root.output : []) {
    const item = asRecord(output)
    if (!item) continue
    if (isToolEventType(item.type) || item.name || item.arguments || item.input) {
      addOpenAIToolCall(item)
    }
    addOpenAIArray(item.tool_calls)
    for (const part of Array.isArray(item.content) ? item.content : []) {
      const contentPart = asRecord(part)
      if (contentPart && (isToolEventType(contentPart.type) || contentPart.name || contentPart.arguments || contentPart.input)) {
        addOpenAIToolCall(contentPart, {
          id: stringValue(item.id) || stringValue(item.call_id),
          index: numberValue(item.index),
        })
      }
    }
  }
}

function collectAnthropicProviderToolCalls(root: Record<string, unknown>, add: (input: ProviderToolCallInput) => void) {
  const addAnthropicToolUse = (value: unknown, fallback: { id?: string; index?: number } = {}) => {
    const record = asRecord(value)
    if (!record || record.type !== 'tool_use') return
    add({
      id: stringValue(record.id) || fallback.id,
      index: numberValue(record.index) ?? fallback.index,
      name: stringValue(record.name),
      rawArguments: record.input,
    })
  }
  const index = numberValue(root.index)
  addAnthropicToolUse(root.content_block, { index })
  for (const part of Array.isArray(root.content) ? root.content : []) addAnthropicToolUse(part)
  const delta = asRecord(root.delta)
  if (root.type === 'content_block_delta' && delta?.type === 'input_json_delta') {
    add({
      index,
      rawArguments: delta.partial_json,
    })
  }
}

function collectGoogleProviderToolCalls(root: Record<string, unknown>, add: (input: ProviderToolCallInput) => void) {
  const addFunctionCall = (value: unknown, index?: number, thoughtSignature?: string) => {
    const record = asRecord(value)
    if (!record) return
    add({
      index,
      name: stringValue(record.name),
      rawArguments: record.args ?? record.arguments,
      thoughtSignature,
    })
  }
  addFunctionCall(root.functionCall)
  const candidates = Array.isArray(root.candidates) ? root.candidates : []
  for (const candidate of candidates) {
    const content = asRecord((candidate as Record<string, unknown>).content)
    const parts = Array.isArray(content?.parts) ? content.parts : []
    parts.forEach((part, index) => {
      const record = asRecord(part)
      addFunctionCall(record?.functionCall, index, stringValue(record?.thoughtSignature))
    })
  }
}

function normalizeProviderToolCall(input: ProviderToolCallInput): ProviderToolCall | undefined {
  const id = input.id || undefined
  const callId = input.callId || undefined
  const index = typeof input.index === 'number' && Number.isFinite(input.index) ? input.index : undefined
  const name = input.name || ''
  const rawArguments = input.rawArguments ?? input.arguments
  if (!id && index === undefined && !name) return undefined
  const parsed = normalizeProviderToolCallArguments(rawArguments)
  return {
    ...(id ? { id } : {}),
    ...(callId ? { callId } : {}),
    ...(index !== undefined ? { index } : {}),
    name,
    arguments: parsed.arguments,
    ...(rawArguments !== undefined ? { rawArguments } : {}),
    ...(input.thoughtSignature ? { thoughtSignature: input.thoughtSignature } : {}),
    argumentsComplete: parsed.complete,
  }
}

function normalizeProviderToolCallArguments(value: unknown): { arguments: Record<string, unknown>; complete: boolean } {
  if (value === undefined) return { arguments: {}, complete: true }
  const record = asRecord(value)
  if (record) return { arguments: { ...record }, complete: true }
  if (typeof value !== 'string') return { arguments: {}, complete: false }
  const trimmed = value.trim()
  if (!trimmed) return { arguments: {}, complete: true }
  try {
    const parsed = JSON.parse(trimmed)
    const parsedRecord = asRecord(parsed)
    return parsedRecord ? { arguments: { ...parsedRecord }, complete: true } : { arguments: {}, complete: false }
  } catch {
    return { arguments: {}, complete: false }
  }
}

export function mergeProviderToolCallParts(parts: ProviderToolCall[]): ProviderToolCall[] {
  const merged: ProviderToolCall[] = []
  for (const part of parts) {
    const index = findMatchingProviderToolCallIndex(merged, part)
    if (index < 0) {
      merged.push({ ...part, arguments: { ...part.arguments } })
      continue
    }
    merged[index] = mergeProviderToolCallPart(merged[index], part)
  }
  return merged
}

function findMatchingProviderToolCallIndex(calls: ProviderToolCall[], part: ProviderToolCall): number {
  if (part.id) {
    const byId = calls.findIndex((call) => call.id === part.id)
    if (byId >= 0) return byId
  }
  if (part.index !== undefined) {
    const byIndex = calls.findIndex((call) => call.index === part.index)
    if (byIndex >= 0) return byIndex
  }
  if (part.name) {
    const byName = calls.findIndex((call) => call.name === part.name && !call.id && call.index === undefined)
    if (byName >= 0) return byName
  }
  return -1
}

function mergeProviderToolCallPart(previous: ProviderToolCall, next: ProviderToolCall): ProviderToolCall {
  const rawArguments = mergeProviderToolRawArguments(previous.rawArguments, next.rawArguments, next.argumentsComplete === true)
  const parsed = normalizeProviderToolCallArguments(rawArguments)
  const mergedArguments = rawArguments !== undefined && parsed.complete
    ? parsed.arguments
    : { ...previous.arguments, ...next.arguments }
  return {
    id: previous.id || next.id,
    ...(previous.callId || next.callId ? { callId: previous.callId || next.callId } : {}),
    index: previous.index ?? next.index,
    name: previous.name || next.name,
    arguments: mergedArguments,
    ...(rawArguments !== undefined ? { rawArguments } : {}),
    ...(previous.thoughtSignature || next.thoughtSignature ? { thoughtSignature: previous.thoughtSignature || next.thoughtSignature } : {}),
    argumentsComplete: rawArguments !== undefined ? parsed.complete : previous.argumentsComplete !== false && next.argumentsComplete !== false,
  }
}

function mergeProviderToolRawArguments(previous: unknown, next: unknown, nextComplete: boolean): unknown {
  if (next === undefined) return previous
  if (previous === undefined) return next
  if (typeof previous === 'string' && typeof next === 'string') return nextComplete ? next : `${previous}${next}`
  return next
}

export function executableProviderToolCalls(calls: ProviderToolCall[] | undefined): ProviderToolCall[] | undefined {
  const executable = mergeProviderToolCallParts(calls ?? [])
    .filter((call) => call.name && call.argumentsComplete !== false)
    .map((call) => ({
      ...(call.id ? { id: call.id } : {}),
      ...(call.callId ? { callId: call.callId } : {}),
      ...(call.index !== undefined ? { index: call.index } : {}),
      name: call.name,
      arguments: { ...call.arguments },
      ...(call.rawArguments !== undefined ? { rawArguments: call.rawArguments } : {}),
      ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}),
      argumentsComplete: true,
    }))
  return executable.length ? executable : undefined
}
