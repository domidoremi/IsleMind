import { snapshotPlainData, type ProviderConnectionReference } from '@/core'
import { buildProviderConnectionReferences } from '@/modules/providers'
import type { ConversationProviderReferenceReader } from '@/modules/conversations'
import type { ProviderConnectionReferencePort } from '@/presentation/features/settings/providerConnectionReferencePort'

export interface ProviderConnectionReferenceSnapshot {
  settingsReferences: ProviderConnectionReference[]
  localReferences: ProviderConnectionReference[]
  localSaved: number
  localDrafts: number
  localUnreadable: number
  localIds: string[]
}

export const PROVIDER_CONNECTION_REFERENCES_CHANGED = 'provider_connection_references_changed'

export function createProviderConnectionReferenceRuntime(dependencies: {
  capture(providerIds: readonly string[]): ProviderConnectionReferenceSnapshot
  reader: ConversationProviderReferenceReader
  now(): number
}): ProviderConnectionReferencePort {
  return {
    async load(providerIds, signal) {
      const cancelled = () => { if (signal?.aborted) throw new Error('provider_connection_references_cancelled') }
      cancelled()
      const ids = [...new Set(providerIds)]
      const captured = snapshotPlainData(dependencies.capture(ids))
      const saved = await dependencies.reader.readProviderReferences({ providerIds: ids, excludeConversationIds: captured.localIds })
      cancelled()
      // A reply's text changes do not invalidate configuration. A model,
      // template, title or local draft change does; never combine two views.
      if (JSON.stringify(captured) !== JSON.stringify(dependencies.capture(ids))) {
        throw new Error(PROVIDER_CONNECTION_REFERENCES_CHANGED)
      }
      return snapshotPlainData(buildProviderConnectionReferences({
        providerIds: ids,
        references: [...captured.localReferences, ...saved.references, ...captured.settingsReferences],
        conversations: {
          savedInspected: captured.localSaved + saved.inspected, savedRemaining: saved.remaining,
          unreadable: captured.localUnreadable + saved.unreadable, localDrafts: captured.localDrafts,
        },
        capturedAt: dependencies.now(),
      }))
    },
  }
}
