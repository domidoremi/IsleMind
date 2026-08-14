import { numberValue } from './providerUsage'

export function extractOpenAIReasoningContent(json: any): string | undefined {
  const reasoning = [
    json?.choices?.[0]?.message?.reasoning_content,
    json?.choices?.[0]?.message?.reasoning,
    json?.choices?.[0]?.delta?.reasoning_content,
    json?.choices?.[0]?.delta?.reasoning,
    json?.delta?.reasoning_content,
    json?.delta?.reasoning,
    json?.message?.reasoning_content,
    json?.message?.reasoning,
    json?.reasoning_content,
    typeof json?.reasoning === 'string' ? json.reasoning : undefined,
  ].map(stringValue).filter(Boolean).join('')
  return reasoning || undefined
}

export function extractOpenAIResponseReplayItems(json: any): Record<string, unknown>[] | undefined {
  const items: Record<string, unknown>[] = []
  const addItems = (value: unknown) => {
    if (!Array.isArray(value)) return
    for (const item of value) {
      const record = asRecord(item)
      if (record && isOpenAIResponsesReplayItem(record)) items.push({ ...record })
    }
  }

  addItems(json?.output)
  addItems(json?.response?.output)
  const item = asRecord(json?.item)
  if (item && item.type === 'reasoning') items.push({ ...item })
  if (asRecord(json) && isOpenAIResponsesReplayItem(json)) items.push({ ...json })

  const merged = mergeOpenAIResponseReplayItems(items)
  return merged.length ? merged : undefined
}

export function mergeOpenAIResponseReplayItems(items: Record<string, unknown>[]): Record<string, unknown>[] {
  const merged: Record<string, unknown>[] = []
  for (const item of items) {
    const key = openAIResponseReplayItemKey(item)
    const existingIndex = key ? merged.findIndex((entry) => openAIResponseReplayItemKey(entry) === key) : -1
    if (existingIndex < 0) {
      merged.push({ ...item })
      continue
    }
    merged[existingIndex] = { ...merged[existingIndex], ...item }
  }
  return merged
}

export function extractAnthropicReplayContentBlocks(json: any): Record<string, unknown>[] | undefined {
  const blocks: Record<string, unknown>[] = []
  if (Array.isArray(json?.content)) {
    for (const part of json.content) {
      const block = cloneAnthropicReplayContentBlock(part)
      if (block) blocks.push(block)
    }
  }
  const startedBlock = cloneAnthropicReplayContentBlock(json?.content_block)
  if (startedBlock) blocks.push(startedBlock)
  const delta = asRecord(json?.delta)
  if (json?.type === 'content_block_delta' && delta) {
    const index = numberValue(json.index)
    if (delta.type === 'thinking_delta' || typeof delta.thinking === 'string') {
      blocks.push(withAnthropicReplayIndex({ type: 'thinking', thinking: stringValue(delta.thinking) }, index))
    }
    if (delta.type === 'signature_delta' || typeof delta.signature === 'string') {
      blocks.push(withAnthropicReplayIndex({ type: 'thinking', signature: stringValue(delta.signature) }, index))
    }
  }
  const merged = mergeAnthropicReplayContentBlocks(blocks)
  return merged.length ? sanitizeAnthropicReplayContentBlocks(merged) : undefined
}

export function sanitizeAnthropicReplayContentBlocks(blocks: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return blocks
    .map((block) => {
      const next = cloneAnthropicReplayContentBlock(block)
      if (next) delete next.__islemindAnthropicBlockIndex
      return next
    })
    .filter((block): block is Record<string, unknown> => !!block)
}

export function mergeAnthropicReplayContentBlocks(blocks: Record<string, unknown>[]): Record<string, unknown>[] {
  const merged: Record<string, unknown>[] = []
  for (const block of blocks) {
    const normalized = cloneAnthropicReplayContentBlock(block)
    if (!normalized) continue
    const index = numberValue(normalized.__islemindAnthropicBlockIndex)
    const mergeIndex = index === undefined
      ? (merged.length && stringValue(merged[merged.length - 1].type) === stringValue(normalized.type) ? merged.length - 1 : -1)
      : merged.findIndex((item) => numberValue(item.__islemindAnthropicBlockIndex) === index)
    if (mergeIndex < 0) {
      merged.push(normalized)
      continue
    }
    merged[mergeIndex] = mergeAnthropicReplayContentBlock(merged[mergeIndex], normalized)
  }
  return merged
}

function isOpenAIResponsesReplayItem(item: Record<string, unknown>): boolean {
  return item.type === 'reasoning' || item.type === 'function_call'
}

function openAIResponseReplayItemKey(item: Record<string, unknown>): string {
  const id = stringValue(item.id)
  if (id) return `${item.type}:id:${id}`
  const callId = stringValue(item.call_id)
  if (callId) return `${item.type}:call:${callId}`
  return ''
}

function cloneAnthropicReplayContentBlock(part: unknown): Record<string, unknown> | undefined {
  const record = asRecord(part)
  if (!record) return undefined
  const type = stringValue(record.type)
  if (type !== 'thinking' && type !== 'redacted_thinking') return undefined
  const next = { ...record }
  delete next.cache_control
  delete next.__islemindAnthropicBlockIndex
  const index = numberValue(record.__islemindAnthropicBlockIndex)
  return withAnthropicReplayIndex(next, index)
}

function withAnthropicReplayIndex(block: Record<string, unknown>, index: number | undefined): Record<string, unknown> {
  return index === undefined ? block : { ...block, __islemindAnthropicBlockIndex: index }
}

function mergeAnthropicReplayContentBlock(previous: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...previous, ...next }
  for (const key of ['thinking', 'signature']) {
    const previousValue = stringValue(previous[key])
    const nextValue = stringValue(next[key])
    if (previousValue && nextValue) merged[key] = `${previousValue}${nextValue}`
  }
  return merged
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
