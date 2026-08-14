import type { JsonRecord } from './json'

export const CHAT_REQUEST_SCHEMA = 'islemind.chat-request.v1'

export type ChatMessageRole = 'system' | 'user' | 'assistant' | 'tool'

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type GenerationParameterKey = 'temperature' | 'topP' | 'topK' | 'maxTokens'

export type GenerationParameterSource = 'provider-default' | 'explicit' | 'internal-policy'

export type GenerationParameterSources = Partial<
  Readonly<Record<GenerationParameterKey, GenerationParameterSource>>
>

export function resolveGenerationParameterSources(input: {
  values: Partial<Readonly<Record<GenerationParameterKey, number | undefined>>>
  overrides?: Partial<Readonly<Record<GenerationParameterKey, boolean>>>
}): GenerationParameterSources {
  const sources: Partial<Record<GenerationParameterKey, GenerationParameterSource>> = {}
  for (const key of ['temperature', 'topP', 'topK', 'maxTokens'] as const) {
    if (input.overrides === undefined) {
      const value = input.values[key]
      if (typeof value === 'number' && Number.isFinite(value)) sources[key] = 'explicit'
      continue
    }
    sources[key] = input.overrides[key] === true ? 'explicit' : 'provider-default'
  }
  return sources
}

export interface ChatMessageInput {
  id: string
  role: ChatMessageRole
  text: string
  toolCallId?: string
  name?: string
  toolCalls?: readonly Readonly<{
    callId: string
    name: string
    arguments: JsonRecord
    providerMetadata?: JsonRecord
  }>[]
}

export interface ChatToolDefinition {
  readonly operationId: string
  readonly name: string
  readonly description: string
  readonly inputSchema: JsonRecord
  readonly permission: 'read-only' | 'read-write' | 'destructive'
}

export interface ChatRequest {
  schema: typeof CHAT_REQUEST_SCHEMA
  conversationId: string
  providerId: string
  model: string
  messages: readonly ChatMessageInput[]
  systemPrompt?: string
  temperature?: number
  topP?: number
  topK?: number
  reasoningEffort?: ReasoningEffort
  maxTokens?: number
  generationParameterSources: GenerationParameterSources
  requestedCapabilities?: readonly string[]
  toolDefinitions?: readonly ChatToolDefinition[]
}

export type StreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'citation'; citationId: string; title?: string; url?: string }
  | {
      type: 'tool-call'
      toolCallId: string
      toolName: string
      arguments?: JsonRecord
      providerMetadata?: JsonRecord
    }
  | {
      type: 'usage'
      inputTokens?: number
      outputTokens?: number
      totalTokens?: number
      cacheCreationInputTokens?: number
      cacheReadInputTokens?: number
      cachedInputTokens?: number
      reasoningTokens?: number
    }
  | { type: 'notice'; code: string; message?: string }
