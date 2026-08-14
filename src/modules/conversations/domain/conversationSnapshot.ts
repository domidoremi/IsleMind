import type {
  ChatMessageInput,
  GenerationParameterKey,
  ReasoningEffort,
} from '@/core'
import * as v from 'valibot'

export const CONVERSATION_SNAPSHOT_SCHEMA = 'islemind.conversation-snapshot.v2'
const LEGACY_CONVERSATION_SNAPSHOT_SCHEMA = 'islemind.conversation-snapshot.v1'

export type ConversationGenerationParameterOverrides = Partial<
  Readonly<Record<GenerationParameterKey, boolean>>
>

export interface ConversationSnapshot {
  schema: typeof CONVERSATION_SNAPSHOT_SCHEMA
  id: string
  providerId: string
  model: string
  systemPrompt?: string
  temperature?: number
  topP?: number
  topK?: number
  reasoningEffort?: ReasoningEffort
  maxTokens?: number
  generationParameterOverrides?: ConversationGenerationParameterOverrides
  messages: readonly ChatMessageInput[]
}

const reasoningEffortSchema = v.picklist(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

const generationParameterOverridesSchema = v.object({
  temperature: v.optional(v.boolean()),
  topP: v.optional(v.boolean()),
  topK: v.optional(v.boolean()),
  maxTokens: v.optional(v.boolean()),
})

const legacyMessageSchema = v.object({
  id: v.string(),
  role: v.picklist(['user', 'assistant']),
  content: v.optional(v.string()),
  text: v.optional(v.string()),
  responseText: v.optional(v.string()),
})

const legacyConversationSchema = v.object({
  id: v.string(),
  providerId: v.string(),
  model: v.string(),
  systemPrompt: v.optional(v.string()),
  temperature: v.optional(v.number()),
  topP: v.optional(v.number()),
  topK: v.optional(v.number()),
  reasoningEffort: v.optional(reasoningEffortSchema),
  maxTokens: v.optional(v.number()),
  generationParameterOverrides: v.optional(generationParameterOverridesSchema),
  messages: v.array(legacyMessageSchema),
})

export function parseConversationSnapshot(value: unknown): ConversationSnapshot | undefined {
  if (!hasSupportedConversationSchema(value)) return undefined
  const parsed = v.safeParse(legacyConversationSchema, value)
  if (!parsed.success) return undefined
  if (!parsed.output.id.trim() || !parsed.output.providerId.trim() || !parsed.output.model.trim()) return undefined

  const messages = parsed.output.messages.flatMap<ChatMessageInput>((message) => {
    const text = message.responseText ?? message.text ?? message.content ?? ''
    if (!text.trim()) return []
    return [{ id: message.id, role: message.role, text }]
  })

  return {
    schema: CONVERSATION_SNAPSHOT_SCHEMA,
    id: parsed.output.id,
    providerId: parsed.output.providerId,
    model: parsed.output.model,
    ...(parsed.output.systemPrompt?.trim() ? { systemPrompt: parsed.output.systemPrompt } : {}),
    ...(isFiniteNumber(parsed.output.temperature) ? { temperature: parsed.output.temperature } : {}),
    ...(isFiniteNumber(parsed.output.topP) ? { topP: parsed.output.topP } : {}),
    ...(isFiniteNumber(parsed.output.topK) ? { topK: parsed.output.topK } : {}),
    ...(parsed.output.reasoningEffort ? { reasoningEffort: parsed.output.reasoningEffort } : {}),
    ...(isFinitePositiveInteger(parsed.output.maxTokens) ? { maxTokens: parsed.output.maxTokens } : {}),
    ...(Object.prototype.hasOwnProperty.call(parsed.output, 'generationParameterOverrides')
      ? { generationParameterOverrides: compactGenerationParameterOverrides(parsed.output.generationParameterOverrides) }
      : {}),
    messages,
  }
}

function hasSupportedConversationSchema(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (!Object.prototype.hasOwnProperty.call(value, 'schema')) return true
  const schema = (value as Record<string, unknown>).schema
  return schema === CONVERSATION_SNAPSHOT_SCHEMA || schema === LEGACY_CONVERSATION_SNAPSHOT_SCHEMA
}

function compactGenerationParameterOverrides(
  overrides: ConversationGenerationParameterOverrides | undefined,
): ConversationGenerationParameterOverrides {
  const compacted: Record<string, true> = {}
  for (const key of ['temperature', 'topP', 'topK', 'maxTokens'] as const) {
    if (overrides?.[key] === true) compacted[key] = true
  }
  return compacted
}

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isFinitePositiveInteger(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
