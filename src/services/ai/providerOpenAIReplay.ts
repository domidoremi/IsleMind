import { asRecord, stringValue } from '@/services/ai/providerJsonUtils'

export function extractOpenAIReasoningContent(json: any): string | undefined {
  const reasoning = [
    json?.choices?.[0]?.message?.reasoning_content,
    json?.choices?.[0]?.delta?.reasoning_content,
    json?.delta?.reasoning_content,
    json?.message?.reasoning_content,
    json?.reasoning_content,
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

function isOpenAIResponsesReplayItem(item: Record<string, unknown>): boolean {
  return item.type === 'reasoning' || item.type === 'function_call'
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

function openAIResponseReplayItemKey(item: Record<string, unknown>): string {
  const id = stringValue(item.id)
  if (id) return `${item.type}:id:${id}`
  const callId = stringValue(item.call_id)
  if (callId) return `${item.type}:call:${callId}`
  return ''
}
