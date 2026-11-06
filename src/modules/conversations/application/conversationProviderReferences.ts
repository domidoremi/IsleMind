import { normalizeModelRoutingPlan, type ProviderConnectionReference, type ProviderConnectionReferenceTarget } from '@/core'

export interface ConversationProviderReferenceReadInput {
  providerIds: readonly string[]
  excludeConversationIds?: readonly string[]
  /** Bounded metadata scan. Uninspected rows remain explicitly unknown. */
  limit?: number
}

export interface ConversationProviderReferenceRead {
  references: ProviderConnectionReference[]
  inspected: number
  remaining: number
  unreadable: number
}

export interface ConversationProviderReferenceReader {
  readProviderReferences(input: ConversationProviderReferenceReadInput): Promise<ConversationProviderReferenceRead>
}

export function projectConversationProviderReference(
  value: unknown,
  providerIds: readonly string[],
  draft = false,
): { reference?: ProviderConnectionReference; unreadable: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { unreadable: true }
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || !record.id.trim()
    || (record.providerId != null && typeof record.providerId !== 'string')
    || (record.model != null && typeof record.model !== 'string')) return { unreadable: true }
  const routingPlan = normalizeModelRoutingPlan(record.routingPlan)
  if (record.routingPlan != null && !routingPlan) return { unreadable: true }
  const ids = new Set(providerIds)
  const targets: ProviderConnectionReferenceTarget[] = [
    ...(typeof record.providerId === 'string' ? [{
      providerId: record.providerId,
      ...(typeof record.model === 'string' ? { model: record.model } : {}),
      role: 'model' as const,
    }] : []),
    ...(routingPlan ? [{ ...routingPlan.primary, role: 'primary' as const },
      ...(routingPlan.mode === 'fallback' && routingPlan.backup ? [{ ...routingPlan.backup, role: 'backup' as const }] : [])] : []),
  ].filter(target => ids.has(target.providerId))
  return {
    unreadable: false,
    ...(targets.length ? { reference: {
      kind: 'conversation', id: record.id,
      label: typeof record.title === 'string' ? record.title.slice(0, 240) : '',
      targets, ...(draft ? { draft: true } : {}),
    } satisfies ProviderConnectionReference } : {}),
  }
}
