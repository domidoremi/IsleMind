import type { ProviderStructuredOutputRequest } from '@/services/ai/providerConformance'
import type { ProviderToolCall } from '@/services/ai/providerToolCalls'

const DEFAULT_STRUCTURED_OUTPUT_TOOL_NAME = 'islemind_structured_output'

export function providerStructuredOutputToolName(request?: ProviderStructuredOutputRequest): string {
  const raw = request?.name?.trim() || DEFAULT_STRUCTURED_OUTPUT_TOOL_NAME
  const normalized = raw.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64)
  return normalized || DEFAULT_STRUCTURED_OUTPUT_TOOL_NAME
}

export function providerStructuredOutputToolSchema(request?: ProviderStructuredOutputRequest): Record<string, unknown> | undefined {
  if (!request) return undefined
  if (request.type === 'json_object') return { type: 'object' }
  return request.schema
}

export function providerStructuredOutputToolCallText(
  calls: readonly ProviderToolCall[] | undefined,
  request?: ProviderStructuredOutputRequest
): string | undefined {
  if (!request?.type || !calls?.length) return undefined
  const toolName = providerStructuredOutputToolName(request)
  const call = calls.find((item) => item.name === toolName)
  return call ? JSON.stringify(call.arguments ?? {}) : undefined
}

export function filterProviderStructuredOutputToolCalls(
  calls: readonly ProviderToolCall[] | undefined,
  request?: ProviderStructuredOutputRequest
): ProviderToolCall[] | undefined {
  if (!request?.type || !calls?.length) return calls ? [...calls] : undefined
  const toolName = providerStructuredOutputToolName(request)
  const filtered = calls.filter((item) => item.name !== toolName)
  return filtered.length ? filtered : undefined
}
