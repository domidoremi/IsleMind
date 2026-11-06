import type { ProviderConnectionReference, ProviderConnectionReferences, ProviderConnectionReferenceKind } from '@/core'

export const PROVIDER_CONNECTION_REFERENCE_ITEM_LIMIT = 25
const KINDS: ProviderConnectionReferenceKind[] = ['conversation', 'routing', 'scene', 'default', 'preferred', 'favorite']

export function buildProviderConnectionReferences(input: {
  providerIds: readonly string[]
  references: readonly ProviderConnectionReference[]
  conversations: ProviderConnectionReferences['conversations']
  capturedAt: number
}): ProviderConnectionReferences {
  return {
    providerIds: [...new Set(input.providerIds)],
    groups: KINDS.map(kind => {
      const items = input.references.filter(reference => reference.kind === kind)
      return {
        kind, total: items.length, truncated: items.length > PROVIDER_CONNECTION_REFERENCE_ITEM_LIMIT,
        items: items.slice(0, PROVIDER_CONNECTION_REFERENCE_ITEM_LIMIT).map(reference => ({
          kind, id: reference.id, label: reference.label,
          targets: reference.targets.map(target => ({
            providerId: target.providerId, role: target.role, ...(target.model === undefined ? {} : { model: target.model }),
          })),
          ...(reference.draft ? { draft: true } : {}),
        })),
      }
    }),
    conversations: { ...input.conversations },
    capturedAt: input.capturedAt,
  }
}
