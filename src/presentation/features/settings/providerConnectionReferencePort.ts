import type { ProviderConnectionReferences } from '@/core'

/** Read-only, injected configuration projection. No persistence or provider API. */
export interface ProviderConnectionReferencePort {
  load(providerIds: readonly string[], signal?: AbortSignal): Promise<ProviderConnectionReferences>
}
