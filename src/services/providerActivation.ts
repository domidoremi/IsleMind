import { syncProviderCredentialGroupsDetailed, testProviderModelDetailed } from '@/services/ai/base'
import { st } from '@/i18n/service'
import type { AIProvider, ProviderOperationCode } from '@/types'
import { getProviderAvailableModels, getProviderManualModels, getProviderPreferredModel, isProviderChatCompatibleModel } from '@/utils/providerModels'
import { resolveProviderModelAliasAccess, type ProviderModelAccessInput } from '@/services/ai/policy/providerModelAccess'

const ACTIVATION_TEST_MODELS_PER_CREDENTIAL = 1

export interface ProviderActivationResult {
  providerId: string
  providerName: string
  enabled: boolean
  hadCredential: boolean
  synced: boolean
  syncAttempted: boolean
  modelCount: number
  syncedGroups: number
  missingToken: boolean
  tested: boolean
  testOk: boolean
  testModel?: string
  testGroupId?: string
  messages: string[]
  failures: ProviderActivationFailure[]
}

export interface ProviderActivationFailure {
  providerName: string
  groupLabel?: string
  model?: string
  code?: ProviderOperationCode
  message: string
}

export interface ProviderActivationDeps {
  updateProvider: (id: string, updates: Partial<AIProvider>) => Promise<void>
  hydrateProviderKey: (id: string) => Promise<AIProvider | null>
  updateProviderCredentialGroupHealth: (providerId: string, groupId: string | undefined, ok: boolean) => Promise<void>
  delay?: (ms: number) => Promise<void>
  onStage?: (event: ProviderActivationStageEvent) => void
}

export interface ProviderActivationStageEvent {
  providerId: string
  providerName: string
  stage: 'enabled' | 'syncing' | 'testing' | 'done' | 'failed'
  message: string
  tone: 'mint' | 'amber' | 'danger'
}

export async function activateProviderWithHealthCheck(
  provider: AIProvider,
  deps: ProviderActivationDeps
): Promise<ProviderActivationResult> {
  return syncAndTestProvider(provider, deps, { enable: true })
}

export async function syncAndTestProvider(
  provider: AIProvider,
  deps: ProviderActivationDeps,
  options: { enable?: boolean; testModel?: string; checkParameters?: boolean; accessSettings?: ProviderModelAccessInput['settings'] } = {}
): Promise<ProviderActivationResult> {
  if (options.enable) {
    await deps.updateProvider(provider.id, { enabled: true })
    deps.onStage?.({
      providerId: provider.id,
      providerName: provider.name,
      stage: 'enabled',
      message: st('providerActivation.stageEnabled', { name: provider.name }),
      tone: 'mint',
    })
  }
  const initial = await deps.hydrateProviderKey(provider.id)
  const result: ProviderActivationResult = {
    providerId: provider.id,
    providerName: provider.name,
    enabled: options.enable ? true : initial?.enabled ?? provider.enabled,
    hadCredential: hasAnyCredential(initial ?? provider),
    synced: false,
    syncAttempted: false,
    modelCount: countPolicyAllowedAvailableModels(initial ?? provider, options.accessSettings),
    syncedGroups: 0,
    missingToken: false,
    tested: false,
    testOk: false,
    messages: [],
    failures: [],
  }

  if (!initial) {
    pushFailure(result, st('providerActivation.providerMissing'))
    deps.onStage?.({
      providerId: provider.id,
      providerName: provider.name,
      stage: 'failed',
      message: st('providerActivation.stageProviderMissing', { name: provider.name }),
      tone: 'danger',
    })
    return result
  }

  let current = initial
  if (!result.hadCredential) {
    result.missingToken = true
    pushFailure(result, st('providerActivation.missingToken'))
    await deps.updateProvider(provider.id, {
      lastModelSyncStatus: 'bad',
      lastModelSyncMessage: st('providerActivation.missingToken'),
      lastModelSyncCode: 'missing_key',
      lastTestStatus: 'idle',
      lastTestMessage: undefined,
      lastTestCode: undefined,
    })
    deps.onStage?.({
      providerId: provider.id,
      providerName: provider.name,
      stage: 'failed',
      message: st('providerActivation.stageMissingToken', { name: provider.name }),
      tone: 'amber',
    })
    return result
  }

  result.syncAttempted = true
  deps.onStage?.({
    providerId: provider.id,
    providerName: provider.name,
    stage: 'syncing',
    message: st('providerActivation.stageSyncing', { name: provider.name }),
    tone: 'mint',
  })
  const sync = await syncProviderCredentialGroupsDetailed(current)
  if (sync.data) {
    await deps.updateProvider(provider.id, sync.data)
    current = await deps.hydrateProviderKey(provider.id) ?? sync.data
    result.modelCount = countPolicyAllowedAvailableModels(current, options.accessSettings)
    result.syncedGroups = countSyncedGroups(current, options.accessSettings)
  }
  result.synced = sync.ok && result.syncedGroups > 0 && result.modelCount > 0
  if (!sync.ok || !result.synced) {
    collectSyncFailures(result, current, sync.message)
  }

  const candidates = buildTestCandidates(current, options.testModel, options.accessSettings)
  if (!candidates.length) {
    pushFailure(result, st('providerActivation.noModels'), { code: 'empty_models' })
    await deps.updateProvider(provider.id, {
      lastTestStatus: 'idle',
      lastTestMessage: undefined,
      lastTestCode: undefined,
    })
    deps.onStage?.({
      providerId: provider.id,
      providerName: provider.name,
      stage: 'failed',
      message: st('providerActivation.stageNoModels', { name: provider.name }),
      tone: 'amber',
    })
    return result
  }

  deps.onStage?.({
    providerId: provider.id,
    providerName: provider.name,
    stage: 'testing',
    message: st('providerActivation.stageTesting', { name: provider.name }),
    tone: 'mint',
  })
  for (const [index, candidate] of candidates.entries()) {
    const test = await testProviderModelDetailed(current, candidate.model, candidate.apiKey, { checkParameters: options.checkParameters })
    await deps.updateProviderCredentialGroupHealth(provider.id, test.credentialGroupId ?? candidate.groupId, test.ok)
    result.tested = true
    if (test.ok) {
      result.testOk = true
      result.testModel = candidate.model
      result.testGroupId = test.credentialGroupId ?? candidate.groupId
      await deps.updateProvider(provider.id, {
        lastTestStatus: 'ok',
        lastTestedAt: Date.now(),
        lastTestModel: candidate.model,
        lastTestMessage: test.message,
        lastTestCode: test.code,
      })
      deps.onStage?.({
        providerId: provider.id,
        providerName: provider.name,
        stage: 'done',
        message: st('providerActivation.stageDone', { name: provider.name, model: candidate.model }),
        tone: 'mint',
      })
      return result
    }
    pushFailure(result, test.message, {
      code: test.code,
      groupLabel: candidate.groupLabel,
      model: candidate.model,
    })
    if (test.code === 'rate_limited') break
    if (index < candidates.length - 1) {
      await wait(deps, 450)
    }
  }

  const lastFailure = result.failures.at(-1)
  await deps.updateProvider(provider.id, {
    lastTestStatus: 'bad',
    lastTestedAt: Date.now(),
    lastTestModel: undefined,
    lastTestMessage: dedupeMessages(result.failures.map((item) => item.message)).slice(0, 3).join('\n') || st('providerActivation.noModels'),
    lastTestCode: lastFailure?.code ?? 'unknown',
  })
  deps.onStage?.({
    providerId: provider.id,
    providerName: provider.name,
    stage: 'failed',
    message: st('providerActivation.stageFailed', { name: provider.name }),
    tone: 'danger',
  })

  return result
}

function wait(deps: ProviderActivationDeps, ms: number): Promise<void> {
  return deps.delay ? deps.delay(ms) : new Promise((resolve) => setTimeout(resolve, ms))
}

function buildTestCandidates(provider: AIProvider, requestedModel?: string, settings?: ProviderModelAccessInput['settings']): Array<{ groupId?: string; groupLabel?: string; apiKey: string; model: string }> {
  const enabledGroups = provider.credentialGroups?.filter((group) => group.enabled && group.apiKey?.trim()) ?? []
  const testModel = requestedModel?.trim()
  if (testModel && isModelPolicyAllowed(provider, testModel, settings)) {
    if (enabledGroups.length) {
      return dedupeCandidates(enabledGroups.map((group) => ({
        groupId: group.id,
        groupLabel: group.label,
        apiKey: group.apiKey!.trim(),
        model: testModel,
      })))
    }
    if (provider.apiKey?.trim()) return [{ apiKey: provider.apiKey.trim(), model: testModel }]
  }
  const syncedGroups = enabledGroups.filter((group) => group.lastModelSyncStatus === 'ok')
  const candidates = syncedGroups.flatMap((group) => {
    const models = selectActivationTestModels(provider, group.availableModels ?? [], settings)
    return models.map((model) => ({
      groupId: group.id,
      groupLabel: group.label,
      apiKey: group.apiKey!.trim(),
      model,
    }))
  })
  if (candidates.length) return dedupeCandidates(candidates)
  const manualModels = selectActivationTestModels(provider, getProviderManualModels(provider), settings)
  if (manualModels.length) {
    if (enabledGroups.length) {
      return dedupeCandidates(enabledGroups.flatMap((group) => manualModels.map((model) => ({
        groupId: group.id,
        groupLabel: group.label,
        apiKey: group.apiKey!.trim(),
        model,
      }))))
    }
    if (provider.apiKey?.trim()) {
      return manualModels.map((model) => ({ apiKey: provider.apiKey.trim(), model }))
    }
  }
  if (!enabledGroups.length && provider.apiKey?.trim() && provider.lastModelSyncStatus === 'ok' && provider.models.length) {
    return selectActivationTestModels(provider, provider.models, settings)
      .map((model) => ({ apiKey: provider.apiKey.trim(), model }))
  }
  return []
}

function selectActivationTestModels(provider: AIProvider, models: string[], settings?: ProviderModelAccessInput['settings']): string[] {
  const allowed = models.filter((model) => isProviderChatCompatibleModel(provider, model) && isModelPolicyAllowed(provider, model, settings))
  if (!allowed.length) return []
  const preferred = [
    provider.lastTestStatus === 'ok' ? provider.lastTestModel : undefined,
    getProviderPreferredModel(provider),
    ...getProviderManualModels(provider),
  ]
    .filter((model): model is string => !!model?.trim())
    .filter((model) => allowed.includes(model))
  return uniqueModels([...preferred, ...allowed]).slice(0, ACTIVATION_TEST_MODELS_PER_CREDENTIAL)
}

export function buildProviderActivationTestCandidatesForTest(provider: AIProvider, requestedModel?: string, settings?: ProviderModelAccessInput['settings']): Array<{ groupId?: string; groupLabel?: string; apiKey: string; model: string }> {
  return buildTestCandidates(provider, requestedModel, settings)
}

function dedupeCandidates(candidates: Array<{ groupId?: string; groupLabel?: string; apiKey: string; model: string }>) {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = `${candidate.groupId ?? candidate.apiKey}:${candidate.model}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function uniqueModels(models: string[]): string[] {
  const seen = new Set<string>()
  return models.filter((model) => {
    const key = model.trim()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function summarizeProviderActivation(results: ProviderActivationResult[]): { tone: 'mint' | 'amber' | 'danger'; message: string } {
  const enabled = results.filter((item) => item.enabled).length
  const synced = results.filter((item) => item.synced).length
  const testedOk = results.filter((item) => item.testOk).length
  const missingTokens = results.filter((item) => item.missingToken || !item.hadCredential)
  const noModels = results.filter((item) => item.hadCredential && !item.modelCount)
  const failed = results.filter((item) => item.failures.length && !missingTokens.includes(item) && !item.testOk)
  const parts = [
    st('providerActivation.summary', { target: results.length, enabled, synced, tested: testedOk, noModels: noModels.length, failed: failed.length }),
  ]
  if (missingTokens.length) parts.push(st('providerActivation.missingTokens', { names: names(missingTokens) }))
  if (noModels.length) parts.push(st('providerActivation.noModelsFor', { names: names(noModels) }))
  if (failed.length) {
    const details = dedupeMessages(failed.flatMap((item) => item.failures.map((failure) => formatFailure(failure))))
    const shown = details.slice(0, 3)
    const remaining = Math.max(0, details.length - shown.length)
    parts.push([shown.join('\n'), remaining ? st('providerActivation.moreFailures', { count: remaining }) : ''].filter(Boolean).join('\n'))
  }
  return {
    tone: failed.length ? 'danger' : missingTokens.length || noModels.length ? 'amber' : 'mint',
    message: parts.join('\n'),
  }
}

function hasAnyCredential(provider: AIProvider): boolean {
  return !!provider.apiKey?.trim() || !!provider.credentialGroups?.some((group) => group.enabled && group.apiKey?.trim())
}

function names(items: ProviderActivationResult[]): string {
  return items.map((item) => item.providerName).join(', ')
}

function countSyncedGroups(provider: AIProvider, settings?: ProviderModelAccessInput['settings']): number {
  return provider.credentialGroups?.filter((group) =>
    group.enabled &&
    group.lastModelSyncStatus === 'ok' &&
    (group.availableModels ?? []).some((model) => isModelPolicyAllowed(provider, model, settings))
  ).length ?? 0
}

function countPolicyAllowedAvailableModels(provider: AIProvider, settings?: ProviderModelAccessInput['settings']): number {
  return getProviderAvailableModels(provider).filter((model) => isModelPolicyAllowed(provider, model, settings)).length
}

function isModelPolicyAllowed(provider: AIProvider, model: string, settings?: ProviderModelAccessInput['settings']): boolean {
  return resolveProviderModelAliasAccess({ provider, model, settings }).allowed
}

function collectSyncFailures(result: ProviderActivationResult, provider: AIProvider, fallbackMessage: string) {
  const groups = provider.credentialGroups?.filter((group) => group.enabled) ?? []
  const failedGroups = groups.filter((group) => group.lastModelSyncStatus === 'bad')
  if (!failedGroups.length) {
    pushFailure(result, fallbackMessage)
    return
  }
  for (const group of failedGroups) {
    pushFailure(result, group.lastModelSyncMessage || fallbackMessage, {
      groupLabel: group.label,
      code: group.lastModelSyncCode ?? 'unknown',
    })
  }
}

function pushFailure(
  result: ProviderActivationResult,
  message: string,
  options: { groupLabel?: string; model?: string; code?: ProviderOperationCode } = {}
) {
  const cleaned = cleanFailureMessage(message, result.providerName)
  result.messages.push(cleaned)
  result.failures.push({
    providerName: result.providerName,
    groupLabel: options.groupLabel,
    model: options.model,
    code: options.code,
    message: cleaned,
  })
}

function formatFailure(failure: ProviderActivationFailure): string {
  const scope = [failure.providerName, failure.groupLabel, failure.model].filter(Boolean).join(' · ')
  return scope ? `${scope}: ${failure.message}` : failure.message
}

function dedupeMessages(messages: string[]): string[] {
  const seen = new Set<string>()
  return messages
    .map((item) => item.trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false
      seen.add(item)
      return true
    })
}

function cleanFailureMessage(message: string, providerName: string): string {
  return message
    .replace(/^模型测试[:：]\s*/i, '')
    .replace(new RegExp(`^${escapeRegExp(providerName)}[:：]\\s*`), '')
    .trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
