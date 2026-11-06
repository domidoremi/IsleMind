import type { Conversation } from '@/types/chatContracts'
import type { ConversationContextPolicyOverride } from '@/core'
import { applyConversationContextPolicy, conversationContextPolicyRevision, normalizeConversationContextPolicy } from '../domain/conversationContextPolicy'

export const CONVERSATION_CONTEXT_POLICY_CONFLICT = 'conversation_context_policy_conflict'
export const CONVERSATION_CONTEXT_POLICY_BUSY = 'conversation_context_policy_busy'
export const CONVERSATION_CONTEXT_POLICY_MISSING = 'conversation_context_policy_missing'

/** A conversation trial changes the captured threshold only, preserving network/summary opt-ins. */
export function resolveConversationContextSettings<T extends { remoteCompactThreshold?: number }>(
  settings: T,
  conversation: Pick<Conversation, 'contextPolicyOverride'> | undefined,
): T {
  const override = normalizeConversationContextPolicy(conversation?.contextPolicyOverride)
  return override ? { ...settings, remoteCompactThreshold: override.remoteCompactThreshold } : settings
}

export interface ConversationContextPolicyCommandPorts {
  readConversation(id: string): Conversation | undefined | Promise<Conversation | undefined>
  isBusy(id: string): boolean
  isDraft(id: string): boolean
  acquireLock(id: string): () => void
  persist(conversation: Conversation): Promise<void>
  publish(conversation: Conversation): void
  now(): number
}

export function createConversationContextPolicyCommand(ports: ConversationContextPolicyCommandPorts) {
  return async function save(
    id: string,
    override: ConversationContextPolicyOverride | undefined,
    expectedRevision: string,
  ): Promise<{ conversation: Conversation; persisted: boolean }> {
    const initial = await ports.readConversation(id)
    if (!initial) throw new Error(CONVERSATION_CONTEXT_POLICY_MISSING)
    if (conversationContextPolicyRevision(initial) !== expectedRevision) throw new Error(CONVERSATION_CONTEXT_POLICY_CONFLICT)
    if (ports.isBusy(id)) throw new Error(CONVERSATION_CONTEXT_POLICY_BUSY)
    const release = ports.acquireLock(id)
    try {
      const current = await ports.readConversation(id)
      if (!current) throw new Error(CONVERSATION_CONTEXT_POLICY_MISSING)
      if (conversationContextPolicyRevision(current) !== expectedRevision) throw new Error(CONVERSATION_CONTEXT_POLICY_CONFLICT)
      const next = applyConversationContextPolicy(current, override, ports.now())
      const persisted = !ports.isDraft(id)
      if (persisted) await ports.persist(next)
      const latest = await ports.readConversation(id)
      if (!latest) throw new Error(CONVERSATION_CONTEXT_POLICY_MISSING)
      const revision = conversationContextPolicyRevision(latest)
      if (revision !== expectedRevision && revision !== conversationContextPolicyRevision(next)) {
        throw new Error(CONVERSATION_CONTEXT_POLICY_CONFLICT)
      }
      const published = applyConversationContextPolicy(latest, next.contextPolicyOverride, next.updatedAt)
      ports.publish(published)
      return { conversation: published, persisted }
    } finally {
      release()
    }
  }
}
