import type { ConversationContextPolicyOverride } from '@/core'

export const CONVERSATION_CONTEXT_POLICY_SCHEMA = 'islemind.conversation-context-policy.v1' as const

export function normalizeConversationContextPolicy(value: unknown): ConversationContextPolicyOverride | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const fields = value as Record<string, unknown>
  if (fields.schema !== CONVERSATION_CONTEXT_POLICY_SCHEMA
    || typeof fields.remoteCompactThreshold !== 'number' || !Number.isFinite(fields.remoteCompactThreshold)
    || fields.remoteCompactThreshold < 0.1 || fields.remoteCompactThreshold > 2
    || Object.keys(fields).some(key => key !== 'schema' && key !== 'remoteCompactThreshold')) return undefined
  return { schema: CONVERSATION_CONTEXT_POLICY_SCHEMA, remoteCompactThreshold: fields.remoteCompactThreshold }
}

export function conversationContextPolicyRevision(conversation: {
  id: string
  providerId: string | null
  model: string | null
  contextPolicyOverride?: ConversationContextPolicyOverride
}): string {
  return JSON.stringify([conversation.id, conversation.providerId, conversation.model, conversation.contextPolicyOverride ?? null])
}

export function applyConversationContextPolicy<TConversation extends {
  contextPolicyOverride?: ConversationContextPolicyOverride
  updatedAt: number
}>(
  conversation: TConversation,
  override: ConversationContextPolicyOverride | undefined,
  now: number,
): TConversation {
  const normalized = normalizeConversationContextPolicy(override)
  if (override !== undefined && !normalized) throw new Error('conversation_context_policy_invalid')
  const next = { ...conversation, updatedAt: now }
  if (normalized) next.contextPolicyOverride = normalized
  else delete next.contextPolicyOverride
  return next
}
