import type { JsonRecord } from './json'

export const CHAT_REQUEST_SCHEMA = 'islemind.chat-request.v1'
export const CHAT_REQUEST_MAX_SERIALIZED_CHARACTERS = 4 * 1024 * 1024

export type ChatMessageRole = 'system' | 'user' | 'assistant' | 'tool'

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type GenerationParameterKey = 'temperature' | 'topP' | 'topK' | 'maxTokens'

export type GenerationParameterSource = 'provider-default' | 'explicit' | 'internal-policy'

export type GenerationParameterSources = Partial<
  Readonly<Record<GenerationParameterKey, GenerationParameterSource>>
>

export interface ChatProviderStateBinding {
  readonly providerId: string
  readonly model: string
}

export type ChatReasoningReplayPart =
  | Readonly<{ kind: 'text'; text: string }>
  | Readonly<{
      kind: 'encrypted'
      id: string
      data: string
      summary?: readonly string[]
    }>
  | Readonly<{
      kind: 'thinking'
      text: string
      signature?: string
    }>
  | Readonly<{ kind: 'redacted'; data: string }>

export interface ChatToolCallProviderMetadata {
  readonly providerCallId?: string
  readonly providerCallIndex?: number
  readonly thoughtSignature?: string
}

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
  reasoningReplay?: readonly ChatReasoningReplayPart[]
  toolCalls?: readonly Readonly<{
    callId: string
    name: string
    arguments: JsonRecord
    providerMetadata?: ChatToolCallProviderMetadata
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
  providerStateBinding?: ChatProviderStateBinding
}

export type StreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'citation'; citationId: string; title?: string; url?: string }
  | {
      type: 'tool-call'
      toolCallId: string
      toolName: string
      arguments?: JsonRecord
      providerMetadata?: ChatToolCallProviderMetadata
    }
  | {
      /** Provider-bound state required to continue the current model turn. */
      type: 'provider-continuation-state'
      binding: ChatProviderStateBinding
      reasoningReplay?: readonly ChatReasoningReplayPart[]
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
  | {
      /**
       * A bounded lifecycle marker. Raw trace content and metadata stay out of
       * durable stream evidence because they can contain private prompt or tool
       * details.
       */
      type: 'trace'
      traceId: string
      traceType: string
      traceStatus: string
      title?: string
    }
  | { type: 'notice'; code: string; message?: string }

export function isChatRequest(value: unknown): value is ChatRequest {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    'schema',
    'conversationId',
    'providerId',
    'model',
    'messages',
    'generationParameterSources',
  ], [
    'systemPrompt',
    'temperature',
    'topP',
    'topK',
    'reasoningEffort',
    'maxTokens',
    'requestedCapabilities',
    'toolDefinitions',
    'providerStateBinding',
  ])) return false
  if (
    value.schema !== CHAT_REQUEST_SCHEMA
    || !isBoundedIdentity(value.conversationId)
    || !isBoundedIdentity(value.providerId)
    || !isBoundedIdentity(value.model)
    || !Array.isArray(value.messages)
    || value.messages.length > 512
    || !value.messages.every(isChatMessageInput)
    || !isGenerationParameterSources(value.generationParameterSources)
  ) return false
  if (value.systemPrompt !== undefined && !isBoundedText(value.systemPrompt, 262_144)) return false
  for (const key of ['temperature', 'topP', 'topK', 'maxTokens'] as const) {
    const candidate = value[key]
    if (candidate !== undefined && !isFiniteNumber(candidate)) return false
  }
  if (value.reasoningEffort !== undefined && !isReasoningEffort(value.reasoningEffort)) return false
  if (value.requestedCapabilities !== undefined && (
    !Array.isArray(value.requestedCapabilities)
    || value.requestedCapabilities.length > 64
    || !value.requestedCapabilities.every((candidate) => isBoundedString(candidate, 128))
  )) return false
  if (value.toolDefinitions !== undefined && (
    !Array.isArray(value.toolDefinitions)
    || value.toolDefinitions.length > 64
    || !value.toolDefinitions.every(isChatToolDefinition)
  )) return false
  if (value.providerStateBinding !== undefined) {
    if (!isChatProviderStateBinding(value.providerStateBinding)) return false
    if (
      value.providerStateBinding.providerId !== value.providerId
      || value.providerStateBinding.model !== value.model
    ) return false
  }
  return true
}

/** Validates, clones, bounds, and deeply freezes one provider-neutral request. */
export function freezeChatRequest(value: unknown): ChatRequest {
  if (!isChatRequest(value)) throw new Error('The provider-neutral request is invalid.')
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new Error('The provider-neutral request is not serializable.')
  }
  if (serialized.length > CHAT_REQUEST_MAX_SERIALIZED_CHARACTERS) {
    throw new Error('The provider-neutral request exceeds the serialized size limit.')
  }
  const cloned = JSON.parse(serialized) as unknown
  if (!isChatRequest(cloned)) throw new Error('The provider-neutral request clone is invalid.')
  return deepFreeze(cloned)
}

function isChatMessageInput(value: unknown): value is ChatMessageInput {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['id', 'role', 'text'], [
    'toolCallId',
    'name',
    'reasoningReplay',
    'toolCalls',
  ])) return false
  if (
    !isBoundedIdentity(value.id)
    || !isChatMessageRole(value.role)
    || !isBoundedText(value.text, 262_144)
  ) return false
  if (value.toolCallId !== undefined && !isBoundedIdentity(value.toolCallId)) return false
  if (value.name !== undefined && !isBoundedIdentity(value.name)) return false
  if (value.reasoningReplay !== undefined && (
    value.role !== 'assistant'
    || !Array.isArray(value.reasoningReplay)
    || value.reasoningReplay.length > 32
    || !value.reasoningReplay.every(isChatReasoningReplayPart)
  )) return false
  return value.toolCalls === undefined || (
    value.role === 'assistant'
    && Array.isArray(value.toolCalls)
    && value.toolCalls.length <= 64
    && value.toolCalls.every(isChatToolCall)
  )
}

function isChatToolCall(value: unknown): boolean {
  return isPlainRecord(value)
    && hasExactKeys(value, ['callId', 'name', 'arguments'], ['providerMetadata'])
    && isBoundedIdentity(value.callId)
    && isBoundedIdentity(value.name)
    && isJsonRecord(value.arguments)
    && (value.providerMetadata === undefined || isChatToolCallProviderMetadata(value.providerMetadata))
}

function isChatToolCallProviderMetadata(value: unknown): value is ChatToolCallProviderMetadata {
  if (!isPlainRecord(value) || !hasExactKeys(value, [], [
    'providerCallId',
    'providerCallIndex',
    'thoughtSignature',
  ])) return false
  return (value.providerCallId === undefined || isBoundedIdentity(value.providerCallId))
    && (value.providerCallIndex === undefined || isNonNegativeInteger(value.providerCallIndex))
    && (value.thoughtSignature === undefined || isBoundedString(value.thoughtSignature, 262_144))
}

function isChatReasoningReplayPart(value: unknown): value is ChatReasoningReplayPart {
  if (!isPlainRecord(value) || typeof value.kind !== 'string') return false
  if (value.kind === 'text') {
    return hasExactKeys(value, ['kind', 'text'])
      && isBoundedText(value.text, 262_144)
  }
  if (value.kind === 'encrypted') {
    return hasExactKeys(value, ['kind', 'id', 'data'], ['summary'])
      && isBoundedIdentity(value.id)
      && isBoundedString(value.data, 1_048_576)
      && (value.summary === undefined || (
        Array.isArray(value.summary)
        && value.summary.length <= 64
        && value.summary.every((item) => isBoundedText(item, 4_096))
      ))
  }
  if (value.kind === 'thinking') {
    return hasExactKeys(value, ['kind', 'text'], ['signature'])
      && isBoundedText(value.text, 262_144)
      && (value.signature === undefined || isBoundedString(value.signature, 262_144))
  }
  if (value.kind === 'redacted') {
    return hasExactKeys(value, ['kind', 'data'])
      && isBoundedString(value.data, 1_048_576)
  }
  return false
}

function isChatToolDefinition(value: unknown): value is ChatToolDefinition {
  return isPlainRecord(value)
    && hasExactKeys(value, ['operationId', 'name', 'description', 'inputSchema', 'permission'])
    && isBoundedString(value.operationId, 160)
    && isBoundedString(value.name, 160)
    && isBoundedText(value.description, 2_048)
    && isJsonRecord(value.inputSchema)
    && (value.permission === 'read-only' || value.permission === 'read-write' || value.permission === 'destructive')
}

function isChatProviderStateBinding(value: unknown): value is ChatProviderStateBinding {
  return isPlainRecord(value)
    && hasExactKeys(value, ['providerId', 'model'])
    && isBoundedIdentity(value.providerId)
    && isBoundedIdentity(value.model)
}

function isGenerationParameterSources(value: unknown): value is GenerationParameterSources {
  if (!isPlainRecord(value) || !hasExactKeys(value, [], [
    'temperature',
    'topP',
    'topK',
    'maxTokens',
  ])) return false
  return Object.values(value).every((source) => (
    source === 'provider-default' || source === 'explicit' || source === 'internal-policy'
  ))
}

function isChatMessageRole(value: unknown): value is ChatMessageRole {
  return value === 'system' || value === 'user' || value === 'assistant' || value === 'tool'
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return value === 'none' || value === 'minimal' || value === 'low' || value === 'medium'
    || value === 'high' || value === 'xhigh' || value === 'max'
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value)
  const allowed = new Set([...required, ...optional])
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && keys.every((key) => allowed.has(key))
}

function isJsonRecord(value: unknown, ancestors = new Set<object>(), depth = 0): value is JsonRecord {
  if (!isPlainRecord(value) || depth > 64 || ancestors.has(value)) return false
  ancestors.add(value)
  try {
    return Object.values(value).every((item) => isJsonValue(item, ancestors, depth + 1))
  } finally {
    ancestors.delete(value)
  }
}

function isJsonValue(value: unknown, ancestors: Set<object>, depth: number): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) {
    if (depth > 64 || ancestors.has(value)) return false
    ancestors.add(value)
    try {
      return value.every((item) => isJsonValue(item, ancestors, depth + 1))
    } finally {
      ancestors.delete(value)
    }
  }
  return isJsonRecord(value, ancestors, depth)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isBoundedIdentity(value: unknown): value is string {
  return isBoundedString(value, 320)
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function deepFreeze<Value>(value: Value): Value {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return Object.freeze(value)
}
