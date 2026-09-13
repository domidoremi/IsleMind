import type { AIModel } from '@/types/providerContracts'
import type { ProviderModelOperation, ProviderModelRefreshSummary, ProviderModelScopeIdentity } from './providerModelAvailabilityContracts'

export interface ProviderModelDiscoveryResult extends Omit<ProviderModelRefreshSummary, 'schema' | 'observedAt'> {
  schema: 'islemind.model-discovery-result.v1'
  providerId: string
  models: AIModel[]
  /** Valid IDs before presentation/capability filtering; never a historical snapshot. */
  advertisedModelIds: readonly string[]
  valid: boolean
  scope?: ProviderModelScopeIdentity
  operation?: ProviderModelOperation
  failureReason?: 'invalid_configuration' | 'http' | 'timeout' | 'network' | 'malformed' | 'pagination' | 'cancelled'
  httpStatus?: number
  retryAfterMs?: number
}

/** Absence is not retirement. Persistence also checks scope epoch/order in the commit transaction. */
export function canApplyProviderModelDiscoveryAbsence(result: ProviderModelDiscoveryResult): boolean {
  return result.status === 'success' && result.valid && result.completeness === 'complete'
    && result.authority === 'access-authoritative' && result.coverage === 'exact-scope'
    && result.pagination === 'exhausted' && result.truncation === 'none'
    && result.scope?.providerId === result.providerId && !!result.operation
}
