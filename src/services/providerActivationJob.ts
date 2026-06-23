import type { ActivationJobItemState } from '@/store/activationJobStore'
import type { ProviderActivationStageEvent } from '@/services/providerActivation'
import type { AIProvider } from '@/types'

export type ProviderActivationJobMode = 'single' | 'batch' | 'all'

export interface ProviderActivationRuntimePolicy {
  concurrency: number
  maxTestCandidates?: number
  modelSyncTimeoutMs?: number
  modelTestTimeoutMs?: number
  afterProviderDelayMs: number
}

const DEFAULT_PROVIDER_ACTIVATION_CONCURRENCY = 2
const MAX_PROVIDER_ACTIVATION_CONCURRENCY = 3
const LARGE_PROVIDER_BATCH_SIZE = 10
const LARGE_BATCH_PROVIDER_TIMEOUT_MS = 9000
const NORMAL_BATCH_PROVIDER_TIMEOUT_MS = 14000

export const ACTIVATION_STAGE_PROGRESS: Record<ProviderActivationStageEvent['stage'], number> = {
  enabled: 0.18,
  syncing: 0.46,
  testing: 0.76,
  done: 0.96,
  failed: 0.96,
}

export type ActivationItemPatch = Partial<Omit<ActivationJobItemState, 'providerId' | 'providerName'>>

export function createActivationItems(providers: Pick<AIProvider, 'id' | 'name'>[], stage: string): ActivationJobItemState[] {
  return providers.map((provider) => ({
    providerId: provider.id,
    providerName: provider.name,
    status: 'queued',
    progress: 0,
    synced: false,
    tested: false,
    failed: false,
    stage,
  }))
}

export function patchActivationItem(items: ActivationJobItemState[], providerId: string, updates: ActivationItemPatch): ActivationJobItemState[] {
  return items.map((item) => {
    if (item.providerId !== providerId) return item
    if ((item.status === 'done' || item.status === 'failed') && updates.status === 'running') return item
    const progress = updates.progress === undefined ? item.progress : Math.max(item.progress, updates.progress)
    return {
      ...item,
      ...updates,
      progress: activationItemProgress(progress),
    }
  })
}

export function aggregateActivationItems(items: ActivationJobItemState[]): { completed: number; synced: number; tested: number; failed: number; progress: number } {
  const completed = items.filter((item) => item.status === 'done' || item.status === 'failed').length
  const synced = items.filter((item) => item.synced).length
  const tested = items.filter((item) => item.tested).length
  const failed = items.filter((item) => item.failed).length
  const progress = items.length ? items.reduce((sum, item) => sum + activationItemProgress(item.progress), 0) / items.length : 0
  return { completed, synced, tested, failed, progress }
}

export function activationItemProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0
  return Math.min(1, Math.max(0, progress))
}

export function resolveProviderActivationRuntimePolicy(total: number, mode: ProviderActivationJobMode): ProviderActivationRuntimePolicy {
  if (mode === 'single' || total <= 1) {
    return { concurrency: 1, afterProviderDelayMs: 0 }
  }
  const largeBatch = total >= LARGE_PROVIDER_BATCH_SIZE
  const concurrency = largeBatch
    ? 1
    : Math.min(total, DEFAULT_PROVIDER_ACTIVATION_CONCURRENCY, MAX_PROVIDER_ACTIVATION_CONCURRENCY)
  return {
    concurrency,
    maxTestCandidates: largeBatch ? 1 : 2,
    modelSyncTimeoutMs: largeBatch ? LARGE_BATCH_PROVIDER_TIMEOUT_MS : NORMAL_BATCH_PROVIDER_TIMEOUT_MS,
    modelTestTimeoutMs: largeBatch ? LARGE_BATCH_PROVIDER_TIMEOUT_MS : NORMAL_BATCH_PROVIDER_TIMEOUT_MS,
    afterProviderDelayMs: largeBatch ? 90 : 45,
  }
}
