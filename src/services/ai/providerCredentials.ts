import type { AIModel, AIProvider, ProviderCredentialGroup, ProviderOperationCode } from '@/types'
import { mergeModelConfig, sortModelConfigs } from '@/types'
import { st } from '@/i18n/service'
import { getProviderPreset, normalizeProviderSyncPolicy } from './providerRegistry'
import { clearHistoricalInjectedGroupModels, resolveProviderModelAlias } from '@/utils/providerModels'
import { PROVIDER_CREDENTIAL_GROUP_MODEL_STORAGE_LIMIT, PROVIDER_MODEL_AVAILABILITY_INDEX_LIMIT, limitModelIdsForStorage } from '@/utils/providerModelStorage'

interface CredentialSyncDeps {
  fetchModels: (provider: AIProvider, group: ProviderCredentialGroup) => Promise<Pick<AIModel, 'id' | 'name' | 'provider'>[] | AIModel[]>
  delay?: (ms: number) => Promise<void> | void
  jitter?: () => number
  now?: () => number
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
    credentialGroups: provider.credentialGroups.map((group) => {
      if (group.id !== groupId) return group
      return {
        ...group,
        lastUsedAt: now,
        lastFailureAt: ok ? group.lastFailureAt : now,
        failureCount: ok ? 0 : (group.failureCount ?? 0) + 1,
      }
    }),
  }
}

export function normalizeProviderCredentialGroups(provider: AIProvider): AIProvider {
  const groups = provider.credentialGroups?.length
    ? provider.credentialGroups
    : provider.apiKey
      ? [{
          id: 'default',
          label: st('providerOperation.defaultToken'),
          apiKey: provider.apiKey,
          enabled: true,
          availableModels: [],
        }]
      : []

  const normalizedGroups = groups.map((group, index) => ({
    ...group,
    id: group.id || `group-${index + 1}`,
    label: group.label || st('apiKeyPanel.groupName', { index: index + 1 }),
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
    syncPolicy: normalizeProviderSyncPolicy(provider.syncPolicy),
  }
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
  const upstreamModel = resolveProviderModelAlias(provider, modelId)
  const excluded = new Set(options.excludedCredentialGroupIds ?? [])
  const candidates = (normalized.credentialGroups ?? [])
    .filter((group) => group.enabled)
    .filter((group) => !excluded.has(group.id))
    .filter((group) => !group.availableModels?.length || group.availableModels.includes(upstreamModel) || group.availableModels.includes(modelId))
    .sort((a, b) => (a.failureCount ?? 0) - (b.failureCount ?? 0) || (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0))
  const preferred = options.preferredCredentialGroupId
    ? candidates.find((group) => group.id === options.preferredCredentialGroupId)
    : undefined
  const selected = preferred ?? candidates[0] ?? normalized.credentialGroups?.find((group) => group.enabled && !excluded.has(group.id)) ?? null
  return {
    credentialGroupId: selected?.id,
    apiKey: selected?.apiKey ?? provider.apiKey,
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
  const policy = normalizeProviderSyncPolicy(provider.syncPolicy)
  const groups = normalizeProviderCredentialGroups(provider).credentialGroups ?? []
  const nextGroups: ProviderCredentialGroup[] = new Array(groups.length)
  const syncedConfigsByGroup: AIModel[][] = new Array(groups.length)
  const configsById = new Map<string, AIModel>()
  const requestCache = new Map<string, Promise<Pick<AIModel, 'id' | 'name' | 'provider'>[] | AIModel[]>>()
  const syncEnabledGroup = async (group: ProviderCredentialGroup, index: number): Promise<void> => {
    try {
      const remote = await fetchModelsForCredentialGroup(provider, group, deps, requestCache)
      const remoteModels = limitModelIdsForStorage(remote.map((model) => model.id), [provider.lastTestModel], PROVIDER_CREDENTIAL_GROUP_MODEL_STORAGE_LIMIT)
      const remoteById = new Map(remote.map((model) => [model.id, model]))
      const configs = remoteModels.map((modelId) => mergeModelConfig(modelId, provider.type, remoteById.get(modelId)))
      syncedConfigsByGroup[index] = configs
      nextGroups[index] = {
        ...group,
        availableModels: configs.map((item) => item.id),
        lastModelSyncAt: now(),
        lastModelSyncStatus: 'ok',
        lastModelSyncMessage: st('providerOperation.modelsFetched', { count: configs.length }),
        lastModelSyncCode: 'ok',
        failureCount: 0,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : st('apiKeyPanel.modelSyncFailed')
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
      await syncEnabledGroup(group, index)
    })
  } else {
    for (const [index, group] of groups.entries()) {
      if (!group.enabled) {
        nextGroups[index] = group
        continue
      }
      if (index > 0) await wait(nextCredentialSyncDelay(policy, jitter))
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
    lastModelSyncMessage: nextGroups.map((group) => `${group.label}: ${group.lastModelSyncMessage ?? st('providerOperation.notSynced')}`).join('\n'),
  }
  const preset = getProviderPreset(provider.presetId)
  return {
    ...merged,
    capabilities: { ...preset.capabilities, ...provider.capabilities },
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
  const request = deps.fetchModels({ ...provider, apiKey }, group)
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
