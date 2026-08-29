import type { AIModel, AIProvider, ProviderCapabilities, ProviderCredentialGroup, ProviderOperationCode } from '@/types/providerContracts'
import { extractUserFacingErrorDetail } from '@/core'
import { mergeModelConfig, sortModelConfigs } from '@/types/modelCatalog'
import { selectProviderCredential, updateProviderCredentialHealth } from './providerCredentials'

const PROVIDER_CREDENTIAL_GROUP_MODEL_STORAGE_LIMIT = 256
const PROVIDER_MODEL_AVAILABILITY_INDEX_LIMIT = 512

export interface ProviderCredentialGroupMessages {
  defaultToken: string
  groupName(index: number): string
  modelsFetched(count: number): string
  modelSyncFailed: string
  notSynced: string
}

export interface ProviderCredentialGroupNormalizationOptions {
  messages?: Pick<ProviderCredentialGroupMessages, 'defaultToken' | 'groupName'>
}

export interface CredentialSyncDeps {
  fetchModels: (provider: AIProvider, group: ProviderCredentialGroup, signal?: AbortSignal) => Promise<Pick<AIModel, 'id' | 'name' | 'provider'>[] | AIModel[]>
  delay?: (ms: number) => Promise<void> | void
  jitter?: () => number
  now?: () => number
  signal?: AbortSignal
  resolveCapabilities?: (provider: AIProvider) => ProviderCapabilities | undefined
  messages?: ProviderCredentialGroupMessages
}

interface ProviderOperationResult<T = undefined> {
  ok: boolean
  code: ProviderOperationCode
  message: string
  data?: T
}

export interface CredentialSelection {
  credentialGroupId?: string
  apiKey: string
}

export interface CredentialSelectionOptions {
  preferredCredentialGroupId?: string
  excludedCredentialGroupIds?: readonly string[]
}

export function updateCredentialGroupHealth(
  provider: AIProvider,
  groupId: string | undefined,
  ok: boolean,
  now = Date.now()
): AIProvider {
  if (!groupId || !provider.credentialGroups?.length) return provider
  return {
    ...provider,
    credentialGroups: updateProviderCredentialHealth(provider.credentialGroups, groupId, ok, now),
  }
}

export function normalizeProviderCredentialGroups(
  provider: AIProvider,
  options: ProviderCredentialGroupNormalizationOptions = {},
): AIProvider {
  const messages = options.messages ?? defaultCredentialGroupMessages
  const groups = provider.credentialGroups?.length
    ? provider.credentialGroups
    : provider.apiKey
      ? [{
          id: 'default',
          label: messages.defaultToken,
          apiKey: provider.apiKey,
          enabled: true,
          availableModels: [],
        }]
      : []

  const normalizedGroups = groups.map((group, index) => ({
    ...group,
    id: group.id || `group-${index + 1}`,
    label: group.label || messages.groupName(index + 1),
    enabled: group.enabled ?? true,
    availableModels: group.availableModels
      ? limitModelIdsForStorage(clearHistoricalInjectedGroupModels(group, provider), [provider.lastTestModel], PROVIDER_CREDENTIAL_GROUP_MODEL_STORAGE_LIMIT)
      : [],
    failureCount: group.failureCount ?? 0,
  }))
  return {
    ...provider,
    credentialGroups: normalizedGroups,
    modelAvailability: mergeCredentialModelAvailability(normalizedGroups),
    syncPolicy: normalizeProviderCredentialSyncPolicy(provider.syncPolicy),
  }
}

export function defaultProviderCredentialSyncPolicy(): NonNullable<AIProvider['syncPolicy']> {
  return {
    minDelayMs: 120,
    maxDelayMs: 260,
    timeoutMs: 18000,
    strategy: 'parallel-balanced',
    concurrency: 3,
  }
}

export function normalizeProviderCredentialSyncPolicy(
  policy: AIProvider['syncPolicy'] | undefined,
): NonNullable<AIProvider['syncPolicy']> {
  if (!policy) return defaultProviderCredentialSyncPolicy()
  if (
    policy.strategy === 'sequential-low-rate' &&
    policy.minDelayMs === 1200 &&
    policy.maxDelayMs === 1800 &&
    policy.timeoutMs === 18000
  ) {
    return defaultProviderCredentialSyncPolicy()
  }
  if (policy.strategy === 'parallel-balanced') {
    return {
      ...defaultProviderCredentialSyncPolicy(),
      ...policy,
      concurrency: normalizeSyncConcurrency(policy.concurrency),
    }
  }
  return { ...policy, strategy: 'sequential-low-rate' }
}

export function mergeCredentialModelAvailability(groups: ProviderCredentialGroup[]) {
  const byModel = new Map<string, { modelId: string; credentialGroupIds: string[]; lastSyncedAt?: number }>()
  for (const group of groups) {
    if (!group.enabled) continue
    for (const modelId of group.availableModels ?? []) {
      const current = byModel.get(modelId) ?? { modelId, credentialGroupIds: [], lastSyncedAt: undefined }
      current.credentialGroupIds.push(group.id)
      current.lastSyncedAt = Math.max(current.lastSyncedAt ?? 0, group.lastModelSyncAt ?? 0) || undefined
      byModel.set(modelId, current)
      if (byModel.size >= PROVIDER_MODEL_AVAILABILITY_INDEX_LIMIT) break
    }
    if (byModel.size >= PROVIDER_MODEL_AVAILABILITY_INDEX_LIMIT) break
  }
  return Array.from(byModel.values()).sort((a, b) => a.modelId.localeCompare(b.modelId))
}

export function chooseCredentialForModel(
  provider: AIProvider,
  modelId: string,
  options: CredentialSelectionOptions = {}
): CredentialSelection {
  const normalized = normalizeProviderCredentialGroups(provider)
  const upstreamModel = resolveCredentialModelAlias(provider, modelId)
  const selected = selectProviderCredential({
    providerApiKey: provider.apiKey,
    credentials: normalized.credentialGroups ?? [],
    modelId,
    upstreamModelId: upstreamModel,
    preferredCredentialId: options.preferredCredentialGroupId,
    excludedCredentialIds: options.excludedCredentialGroupIds,
  })
  return {
    credentialGroupId: selected.credentialId,
    apiKey: selected.apiKey,
  }
}

export function findCredentialGroupIdForKey(provider: AIProvider, apiKey: string): string | undefined {
  const key = apiKey.trim()
  if (!key) return undefined
  return provider.credentialGroups?.find((group) => group.apiKey?.trim() === key)?.id
}

export async function runCredentialGroupModelSync(provider: AIProvider, deps: CredentialSyncDeps): Promise<AIProvider> {
  const now = deps.now ?? Date.now
  const jitter = deps.jitter ?? Math.random
  const wait = deps.delay ?? defaultDelay
  const messages = deps.messages ?? defaultCredentialGroupMessages
  const policy = normalizeProviderCredentialSyncPolicy(provider.syncPolicy)
  const groups = normalizeProviderCredentialGroups(provider).credentialGroups ?? []
  const nextGroups: ProviderCredentialGroup[] = new Array(groups.length)
  const syncedConfigsByGroup: AIModel[][] = new Array(groups.length)
  const configsById = new Map<string, AIModel>()
  const requestCache = new Map<string, Promise<Pick<AIModel, 'id' | 'name' | 'provider'>[] | AIModel[]>>()
  const syncEnabledGroup = async (group: ProviderCredentialGroup, index: number): Promise<void> => {
    throwIfCredentialSyncAborted(deps.signal)
    try {
      const remote = await fetchModelsForCredentialGroup(provider, group, deps, requestCache)
      throwIfCredentialSyncAborted(deps.signal)
      const remoteModels = limitModelIdsForStorage(remote.map((model) => model.id), [provider.lastTestModel], PROVIDER_CREDENTIAL_GROUP_MODEL_STORAGE_LIMIT)
      const remoteById = new Map(remote.map((model) => [model.id, model]))
      const configs = remoteModels.map((modelId) => mergeModelConfig(modelId, provider.type, remoteById.get(modelId)))
      syncedConfigsByGroup[index] = configs
      nextGroups[index] = {
        ...group,
        availableModels: configs.map((item) => item.id),
        lastModelSyncAt: now(),
        lastModelSyncStatus: 'ok',
        lastModelSyncMessage: messages.modelsFetched(configs.length),
        lastModelSyncCode: 'ok',
        failureCount: 0,
      }
    } catch (error) {
      if (isAbortError(error) || deps.signal?.aborted) throw abortError()
      const message = redactCredentialSyncError(
        extractUserFacingErrorDetail(error) || messages.modelSyncFailed,
        provider,
      )
      nextGroups[index] = {
        ...group,
        lastModelSyncAt: now(),
        lastModelSyncStatus: 'bad',
        lastModelSyncMessage: message,
        lastModelSyncCode: 'unknown',
        failureCount: (group.failureCount ?? 0) + 1,
      }
    }
  }
  if (policy.strategy === 'parallel-balanced') {
    await runCredentialGroupSyncPool(groups, policy.concurrency ?? 3, async (group, index) => {
      if (!group.enabled) {
        nextGroups[index] = group
        return
      }
      if (index > 0) await wait(nextCredentialSyncDelay(policy, jitter))
      throwIfCredentialSyncAborted(deps.signal)
      await syncEnabledGroup(group, index)
    })
  } else {
    for (const [index, group] of groups.entries()) {
      if (!group.enabled) {
        nextGroups[index] = group
        continue
      }
      if (index > 0) await wait(nextCredentialSyncDelay(policy, jitter))
      throwIfCredentialSyncAborted(deps.signal)
      await syncEnabledGroup(group, index)
    }
  }

  for (const configs of syncedConfigsByGroup) {
    for (const config of configs ?? []) {
      configsById.set(config.id, config)
    }
  }
  const modelConfigs = sortModelConfigs(Array.from(configsById.values()), provider.type)
  const models = modelConfigs.length ? modelConfigs.map((item) => item.id) : provider.models
  const merged: AIProvider = {
    ...provider,
    credentialGroups: nextGroups,
    models,
    modelConfigs: modelConfigs.length ? modelConfigs : provider.modelConfigs,
    modelAvailability: mergeCredentialModelAvailability(nextGroups),
    lastModelSyncAt: now(),
    lastModelSyncStatus: nextGroups.some((group) => group.lastModelSyncStatus === 'ok') ? 'ok' as const : 'bad' as const,
    lastModelSyncMessage: nextGroups.map((group) => `${group.label}: ${group.lastModelSyncMessage ?? messages.notSynced}`).join('\n'),
  }
  const resolvedCapabilities = deps.resolveCapabilities?.(provider)
  return {
    ...merged,
    ...(resolvedCapabilities ? {
      capabilities: { ...resolvedCapabilities, ...provider.capabilities },
    } : provider.capabilities ? { capabilities: provider.capabilities } : {}),
  }
}

export function providerCredentialResult<T>(ok: boolean, message: string, data?: T): ProviderOperationResult<T> {
  return { ok, code: ok ? 'ok' : 'unknown', message, data }
}

async function fetchModelsForCredentialGroup(
  provider: AIProvider,
  group: ProviderCredentialGroup,
  deps: CredentialSyncDeps,
  requestCache: Map<string, Promise<Pick<AIModel, 'id' | 'name' | 'provider'>[] | AIModel[]>>
): Promise<Pick<AIModel, 'id' | 'name' | 'provider'>[] | AIModel[]> {
  const apiKey = group.apiKey?.trim() || provider.apiKey
  const cacheKey = `${provider.id}:${provider.type}:${provider.baseUrl ?? ''}:${provider.presetId ?? ''}:${apiKey}`
  const cached = requestCache.get(cacheKey)
  if (cached) return cached
  throwIfCredentialSyncAborted(deps.signal)
  const request = deps.fetchModels({ ...provider, apiKey }, group, deps.signal)
  requestCache.set(cacheKey, request)
  return request
}

async function runCredentialGroupSyncPool(
  groups: ProviderCredentialGroup[],
  concurrency: number,
  runGroup: (group: ProviderCredentialGroup, index: number) => Promise<void>
): Promise<void> {
  let nextIndex = 0
  const workerCount = Math.min(groups.length, Math.max(1, Math.floor(concurrency)))
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < groups.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      await runGroup(groups[currentIndex], currentIndex)
    }
  }))
}

function nextCredentialSyncDelay(
  policy: NonNullable<AIProvider['syncPolicy']>,
  jitter: () => number
): number {
  const span = Math.max(0, policy.maxDelayMs - policy.minDelayMs)
  return Math.round(policy.minDelayMs + span * jitter())
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeSyncConcurrency(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 3
  return Math.min(6, Math.max(1, Math.floor(value)))
}

function throwIfCredentialSyncAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError()
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function abortError(): Error {
  const error = new Error('Provider credential synchronization was cancelled')
  error.name = 'AbortError'
  return error
}

const defaultCredentialGroupMessages: ProviderCredentialGroupMessages = {
  defaultToken: 'Default credential',
  groupName: (index) => `Credential ${index}`,
  modelsFetched: (count) => `${count} models fetched`,
  modelSyncFailed: 'Model synchronization failed',
  notSynced: 'Not synchronized',
}

function resolveCredentialModelAlias(provider: Pick<AIProvider, 'modelAliases'>, model: string): string {
  const normalized = model.trim()
  if (!normalized) return model
  const match = provider.modelAliases?.find((item) =>
    item.alias?.trim().toLowerCase() === normalized.toLowerCase() && item.model?.trim(),
  )
  return match?.model.trim() || model
}

function clearHistoricalInjectedGroupModels(group: ProviderCredentialGroup, provider: AIProvider): string[] {
  const models = uniqueModelIds(group.availableModels ?? [])
  if (group.lastModelSyncStatus === 'ok') return models
  if (provider.presetId === 'deepseek' || provider.detectedPresetId === 'deepseek' || provider.baseUrl?.toLowerCase().includes('api.deepseek.com')) {
    return models
  }
  const historical = new Set(['deepseek-v4-pro', 'deepseek-v4-flash'])
  const historicalSet = ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner']
  if (models.length === historicalSet.length && historicalSet.every((model) => models.some((item) => item.toLowerCase() === model))) return []
  return models.filter((model) => !historical.has(model.toLowerCase()))
}

function limitModelIdsForStorage(
  models: readonly string[],
  priorityModels: readonly (string | undefined)[],
  limit: number,
): string[] {
  const normalized = uniqueModelIds(models)
  const source = new Set(normalized)
  const ordered: string[] = []
  for (const model of [...priorityModels, ...normalized]) {
    const value = model?.trim()
    if (!value || !source.has(value) || ordered.includes(value)) continue
    ordered.push(value)
    if (ordered.length >= limit) break
  }
  return ordered
}

function uniqueModelIds(models: readonly string[]): string[] {
  return Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)))
}

function redactCredentialSyncError(message: string, provider: AIProvider): string {
  let safe = message
  for (const secret of [provider.apiKey, ...(provider.credentialGroups ?? []).map((group) => group.apiKey ?? '')]) {
    const normalized = secret.trim()
    if (normalized) safe = safe.split(normalized).join('[redacted]')
  }
  return safe
}
