import type { ProviderToolCall } from '@/services/ai/providerToolCalls'

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

export function cloneOpenAIResponsesInputItems(items: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return items.map((item) => ({ ...item }))
}

export function hasOpenAIResponsesFunctionCallItem(items: readonly Record<string, unknown>[], call: ProviderToolCall): boolean {
  const callId = call.callId || call.id
  return items.some((item) => {
    if (item.type !== 'function_call') return false
    if (callId && (item.call_id === callId || item.id === callId)) return true
    return Boolean(call.name && item.name === call.name)
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
