import { asRecord, stringValue } from '@/services/ai/providerJsonUtils'
import { numberValue } from '@/services/ai/providerUsage'

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

function mergeAnthropicReplayContentBlock(previous: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...previous, ...next }
  for (const key of ['thinking', 'signature']) {
    const previousValue = stringValue(previous[key])
    const nextValue = stringValue(next[key])
    if (previousValue && nextValue) merged[key] = `${previousValue}${nextValue}`
  }
  return merged
}
