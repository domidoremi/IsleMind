import { createProviderModelAvailabilityRuntime, createSqliteModelAvailabilityRepository,
  type ProviderModelAvailabilityPort, type ProviderExecutionIdentity, type ProviderRuntimeChatRequest } from '@/modules/providers'
import { createExpoSqliteDatabaseProvider } from '@/platform/storage'

// Stage 9 M2007J3SC calibration: 8-row writes preserve queue headroom versus
// 16/25/50/100-row batches; virtualized 50-row pages bound UI/JS work. The weekly
// history window retains 500 observations without pruning current lifecycle proof.
// These bounds apply to history/work batches, never to discovery catalog coverage.
export const providerModelAvailabilityIntegrationProfile = {
  pageSize: 50, maxPageSize: 100, writeBatchSize: 8, cleanupBatchSize: 8,
  historyAgeMs: 7 * 24 * 60 * 60 * 1000, maxHistoryRecords: 500,
  maxObservationPayloadBytes: 8192,
} as const

const profile = providerModelAvailabilityIntegrationProfile
const repository = createSqliteModelAvailabilityRepository(createExpoSqliteDatabaseProvider(), {
  newId: () => `availability-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  now: Date.now, maxPageSize: profile.maxPageSize, maxWriteBatchSize: profile.writeBatchSize,
  maxObservationPayloadBytes: profile.maxObservationPayloadBytes,
})

let operations: Pick<ProviderModelAvailabilityPort, 'refresh' | 'retest'> | undefined
/** Bootstrap installs the existing operation delegates without a storage -> runtime/store cycle. */
export function bindProviderModelAvailabilityOperations(value: Pick<ProviderModelAvailabilityPort, 'refresh' | 'retest'>): void {
  operations = value
}

export const providerModelAvailabilityRuntime = createProviderModelAvailabilityRuntime({
  repository: { ...repository, async commit(...args) {
    const result = await repository.commit(...args)
    await repository.cleanup({ before: Math.max(0, Date.now() - profile.historyAgeMs), maxRecords: profile.maxHistoryRecords, batchSize: profile.cleanupBatchSize })
    return result
  } },
  now: Date.now, writeBatchSize: profile.writeBatchSize, queryPageSize: profile.pageSize,
  async refresh(input) {
    if (!operations) throw new Error('Provider discovery has not been bound')
    await operations.refresh(input)
  },
  async retest(input) {
    if (!operations) throw new Error('Provider retest has not been bound')
    await operations.retest(input)
  },
})

/** Presentation receives only the secret-free use-case port, never the SQL adapter. */
export const providerModelAvailabilityPort: ProviderModelAvailabilityPort = providerModelAvailabilityRuntime.port

export async function withProviderModelAvailabilityChanges<T>(providerIds: readonly string[], mutation: () => Promise<T>, remove = false): Promise<T> {
  const ids = [...new Set(providerIds)]
  const apply = (index: number): Promise<T> => index >= ids.length ? mutation()
    : providerModelAvailabilityRuntime.withProviderMutation(ids[index], () => apply(index + 1), remove)
  return apply(0)
}

export async function resolveRuntimeModelIdentity(provider: ProviderRuntimeChatRequest['provider'], model: string, source = provider.apiKeySource): Promise<ProviderExecutionIdentity> {
  const [{ resolveProviderProtocolAdapter }, { resolveProviderEndpointVariant }, { resolveProviderModelAlias }] = await Promise.all([
    import('./providerRequestBinding'), import('@/modules/providers'), import('@/utils/providerModels'),
  ])
  const upstream = resolveProviderModelAlias(provider, model)
  const adapter = resolveProviderProtocolAdapter({ provider, model: upstream, messages: [], generationParameterSources: {} })
  return { providerId: provider.id, model: upstream, credentialSource: source ?? { kind: 'none' },
    protocolAdapterId: adapter.id, endpointVariant: resolveProviderEndpointVariant(provider) }
}
