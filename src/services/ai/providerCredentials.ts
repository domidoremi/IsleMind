import type { AIModel, AIProvider, ProviderCredentialGroup, ProviderOperationCode } from '@/types'
import { getModelConfig, mergeModelConfig, sortModelConfigs } from '@/types'
import { st } from '@/i18n/service'
import { defaultProviderSyncPolicy, getProviderPreset } from './providerRegistry'
import { clearHistoricalInjectedGroupModels } from '@/utils/providerModels'

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
    availableModels: group.availableModels ? clearHistoricalInjectedGroupModels(group, provider) : [],
    failureCount: group.failureCount ?? 0,
  }))
  return {
    ...provider,
    credentialGroups: normalizedGroups,
    modelAvailability: mergeCredentialModelAvailability(normalizedGroups),
    syncPolicy: provider.syncPolicy ?? defaultProviderSyncPolicy(),
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
    }
  }
  return Array.from(byModel.values()).sort((a, b) => a.modelId.localeCompare(b.modelId))
}

export function chooseCredentialForModel(provider: AIProvider, modelId: string): CredentialSelection {
  const normalized = normalizeProviderCredentialGroups(provider)
  const candidates = (normalized.credentialGroups ?? [])
    .filter((group) => group.enabled)
    .filter((group) => !group.availableModels?.length || group.availableModels.includes(modelId))
    .sort((a, b) => (a.failureCount ?? 0) - (b.failureCount ?? 0) || (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0))
  const selected = candidates[0] ?? normalized.credentialGroups?.find((group) => group.enabled) ?? null
  return {
    credentialGroupId: selected?.id,
    apiKey: selected?.apiKey ?? provider.apiKey,
  }
}

export async function runCredentialGroupModelSync(provider: AIProvider, deps: CredentialSyncDeps): Promise<AIProvider> {
  const now = deps.now ?? Date.now
  const jitter = deps.jitter ?? Math.random
  const wait = deps.delay ?? defaultDelay
  const policy = provider.syncPolicy ?? defaultProviderSyncPolicy()
  const groups = normalizeProviderCredentialGroups(provider).credentialGroups ?? []
  const nextGroups: ProviderCredentialGroup[] = []
  const configsById = new Map<string, AIModel>()

  for (const [index, group] of groups.entries()) {
    if (!group.enabled) {
      nextGroups.push(group)
      continue
    }
    if (index > 0) {
      const span = Math.max(0, policy.maxDelayMs - policy.minDelayMs)
      await wait(Math.round(policy.minDelayMs + span * jitter()))
    }
    try {
      const remote = await deps.fetchModels({ ...provider, apiKey: group.apiKey?.trim() || provider.apiKey }, group)
      const configs = remote.map((model) => mergeModelConfig(model.id, provider.type, model))
      for (const config of configs) {
        configsById.set(config.id, config)
      }
      nextGroups.push({
        ...group,
        availableModels: configs.map((item) => item.id),
        lastModelSyncAt: now(),
        lastModelSyncStatus: 'ok',
        lastModelSyncMessage: st('providerOperation.modelsFetched', { count: configs.length }),
        lastModelSyncCode: 'ok',
        failureCount: 0,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : st('apiKeyPanel.modelSyncFailed')
      nextGroups.push({
        ...group,
        lastModelSyncAt: now(),
        lastModelSyncStatus: 'bad',
        lastModelSyncMessage: message,
        lastModelSyncCode: 'unknown',
        failureCount: (group.failureCount ?? 0) + 1,
      })
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

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
