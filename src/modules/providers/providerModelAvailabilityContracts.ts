import type { ProviderCredentialSource, ProviderProtocolAdapterId } from '@/types/providerContracts'
import type { ProviderModelAdvertisement, ProviderModelAvailability, ProviderModelAvailabilityEvidence } from './providerModelAvailability'

export interface ProviderModelScopeIdentity {
  providerId: string
  credentialSource: ProviderCredentialSource
  protocolAdapterId: ProviderProtocolAdapterId
  /** Route family/deployment identity, never an endpoint URL or credential fingerprint. */
  endpointVariant: string
}

export interface ProviderModelRefreshSummary {
  schema: 'islemind.model-refresh-summary.v1'
  status: 'success' | 'failure' | 'unsupported' | 'cancelled'
  completeness: 'complete' | 'partial' | 'unknown'
  authority: 'catalog-only' | 'access-authoritative'
  coverage: 'exact-scope' | 'filtered' | 'unknown'
  pagination: 'exhausted' | 'incomplete' | 'unknown'
  truncation: 'none' | 'detected' | 'unknown'
  source: 'openai' | 'anthropic' | 'google' | 'compatible' | 'github-catalog' | 'mimo' | 'unsupported'
  observedAt: number
}

export interface ProviderModelScope extends ProviderModelScopeIdentity {
  scopeId: string
  epoch: string
  invalidatedAt?: number
  refreshOrder: number
  refreshSummary?: ProviderModelRefreshSummary
  lastSuccessfulRefreshAt?: number
}

/** Allocated once, before I/O. A result cannot obtain a fresh token when it finishes. */
export interface ProviderModelOperation {
  scopeId: string
  epoch: string
  operationId: string
  orderToken: number
  startedAt: number
}

export type ProviderModelObservationSource = 'discovery' | 'probe' | 'generation' | 'lifecycle'
export type ProviderModelObservationOutcome = 'success' | 'failure' | 'unsupported' | 'cancelled'
export type ProviderModelObservationEffect = 'applied' | 'preserved' | 'superseded' | 'invalidated'

export interface ProviderModelCurrent extends ProviderModelScopeIdentity {
  scopeId: string
  modelId: string
  epoch: string
  availability: ProviderModelAvailability
  advertisement: ProviderModelAdvertisement
  lastAppliedOrder: number
  evidence?: {
    schema: 'islemind.model-availability-evidence.v1'
    source: ProviderModelObservationSource
    observedAt: number
    evidence: ProviderModelAvailabilityEvidence
  }
  lastSeenAt?: number
  updatedAt: number
  invalidated: boolean
}

/** No free-form errors, response bodies, prompts, headers or credential values. */
export interface ProviderModelObservationInput {
  eventKey: string
  modelId?: string
  observedAt: number
  source: ProviderModelObservationSource
  outcome: ProviderModelObservationOutcome
  evidence: ProviderModelAvailabilityEvidence
  latencyMs?: number
  httpStatus?: number
}

/** Scope identity is joined at query time, not duplicated in the observation table. */
export interface ProviderModelObservation extends ProviderModelScopeIdentity, Omit<ProviderModelObservationInput, 'evidence'>, Omit<ProviderModelOperation, 'startedAt'> {
  id: number
  classification: ProviderModelAvailabilityEvidence['kind'] | Extract<ProviderModelAvailabilityEvidence, { kind: 'operational' }>['reason']
  availabilityAfter?: ProviderModelAvailability
  effect: ProviderModelObservationEffect
}

export interface ProviderModelHistoryFilter {
  providerId?: string
  scopeId?: string
  credentialSource?: ProviderCredentialSource
  modelId?: string
  from?: number
  to?: number
  source?: ProviderModelObservationSource
  outcome?: ProviderModelObservationOutcome
}

export interface ProviderModelHistoryCursor {
  schema: 'islemind.model-history-cursor.v1'
  filterKey: string
  highWaterId: number
  observedAt: number
  id: number
}

export interface ProviderModelHistoryPage {
  items: readonly ProviderModelObservation[]
  nextCursor?: ProviderModelHistoryCursor
  highWaterId: number
  counts: { total: number; success: number; failure: number; applied: number; preserved: number; superseded: number; invalidated: number }
}

/** Owner-private persistence port. Bootstrap binds the adapter; Presentation receives a use-case facade. */
export interface ProviderModelAvailabilityRepository {
  ensureScope(identity: ProviderModelScopeIdentity): Promise<ProviderModelScope>
  getScope(scopeId: string): Promise<ProviderModelScope | undefined>
  beginOperation(scopeId: string, operationId?: string): Promise<ProviderModelOperation>
  commit(operation: ProviderModelOperation, observations: readonly ProviderModelObservationInput[], refresh?: ProviderModelRefreshSummary): Promise<{ inserted: number; deleted: boolean }>
  getCurrent(scopeId: string, modelId: string): Promise<ProviderModelCurrent | undefined>
  listCurrent(input: { providerId?: string; scopeId?: string; credentialSource?: ProviderCredentialSource; modelId?: string; limit: number; after?: { scopeId: string; modelId: string } }): Promise<readonly ProviderModelCurrent[]>
  queryHistory(input: { filter: ProviderModelHistoryFilter; limit: number; cursor?: ProviderModelHistoryCursor }): Promise<ProviderModelHistoryPage>
  invalidateProvider(providerId: string): Promise<void>
  invalidateAll(): Promise<void>
  removeProvider(providerId: string): Promise<void>
  clear(): Promise<void>
  cleanup(input: { before: number; maxRecords: number; batchSize: number }): Promise<{ removed: number; hasMore: boolean }>
}
