import { getModelConfig } from '@/types/modelCatalog'
import type { AIProvider } from '@/types/providerContracts'
import type { ProviderToolCall } from './providerToolCalls'

export type ProviderStructuredOutputRequestShape =
  | 'none'
  | 'openai-response-format'
  | 'openai-json-object-response-format'
  | 'openrouter-response-format'
  | 'xai-response-format'
  | 'anthropic-tool-schema'
  | 'google-response-schema'
  | 'localai-grammar'

export interface ProviderStructuredOutputRequest {
  type: 'json_object' | 'json_schema'
  name?: string
  schema?: Record<string, unknown>
  strict?: boolean
}

export interface ProviderStructuredOutputRequestPolicy {
  request?: ProviderStructuredOutputRequest
  capabilityAllowed: boolean
  appRequestControl: boolean
  documentedRequestShape: ProviderStructuredOutputRequestShape
  strictJsonSchema: boolean
  responsesTextFormatAllowed?: boolean
}

const DEFAULT_STRUCTURED_OUTPUT_TOOL_NAME = 'islemind_structured_output'

/**
 * OpenAI-compatible Responses endpoints must explicitly declare `text.format`;
 * official provider families retain their catalog-backed request behavior.
 */
export function providerOpenAIResponsesTextFormatAllowed(
  provider: AIProvider,
  model: string,
): boolean {
  if (provider.type !== 'openai-compatible') return true
  const modelConfig = getModelConfig(model, provider.type, provider.modelConfigs)
  return modelConfig.supportedParameters?.some((item) => item.toLowerCase() === 'text.format') === true
}

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
  request?: ProviderStructuredOutputRequest,
): string | undefined {
  if (!request?.type || !calls?.length) return undefined
  const toolName = providerStructuredOutputToolName(request)
  const call = calls.find((item) => item.name === toolName)
  return call ? JSON.stringify(call.arguments ?? {}) : undefined
}

export function filterProviderStructuredOutputToolCalls(
  calls: readonly ProviderToolCall[] | undefined,
  request?: ProviderStructuredOutputRequest,
): ProviderToolCall[] | undefined {
  if (!request?.type || !calls?.length) return calls ? [...calls] : undefined
  const toolName = providerStructuredOutputToolName(request)
  const filtered = calls.filter((item) => item.name !== toolName)
  return filtered.length ? filtered : undefined
}

export function buildProviderOpenAIChatResponseFormat(
  policy: ProviderStructuredOutputRequestPolicy,
): Record<string, unknown> | undefined {
  if (!canApplyStructuredOutputPolicy(policy)) return undefined
  if (
    policy.documentedRequestShape !== 'openai-response-format' &&
    policy.documentedRequestShape !== 'openai-json-object-response-format' &&
    policy.documentedRequestShape !== 'openrouter-response-format' &&
    policy.documentedRequestShape !== 'xai-response-format'
  ) return undefined
  if (policy.documentedRequestShape === 'xai-response-format') {
    return buildXAIResponseFormat(policy.request)
  }
  return buildOpenAICompatibleResponseFormat(policy)
}

export function buildProviderOpenAIResponsesTextConfig(
  policy: ProviderStructuredOutputRequestPolicy,
): Record<string, unknown> | undefined {
  if (!canApplyStructuredOutputPolicy(policy) || policy.responsesTextFormatAllowed === false) return undefined
  if (
    policy.documentedRequestShape !== 'openai-response-format' &&
    policy.documentedRequestShape !== 'openai-json-object-response-format'
  ) return undefined
  if (policy.request?.type === 'json_object') return { format: { type: 'json_object' } }
  if (policy.documentedRequestShape === 'openai-json-object-response-format' || !policy.request?.schema) return undefined
  const format: Record<string, unknown> = {
    type: 'json_schema',
    name: structuredOutputName(policy.request),
    schema: policy.request.schema,
  }
  if (policy.request.strict === true && policy.strictJsonSchema) format.strict = true
  return { format }
}

export function buildProviderOpenAIResponsesResponseFormat(
  policy: ProviderStructuredOutputRequestPolicy,
): Record<string, unknown> | undefined {
  if (!canApplyStructuredOutputPolicy(policy)) return undefined
  if (policy.documentedRequestShape === 'xai-response-format') {
    return buildXAIResponseFormat(policy.request)
  }
  if (policy.documentedRequestShape === 'openrouter-response-format') {
    return buildOpenAICompatibleResponseFormat(policy)
  }
  return undefined
}

function canApplyStructuredOutputPolicy(policy: ProviderStructuredOutputRequestPolicy): boolean {
  return Boolean(policy.request && policy.capabilityAllowed && policy.appRequestControl)
}

function buildOpenAICompatibleResponseFormat(
  policy: ProviderStructuredOutputRequestPolicy,
): Record<string, unknown> | undefined {
  if (policy.request?.type === 'json_object') return { type: 'json_object' }
  if (policy.documentedRequestShape === 'openai-json-object-response-format' || !policy.request?.schema) return undefined
  const jsonSchema: Record<string, unknown> = {
    name: structuredOutputName(policy.request),
    schema: policy.request.schema,
  }
  if (policy.request.strict === true && policy.strictJsonSchema) jsonSchema.strict = true
  return { type: 'json_schema', json_schema: jsonSchema }
}

function buildXAIResponseFormat(
  request: ProviderStructuredOutputRequest | undefined,
): Record<string, unknown> | undefined {
  if (request?.type === 'json_object') return { type: 'json_object' }
  if (!request?.schema) return undefined
  return {
    type: 'json_schema',
    json_schema: {
      name: structuredOutputName(request),
      schema: request.schema,
    },
  }
}

function structuredOutputName(request: ProviderStructuredOutputRequest): string {
  return request.name?.trim() || 'islemind_response'
}
