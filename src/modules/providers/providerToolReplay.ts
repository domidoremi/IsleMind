import type { ProviderToolCall } from './providerToolCalls'

export function toOpenAIChatToolCall(call: ProviderToolCall, index: number): Record<string, unknown> {
  return {
    id: call.id || `islemind-tool-${index}`,
    type: 'function',
    function: {
      name: call.name,
      arguments: typeof call.rawArguments === 'string' ? call.rawArguments : stringifyProviderToolArguments(call.arguments),
    },
  }
}

export function stringifyProviderToolArguments(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args)
  } catch {
    return '{}'
  }
}

export function cloneOpenAIResponsesInputItems(
  items: readonly Record<string, unknown>[],
  calls: readonly ProviderToolCall[] = [],
): Record<string, unknown>[] {
  return items.map((item) => recoverOpenAIResponsesFunctionCallInputItem({ ...item }, calls))
}

export function hasOpenAIResponsesFunctionCallItem(items: readonly Record<string, unknown>[], call: ProviderToolCall): boolean {
  return items.some((item) => {
    if (item.type !== 'function_call') return false
    return openAIResponsesFunctionCallItemMatches(item, call)
  })
}

export function toOpenAIResponsesFunctionCallInput(call: ProviderToolCall, index: number): Record<string, unknown> {
  return {
    type: 'function_call',
    ...(call.id ? { id: call.id } : {}),
    call_id: call.callId || call.id || `islemind-tool-${index}`,
    name: call.name,
    arguments: typeof call.rawArguments === 'string' ? call.rawArguments : stringifyProviderToolArguments(call.arguments),
  }
}

function recoverOpenAIResponsesFunctionCallInputItem(
  item: Record<string, unknown>,
  calls: readonly ProviderToolCall[],
): Record<string, unknown> {
  if (item.type !== 'function_call' || calls.length === 0) return item
  const call = calls.find((candidate) => openAIResponsesFunctionCallItemMatches(item, candidate))
  if (!call) return item
  if (!item.call_id && (call.callId || call.id)) item.call_id = call.callId || call.id
  if (!item.id && call.id) item.id = call.id
  if ((!item.name || typeof item.name !== 'string') && call.name) item.name = call.name
  if ((!item.arguments || typeof item.arguments !== 'string') && call.name) {
    item.arguments = typeof call.rawArguments === 'string' ? call.rawArguments : stringifyProviderToolArguments(call.arguments)
  }
  return item
}

function openAIResponsesFunctionCallItemMatches(item: Record<string, unknown>, call: ProviderToolCall): boolean {
  const ids = [call.callId, call.id].filter(Boolean)
  if (ids.some((id) => item.call_id === id || item.id === id)) return true
  return Boolean(call.name && item.name === call.name)
}
