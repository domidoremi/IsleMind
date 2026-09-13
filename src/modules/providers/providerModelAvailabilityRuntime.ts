import type { AIProvider, ProviderCredentialSource } from '@/types/providerContracts'
import type { ProviderExecutionIdentity } from './providerExecutionTarget'
import type { ProviderModelAvailabilityEvidence } from './providerModelAvailability'
import type { ProviderModelAvailabilityRepository, ProviderModelHistoryCursor, ProviderModelHistoryFilter, ProviderModelHistoryPage, ProviderModelCurrent, ProviderModelOperation, ProviderModelRefreshSummary, ProviderModelScopeIdentity, ProviderModelObservationInput } from './providerModelAvailabilityContracts'
import { canApplyProviderModelDiscoveryAbsence, type ProviderModelDiscoveryResult } from './providerModelDiscoveryEvidence'
import type { ProviderProbeResult } from './providerProbe'

export interface ProviderModelAvailabilityPort {
  listCurrentModels(input: { providerId?: string; scopeId?: string; credentialSource?: ProviderCredentialSource; modelId?: string; limit: number; after?: { scopeId: string; modelId: string } }): Promise<readonly ProviderModelCurrent[]>
  queryHistory(input: { filter: ProviderModelHistoryFilter; limit: number; cursor?: ProviderModelHistoryCursor }): Promise<ProviderModelHistoryPage>
  refresh(input: { providerId: string; credentialSource?: ProviderCredentialSource; signal?: AbortSignal }): Promise<void>
  retest(input: { providerId: string; model: string; credentialSource?: ProviderCredentialSource; signal?: AbortSignal }): Promise<void>
}

export interface ProviderModelAvailabilityRuntimeDependencies {
  repository: ProviderModelAvailabilityRepository
  /** Existing model-list/group synchronization and non-generating model-test use cases. */
  refresh: ProviderModelAvailabilityPort['refresh']
  retest: ProviderModelAvailabilityPort['retest']
  now(): number
  writeBatchSize: number
  queryPageSize: number
}

/** Evidence coordinator, not a discovery worker or a route/failover executor. */
export function createProviderModelAvailabilityRuntime(dependencies: ProviderModelAvailabilityRuntimeDependencies) {
  const { repository, writeBatchSize, queryPageSize } = dependencies
  if (!Number.isSafeInteger(writeBatchSize) || writeBatchSize <= 0 || !Number.isSafeInteger(queryPageSize) || queryPageSize <= 0) throw new Error('Invalid availability operation budgets')
  const changing = new Map<string, number>()
  const tokens = new Map<string, number>()
  let globalToken = 0
  let globalInvalidationFailed = false

  async function begin(identity: ProviderModelScopeIdentity, operationId?: string) {
    const token = tokens.get(identity.providerId) ?? 0
    const global = globalToken
    const check = () => {
      if (globalInvalidationFailed || changing.has(identity.providerId) || changing.has('*') || global !== globalToken || token !== (tokens.get(identity.providerId) ?? 0)) throw new Error('Provider configuration changed during model admission')
    }
    check()
    const scope = await repository.ensureScope(identity)
    check()
    const operation = await repository.beginOperation(scope.scopeId, operationId)
    check()
    return operation
  }

  async function commitBatches(operation: ProviderModelOperation, rows: readonly ProviderModelObservationInput[]) {
    for (let offset = 0; offset < rows.length; offset += writeBatchSize) {
      const result = await repository.commit(operation, rows.slice(offset, offset + writeBatchSize))
      if (result.deleted) return false
    }
    return true
  }

  const port: ProviderModelAvailabilityPort = {
    listCurrentModels: (input) => {
      if (globalInvalidationFailed || changing.has('*')) return Promise.reject(new Error('Model scopes could not be invalidated'))
      return repository.listCurrent(input)
    },
    queryHistory: (input) => repository.queryHistory(input),
    refresh: dependencies.refresh,
    retest: dependencies.retest,
  }

  return {
    port,
    /** Uses the same in-process invalidation tokens as evidence operations. */
    captureConfiguration() {
      const global = globalToken
      const captured = new Map(tokens)
      return () => {
        if (globalInvalidationFailed || changing.size || global !== globalToken || tokens.size !== captured.size
          || [...tokens].some(([providerId, token]) => captured.get(providerId) !== token)) throw new Error('Provider configuration changed during admission')
      }
    },
    async observeDiscovery(identity: ProviderModelScopeIdentity, execute: (operation: ProviderModelOperation) => Promise<ProviderModelDiscoveryResult>) {
      const operation = await begin(identity)
      const result = await execute(operation)
      if (result.providerId !== identity.providerId || result.operation?.operationId !== operation.operationId
        || result.operation.epoch !== operation.epoch || result.operation.scopeId !== operation.scopeId
        || !result.scope || scopeKey(result.scope) !== scopeKey(identity)) throw new Error('Discovery evidence does not match its captured scope')
      const observedAt = dependencies.now()
      const seen = new Set(result.advertisedModelIds)
      const positives: ProviderModelObservationInput[] = [...seen].map((modelId, index) => ({
        eventKey: `${operation.operationId}:present:${index}`, modelId, observedAt, source: 'discovery', outcome: 'success',
        evidence: { kind: 'discovery_present', accessAuthoritative: result.valid && result.authority === 'access-authoritative' },
      }))
      if (!await commitBatches(operation, positives)) return result
      if (canApplyProviderModelDiscoveryAbsence(result)) {
        let after: { scopeId: string; modelId: string } | undefined
        let index = 0
        while (true) {
          const page = await repository.listCurrent({ scopeId: operation.scopeId, limit: queryPageSize, after })
          const absent = page.filter((model) => !seen.has(model.modelId)).map((model) => ({
            eventKey: `${operation.operationId}:absent:${index++}`, modelId: model.modelId, observedAt, source: 'discovery' as const, outcome: 'success' as const,
            evidence: { kind: 'discovery_absent' as const, complete: true, accessAuthoritative: true },
          }))
          if (!await commitBatches(operation, absent)) return result
          const last = page[page.length - 1]
          if (!last || page.length < queryPageSize) break
          after = { scopeId: last.scopeId, modelId: last.modelId }
        }
      }
      const summary: ProviderModelRefreshSummary = {
        schema: 'islemind.model-refresh-summary.v1', status: result.status, completeness: result.completeness,
        authority: result.authority, coverage: result.coverage, pagination: result.pagination, truncation: result.truncation, source: result.source, observedAt,
      }
      await repository.commit(operation, [{ eventKey: `${operation.operationId}:summary`, observedAt, source: 'discovery', outcome: result.status,
        evidence: discoveryOperationalEvidence(result), ...(result.httpStatus ? { httpStatus: result.httpStatus } : {}),
      }], summary)
      return result
    },
    async observeProbe(identity: ProviderExecutionIdentity, execute: () => Promise<ProviderProbeResult>) {
      const operation = await begin(identity)
      const result = await execute()
      const evidence: ProviderModelAvailabilityEvidence = result.modelAccess === 'available' ? { kind: 'probe_success' }
        : result.modelAccess === 'unavailable' ? { kind: 'model_invalidated' }
        : { kind: 'operational', reason: result.evidence.classification === 'authentication_failed' || result.evidence.classification === 'credential_required' ? 'unauthorized'
          : result.evidence.classification === 'rate_limited' || result.evidence.classification === 'quota_exhausted' ? 'rate_limited'
          : result.evidence.classification === 'timed_out' ? 'timeout' : result.evidence.classification === 'cancelled' ? 'cancelled'
          : result.evidence.classification === 'network_error' ? 'dns_tls' : 'partial' }
      await repository.commit(operation, [{ eventKey: `${operation.operationId}:probe`, modelId: identity.model,
        observedAt: dependencies.now(), source: 'probe', outcome: result.ok ? 'success' : result.evidence.classification === 'cancelled' ? 'cancelled' : 'failure',
        evidence, latencyMs: result.durationMs, ...(result.httpStatus ? { httpStatus: result.httpStatus } : {}),
      }])
      return result
    },
    beginExecution: (identity: ProviderExecutionIdentity, attemptId: string) => begin(identity, attemptId),
    async settleExecution(operation: ProviderModelOperation, model: string, evidence: ProviderModelAvailabilityEvidence) {
      await repository.commit(operation, [{ eventKey: `${operation.operationId}:generation`, modelId: model, observedAt: dependencies.now(),
        source: 'generation', outcome: evidence.kind === 'generation_success' ? 'success' : evidence.kind === 'operational' && evidence.reason === 'cancelled' ? 'cancelled' : 'failure', evidence,
      }])
    },
    async getAvailability(identity: ProviderExecutionIdentity) {
      const operation = await begin(identity)
      const current = await repository.getCurrent(operation.scopeId, identity.model)
      return { scope: { scopeId: operation.scopeId, epoch: operation.epoch }, availability: current?.availability ?? 'unknown' as const }
    },
    /** Close admission, invalidate durably, then let the existing settings/credential owner mutate. */
    async withProviderMutation<T>(providerId: string, mutation: () => Promise<T>, remove = false): Promise<T> {
      changing.set(providerId, (changing.get(providerId) ?? 0) + 1)
      tokens.set(providerId, (tokens.get(providerId) ?? 0) + 1)
      try {
        await repository.invalidateProvider(providerId)
        const result = await mutation()
        if (remove) await repository.removeProvider(providerId)
        return result
      } finally {
        const count = (changing.get(providerId) ?? 1) - 1
        if (count) changing.set(providerId, count); else changing.delete(providerId)
      }
    },
    async invalidateAll() {
      globalToken++; changing.set('*', (changing.get('*') ?? 0) + 1)
      const token = globalToken
      try { await repository.invalidateAll(); if (token === globalToken) globalInvalidationFailed = false }
      catch (error) { if (token === globalToken) globalInvalidationFailed = true; throw error }
      finally { releaseGlobalChange() }
    },
    async withAllMutation<T>(mutation: () => Promise<T>): Promise<T> {
      globalToken++; changing.set('*', (changing.get('*') ?? 0) + 1)
      const token = globalToken
      try { await repository.invalidateAll(); if (token === globalToken) globalInvalidationFailed = false; return await mutation() }
      catch (error) { if (token === globalToken) globalInvalidationFailed = true; throw error }
      finally { releaseGlobalChange() }
    },
    async clear() {
      globalToken++; changing.set('*', (changing.get('*') ?? 0) + 1)
      const token = globalToken
      try { await repository.clear(); if (token === globalToken) globalInvalidationFailed = false }
      catch (error) { if (token === globalToken) globalInvalidationFailed = true; throw error }
      finally { releaseGlobalChange() }
    },
    cleanup: repository.cleanup,
  }

  function releaseGlobalChange() {
    const count = (changing.get('*') ?? 1) - 1
    if (count) changing.set('*', count); else changing.delete('*')
  }
}

function scopeKey(identity: ProviderModelScopeIdentity): string {
  return JSON.stringify([identity.providerId, identity.credentialSource.kind, identity.credentialSource.kind === 'group' ? identity.credentialSource.groupId : '', identity.protocolAdapterId, identity.endpointVariant])
}

function discoveryOperationalEvidence(result: ProviderModelDiscoveryResult): ProviderModelAvailabilityEvidence {
  return { kind: 'operational', reason: result.status === 'cancelled' ? 'cancelled' : result.status === 'unsupported' ? 'unsupported'
    : result.failureReason === 'timeout' ? 'timeout' : result.failureReason === 'network' ? 'dns_tls'
    : result.httpStatus === 401 || result.httpStatus === 403 ? 'unauthorized' : result.httpStatus === 429 ? 'rate_limited'
    : result.httpStatus === 404 || result.httpStatus === 410 ? 'generic_not_found' : (result.httpStatus ?? 0) >= 500 ? 'server_error' : 'partial' }
}

/** Metadata changes that alter a credential's access scope, not health/catalog refresh projections. */
export function providerModelScopeConfigurationChanged(previous: AIProvider | undefined, updates: Partial<AIProvider>): boolean {
  if (!previous) return true
  for (const field of ['type', 'enabled', 'baseUrl', 'wireProtocol', 'presetId', 'detectedPresetId', 'tokenPlanRegion', 'clientCompatibilityProfile', 'modelAliases'] as const) {
    if (Object.prototype.hasOwnProperty.call(updates, field) && JSON.stringify(previous[field]) !== JSON.stringify(updates[field])) return true
  }
  if (updates.credentialGroups) {
    const identity = (groups: AIProvider['credentialGroups']) => (groups ?? []).map((group) =>
      JSON.stringify([group.id, group.enabled, group.source?.kind ?? 'group'])).sort()
    if (JSON.stringify(identity(previous.credentialGroups)) !== JSON.stringify(identity(updates.credentialGroups))) return true
  }
  return false
}
