import type {
  ChatMessageInput,
  GenerationParameterKey,
  ReasoningEffort,
  ConversationContextPolicyOverride,
  ConversationScenePlanSource,
  ConversationResourceScopeOverride,
  ToolDeclarationMode,
} from '@/core'
import * as v from 'valibot'
import { normalizeConversationContextPolicy } from './conversationContextPolicy'
import { normalizeConversationResourceScope, normalizeConversationScenePlanSource } from './conversationScenePlan'
import { normalizeModelRoutingPlan, sameModelRoute, type ModelRoutingPlan } from '@/core/modelRoutingPlan'

export const CONVERSATION_SNAPSHOT_SCHEMA = 'islemind.conversation-snapshot.v3'
const PREVIOUS_CONVERSATION_SNAPSHOT_SCHEMA = 'islemind.conversation-snapshot.v2'
const LEGACY_CONVERSATION_SNAPSHOT_SCHEMA = 'islemind.conversation-snapshot.v1'

export type ConversationGenerationParameterOverrides = Partial<
  Readonly<Record<GenerationParameterKey, boolean>>
>

export interface ConversationSnapshot {
  schema: typeof CONVERSATION_SNAPSHOT_SCHEMA
  id: string
  providerId: string | null
  model: string | null
  providerModelMode?: 'inherited' | 'manual'
  routingPlan?: ModelRoutingPlan
  systemPrompt?: string
  temperature?: number
  topP?: number
  topK?: number
  reasoningEffort?: ReasoningEffort
  maxTokens?: number
  generationParameterOverrides?: ConversationGenerationParameterOverrides
  contextPolicyOverride?: ConversationContextPolicyOverride
  toolDeclarationModeOverride?: ToolDeclarationMode
  scenePlanSource?: ConversationScenePlanSource
  resourceScopeOverride?: ConversationResourceScopeOverride
  messages: readonly ChatMessageInput[]
}

const reasoningEffortSchema = v.picklist(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])

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
  providerId: v.nullish(v.string()),
  model: v.nullish(v.string()),
  providerModelMode: v.optional(v.picklist(['inherited', 'manual'])),
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
  if (!parsed.output.id.trim()) return undefined
  const contextPolicyValue = (value as Record<string, unknown>).contextPolicyOverride
  const contextPolicyOverride = normalizeConversationContextPolicy(contextPolicyValue)
  if (contextPolicyValue !== undefined && !contextPolicyOverride) return undefined
  const toolDeclarationModeOverride = (value as Record<string, unknown>).toolDeclarationModeOverride
  if (toolDeclarationModeOverride !== undefined && toolDeclarationModeOverride !== 'full' && toolDeclarationModeOverride !== 'auto') return undefined
  const sourceValue = (value as Record<string, unknown>).scenePlanSource
  const scenePlanSource = normalizeConversationScenePlanSource(sourceValue)
  if (sourceValue !== undefined && !scenePlanSource) return undefined
  const scopeValue = (value as Record<string, unknown>).resourceScopeOverride
  const resourceScopeOverride = normalizeConversationResourceScope(scopeValue)
  if (scopeValue !== undefined && !resourceScopeOverride) return undefined
  const routingValue = (value as Record<string, unknown>).routingPlan
  const routingPlan = normalizeModelRoutingPlan(routingValue)
  if (routingValue !== undefined && (!routingPlan || !sameModelRoute(routingPlan.primary,
    { providerId: parsed.output.providerId ?? '', model: parsed.output.model ?? '' }))) return undefined

  const messages = parsed.output.messages.flatMap<ChatMessageInput>((message) => {
    const text = message.responseText ?? message.text ?? message.content ?? ''
    if (!text.trim()) return []
    return [{ id: message.id, role: message.role, text }]
  })

  return {
    schema: CONVERSATION_SNAPSHOT_SCHEMA,
    id: parsed.output.id,
    ...(routingPlan ? { routingPlan } : {}),
    ...(contextPolicyOverride ? { contextPolicyOverride } : {}),
    ...(toolDeclarationModeOverride ? { toolDeclarationModeOverride } : {}),
    ...(scenePlanSource ? { scenePlanSource } : {}),
    ...(resourceScopeOverride ? { resourceScopeOverride } : {}),
    providerId: parsed.output.providerId ?? null,
    model: parsed.output.model ?? null,
    ...(parsed.output.providerModelMode ? { providerModelMode: parsed.output.providerModelMode } : {}),
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
  return schema === CONVERSATION_SNAPSHOT_SCHEMA || schema === PREVIOUS_CONVERSATION_SNAPSHOT_SCHEMA || schema === LEGACY_CONVERSATION_SNAPSHOT_SCHEMA
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
