import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsleDialog } from '@/components/ui/isle'
import { createProviderActivationPatchBuffer, type ProviderActivationPatchBuffer } from '@/modules/providers'
import { isProviderActivationReady, syncAndTestProvider, summarizeProviderActivation, type ProviderActivationResult } from '@/bootstrap/providerActivationRuntime'
import { resolveProviderDisplayName } from '@/presentation/features/settings/providerPresentation'
import { summarizeProviderActivationIssueGroups } from '@/services/providerActivationIssueSummary'
import { ACTIVATION_STAGE_PROGRESS, aggregateActivationItems, createActivationItems, patchActivationItem, resolveProviderActivationRuntimePolicy, type ActivationItemPatch } from '@/services/providerActivationJob'
import { resolveActivationJobProgress, useActivationJobStore, type ActivationJobItemState, type ActivationJobState } from '@/store/activationJobStore'
import { useSettingsStore } from '@/store/settingsStore'
import { clearAndroidStatusNotification, updateAndroidStatusNotification } from '@/services/androidStatusNotification'
import type { AIProvider } from '@/types/providerContracts'
export type ProviderActivationMode = 'single' | 'batch' | 'all'

const ACTIVATION_JOB_VISIBLE_ITEM_LIMIT = 8
const ACTIVATION_PROVIDER_PATCH_FLUSH_LIMIT = 8
const ACTIVATION_PROVIDER_PATCH_FLUSH_MS = 64
const ACTIVATION_NOTIFICATION_CLEAR_DELAY_MS = 5000

interface UseProviderActivationJobInput {
  onActivationCompleted?: () => void
}

type ActivationNotificationJob = Partial<Omit<ActivationJobState, 'id' | 'updatedAt'>> & Pick<ActivationJobState, 'status' | 'total' | 'completed' | 'synced' | 'tested' | 'failed'>

export function useProviderActivationJob(input: UseProviderActivationJobInput = {}) {
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const settings = useSettingsStore((state) => state.settings)
  const hydrateProviderKey = useSettingsStore((state) => state.hydrateProviderKey)
  const updateProvider = useSettingsStore((state) => state.updateProvider)
  const updateProviderPatches = useSettingsStore((state) => state.updateProviderPatches)
  const updateProviderCredentialGroupHealth = useSettingsStore((state) => state.updateProviderCredentialGroupHealth)
  const flushProviderPersistence = useSettingsStore((state) => state.flushProviderPersistence)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const activationJob = useActivationJobStore((state) => state.job)
  const startActivationJob = useActivationJobStore((state) => state.start)
  const updateActivationJob = useActivationJobStore((state) => state.update)
  const finishActivationJob = useActivationJobStore((state) => state.finish)
  const clearActivationJob = useActivationJobStore((state) => state.clear)
  const [activationBusy, setActivationBusy] = useState(false)
  const mountedRef = useRef(true)
  const activationAbortController = useRef<AbortController | null>(null)
  const activationNotificationClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      const controller = activationAbortController.current
      activationAbortController.current = null
      controller?.abort()
      if (controller) {
        useActivationJobStore.getState().clear()
        void clearAndroidStatusNotification()
      }
      if (activationNotificationClearTimer.current) clearTimeout(activationNotificationClearTimer.current)
    }
  }, [])

  function clearActivationNotificationTimer() {
    if (!activationNotificationClearTimer.current) return
    clearTimeout(activationNotificationClearTimer.current)
    activationNotificationClearTimer.current = null
  }

  function scheduleActivationNotificationClear() {
    clearActivationNotificationTimer()
    activationNotificationClearTimer.current = setTimeout(() => {
      activationNotificationClearTimer.current = null
      void clearAndroidStatusNotification()
    }, ACTIVATION_NOTIFICATION_CLEAR_DELAY_MS)
  }

  async function activateProviders(ids: string[], mode: ProviderActivationMode): Promise<void> {
    if (activationBusy || activationAbortController.current || activationJob?.status === 'running') return
    const currentProviders = useSettingsStore.getState().providers
    const chosen = ids.map((id) => currentProviders.find((provider) => provider.id === id)).filter((provider): provider is AIProvider => !!provider)
    if (!chosen.length) {
      dialog.toast({ title: t('providerSettings.enableNone'), tone: 'amber' })
      return
    }
    const startTitle = chosen.length === 1 ? t('providerSettings.activatingProvider') : t('providerSettings.activationStarted')
    const activationPolicy = resolveProviderActivationRuntimePolicy(chosen.length, mode)
    const activationConcurrency = activationPolicy.concurrency
    const abortController = new AbortController()
    activationAbortController.current = abortController
    setActivationBusy(true)
    clearActivationNotificationTimer()
    let patchBuffer: ProviderActivationPatchBuffer | null = null
    try {
      dialog.toast({
        title: startTitle,
        message: t('providerSettings.activationStartedMessage', { count: chosen.length, concurrency: activationConcurrency }),
        tone: 'mint',
        position: 'bottom',
        durationMs: 1800,
        dedupeKey: 'provider-activation',
      })
      let activationItems = createActivationItems(chosen, t('providerSettings.activationQueued'))
      const progressThrottleMs = chosen.length > 1 ? 240 : 0
      patchBuffer = mode === 'single'
        ? null
        : createProviderActivationPatchBuffer({
            flushPatches: (patches) => updateProviderPatches(patches, { persist: 'deferred' }),
            hydrateProviderKey,
            flushLimit: ACTIVATION_PROVIDER_PATCH_FLUSH_LIMIT,
            flushMs: ACTIVATION_PROVIDER_PATCH_FLUSH_MS,
            signal: abortController.signal,
          })
      const hydrateProviderForActivation = async (providerId: string) => {
        const hydrated = await hydrateProviderKey(providerId)
        return patchBuffer?.apply(providerId, hydrated) ?? hydrated
      }
      let lastProgressPublishedAt = 0
      let pendingProgressUpdate: ActivationNotificationJob | null = null
      let progressPublishTimer: ReturnType<typeof setTimeout> | null = null
      const flushActivationProgress = () => {
        if (progressPublishTimer) {
          clearTimeout(progressPublishTimer)
          progressPublishTimer = null
        }
        if (!pendingProgressUpdate || abortController.signal.aborted) return
        updateActivationJob(pendingProgressUpdate)
        void publishProviderActivationStatusNotification(pendingProgressUpdate, t, settings.systemStatusNotificationsEnabled === true)
        pendingProgressUpdate = null
        lastProgressPublishedAt = Date.now()
      }
      const publishActivationJobUpdate = (updates: ActivationNotificationJob, force = false) => {
        if (abortController.signal.aborted) return
        if (force || progressThrottleMs <= 0 || Date.now() - lastProgressPublishedAt >= progressThrottleMs) {
          if (progressPublishTimer) {
            clearTimeout(progressPublishTimer)
            progressPublishTimer = null
          }
          pendingProgressUpdate = null
          updateActivationJob(updates)
          void publishProviderActivationStatusNotification(updates, t, settings.systemStatusNotificationsEnabled === true)
          lastProgressPublishedAt = Date.now()
          return
        }
        pendingProgressUpdate = updates
        if (!progressPublishTimer) {
          progressPublishTimer = setTimeout(flushActivationProgress, progressThrottleMs)
        }
      }
      const publishActivationItems = (nextItems: ActivationJobItemState[], stage?: string, currentName?: string) => {
        activationItems = nextItems
        const aggregate = aggregateActivationItems(activationItems)
        publishActivationJobUpdate({
          status: 'running',
          total: chosen.length,
          completed: aggregate.completed,
          progress: aggregate.progress,
          synced: aggregate.synced,
          tested: aggregate.tested,
          failed: aggregate.failed,
          currentName,
          stage: stage ?? t('providerSettings.activationStartedMessage', { count: chosen.length, concurrency: activationConcurrency }),
          items: compactActivationItemsForUi(activationItems),
        })
      }
      const publishActivationItem = (providerId: string, updates: ActivationItemPatch, stage?: string, currentName?: string) => {
        publishActivationItems(patchActivationItem(activationItems, providerId, updates), stage, currentName)
      }
      const initialActivationJob = {
        status: 'running',
        total: chosen.length,
        completed: 0,
        progress: 0,
        synced: 0,
        tested: 0,
        failed: 0,
        stage: chosen.length === 1 ? t('providerSettings.activationQueued') : t('providerSettings.activationStartedMessage', { count: chosen.length, concurrency: activationConcurrency }),
        items: compactActivationItemsForUi(activationItems),
      } satisfies Omit<ActivationJobState, 'id' | 'updatedAt'>
      startActivationJob(initialActivationJob)
      await publishProviderActivationStatusNotification(initialActivationJob, t, settings.systemStatusNotificationsEnabled === true)
      const runProviderActivation = async (provider: AIProvider): Promise<ProviderActivationResult> => {
        const providerDisplayName = resolveProviderDisplayName(provider, t('providerSettings.customProvider'))
        const currentStage = t('providerSettings.activationCurrent', { name: providerDisplayName })
        publishActivationItem(provider.id, {
          status: 'running',
          progress: 0.04,
          stage: currentStage,
        }, currentStage, providerDisplayName)
        const result = await syncAndTestProvider(provider, {
          updateProvider: (providerId, updates) => mode === 'single'
            ? updateProvider(providerId, updates, { persist: 'immediate' })
            : patchBuffer!.enqueue(providerId, updates),
          hydrateProviderKey: hydrateProviderForActivation,
          updateProviderCredentialGroupHealth: (providerId, groupId, ok) => mode === 'single'
            ? updateProviderCredentialGroupHealth(providerId, groupId, ok, { persist: 'immediate' })
            : patchBuffer!.enqueueCredentialGroupHealth(providerId, groupId, ok),
          onStage: (event) => {
            const stageMessage = !provider.name || providerDisplayName === provider.name
              ? event.message
              : event.message.replaceAll(provider.name, providerDisplayName)
            publishActivationItem(event.providerId, {
              status: event.stage === 'failed' ? 'failed' : 'running',
              progress: ACTIVATION_STAGE_PROGRESS[event.stage],
              failed: event.stage === 'failed',
              stage: stageMessage,
            }, stageMessage, providerDisplayName)
          },
        }, {
          enable: true,
          testModels: false,
          accessSettings: settings,
          modelSyncTimeoutMs: activationPolicy.modelSyncTimeoutMs,
          signal: abortController.signal,
        }).catch((error): ProviderActivationResult => {
          if (isAbortError(error)) throw error
          return {
            providerId: provider.id,
            providerName: providerDisplayName,
            enabled: provider.enabled,
            hadCredential: !!provider.apiKey?.trim() || !!provider.credentialGroups?.some((group) => group.enabled && group.apiKey?.trim()),
            synced: false,
            syncAttempted: true,
            modelCount: provider.models.length,
            syncedGroups: 0,
            missingToken: false,
            ready: false,
            tested: false,
            testOk: false,
            messages: [],
            failures: [{
              providerName: providerDisplayName,
              message: error instanceof Error ? error.message : t('providerSettings.activationFailed'),
            }],
          }
        })
        const presentationResult: ProviderActivationResult = {
          ...result,
          providerName: providerDisplayName,
          failures: result.failures.map((failure) => ({
            ...failure,
            providerName: providerDisplayName,
            message: !provider.name || providerDisplayName === provider.name
              ? failure.message
              : failure.message.replaceAll(provider.name, providerDisplayName),
          })),
        }
        const resultReady = isProviderActivationReady(result)
        const resultStage = resultReady
          ? t('providerSettings.activationProviderReady', { name: providerDisplayName })
          : activationResultIssueStage(presentationResult, t)
        const resultFailed = result.failures.length > 0 && !resultReady
        publishActivationItem(result.providerId, {
          status: resultFailed ? 'failed' : 'done',
          progress: 1,
          synced: result.synced,
          tested: resultReady,
          failed: resultFailed,
          stage: resultStage,
        }, resultStage, providerDisplayName)
        return presentationResult
      }

      if (activationConcurrency > 1) {
        publishActivationItems(activationItems, t('providerSettings.activationStartedMessage', { count: chosen.length, concurrency: activationConcurrency }))
      }
      const results = await runProviderActivationPool(chosen, activationConcurrency, runProviderActivation, activationPolicy.afterProviderDelayMs, abortController.signal)
      await patchBuffer?.close()
      activationItems = finalizeActivationItemsFromResults(activationItems, results)
      flushActivationProgress()

      const finalAggregate = aggregateActivationItems(activationItems)
      const summary = summarizeProviderActivation(results)
      const issueGroups = summarizeProviderActivationIssueGroups(results)
      const doneTitle = activationDoneTitle(mode, chosen.length, t)
      const primaryReady = results.find((result) => isProviderActivationReady(result))
      if (primaryReady) {
        updateSettings({ defaultProvider: primaryReady.providerId })
      }
      if (mode === 'single') {
        const result = results[0]
        const title = result && isProviderActivationReady(result)
          ? t('providerSettings.activationSuccess')
          : result?.synced
            ? t('providerSettings.activationPartial')
            : t('providerSettings.activationFailed')
        dialog.toast({ title, message: summary.message, tone: summary.tone, position: 'bottom', durationMs: 3800, dedupeKey: 'provider-activation', priority: summary.tone === 'danger' ? 'high' : 'normal' })
      } else {
        dialog.toast({
          title: doneTitle,
          message: summary.message,
          tone: summary.tone,
          position: 'bottom',
          durationMs: 4200,
          dedupeKey: 'provider-activation',
          priority: summary.tone === 'danger' ? 'high' : 'normal',
        })
      }
      if (mountedRef.current) {
        input.onActivationCompleted?.()
      }
      const finalActivationJob = {
        status: summary.tone === 'danger' ? 'failed' : 'done',
        total: chosen.length,
        completed: finalAggregate.completed,
        progress: 1,
        synced: finalAggregate.synced,
        tested: finalAggregate.tested,
        failed: finalAggregate.failed,
        stage: summary.message,
        items: compactActivationItemsForUi(activationItems),
        issueGroups,
      } satisfies Omit<ActivationJobState, 'id' | 'updatedAt'>
      finishActivationJob(finalActivationJob)
      void publishProviderActivationStatusNotification(finalActivationJob, t, settings.systemStatusNotificationsEnabled === true)
      scheduleActivationNotificationClear()
      if (mode !== 'single') {
        setTimeout(() => {
          void flushProviderPersistence()
        }, 1200)
      }
      scheduleActivationJobDismiss(summary.tone, clearActivationJob)
    } catch (error) {
      if (!isAbortError(error)) throw error
    } finally {
      patchBuffer?.dispose()
      if (activationAbortController.current === abortController) activationAbortController.current = null
      if (mountedRef.current) setActivationBusy(false)
    }
  }

  return {
    activationBusy,
    activationJob,
    clearActivationJob,
    activateProviders,
    isActivationRunning: activationBusy || activationJob?.status === 'running',
  }
}

function publishProviderActivationStatusNotification(
  job: ActivationNotificationJob,
  t: ReturnType<typeof useTranslation>['t'],
  enabled: boolean,
) {
  if (!enabled) return Promise.resolve({ shown: false, reason: 'disabled', backgroundReliable: false } as const)
  const running = job.status === 'running'
  const failed = job.status === 'failed'
  const title = running
    ? t('providerSettings.activationRunning')
    : failed
      ? t('providerSettings.activationFailed')
      : activationDoneTitle(job.total === 1 ? 'single' : 'batch', job.total, t)
  const progress = resolveActivationJobProgress({
    total: job.total,
    completed: job.completed,
    progress: job.progress,
    items: job.items,
  })
  const summary = t('providerSettings.activationProgressMessage', {
    completed: job.completed,
    total: job.total,
    synced: job.synced,
    tested: job.tested,
    failed: job.failed,
  })

  return updateAndroidStatusNotification({
    state: running ? 'running' : failed ? 'error' : 'completed',
    title,
    message: [job.stage, job.currentName, summary].filter(Boolean).join('\n'),
    shortText: `${job.completed}/${job.total}`,
    deepLink: 'islemind://settings/providers',
    progress,
    indeterminate: job.total <= 0,
    ongoing: running,
    requestPromotedOngoing: running,
    foregroundService: true,
  })
}

async function runProviderActivationPool(
  providers: AIProvider[],
  concurrency: number,
  runProviderActivation: (provider: AIProvider) => Promise<ProviderActivationResult>,
  afterProviderDelayMs = 0,
  signal?: AbortSignal,
): Promise<ProviderActivationResult[]> {
  const results: ProviderActivationResult[] = new Array(providers.length)
  let nextIndex = 0
  const workerCount = Math.min(providers.length, Math.max(1, concurrency))
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < providers.length) {
      throwIfActivationAborted(signal)
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await runProviderActivation(providers[currentIndex])
      if (afterProviderDelayMs > 0 && nextIndex < providers.length) {
        await delayForInteractions(afterProviderDelayMs, signal)
      }
    }
  }))
  return results
}

function finalizeActivationItemsFromResults(items: ActivationJobItemState[], results: ProviderActivationResult[]): ActivationJobItemState[] {
  const byId = new Map(results.filter(Boolean).map((result) => [result.providerId, result]))
  return items.map((item) => {
    if (item.status === 'done' || item.status === 'failed') return item
    const result = byId.get(item.providerId)
    if (!result) return { ...item, status: 'failed', progress: 1, failed: true }
    const ready = isProviderActivationReady(result)
    const failed = result.failures.length > 0 && !ready
    return {
      ...item,
      status: failed ? 'failed' : 'done',
      progress: 1,
      synced: result.synced,
      tested: ready,
      failed,
    }
  })
}

function compactActivationItemsForUi(items: ActivationJobItemState[]): ActivationJobItemState[] {
  if (items.length <= ACTIVATION_JOB_VISIBLE_ITEM_LIMIT) return items
  const active = items.filter((item) => item.status === 'running')
  const failed = items.filter((item) => item.status === 'failed' || item.failed)
  const done = items.filter((item) => item.status === 'done' && !item.failed)
  const queued = items.filter((item) => item.status === 'queued')
  const compacted = dedupeActivationItems([
    ...active,
    ...failed,
    ...done.slice(-Math.max(0, ACTIVATION_JOB_VISIBLE_ITEM_LIMIT - active.length - failed.length)),
    ...queued,
  ]).slice(0, ACTIVATION_JOB_VISIBLE_ITEM_LIMIT)
  if (compacted.length >= ACTIVATION_JOB_VISIBLE_ITEM_LIMIT) return compacted
  return dedupeActivationItems([...compacted, ...items]).slice(0, ACTIVATION_JOB_VISIBLE_ITEM_LIMIT)
}

function dedupeActivationItems(items: ActivationJobItemState[]): ActivationJobItemState[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.providerId)) return false
    seen.add(item.providerId)
    return true
  })
}

function delayForInteractions(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms))
  throwIfActivationAborted(signal)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(activationAbortError(signal.reason))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
}

function throwIfActivationAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw activationAbortError(signal.reason)
}

function isAbortError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'name' in error && error.name === 'AbortError'
}

function activationAbortError(reason: unknown): Error {
  if (isAbortError(reason)) return reason as Error
  const error = new Error(reason instanceof Error ? reason.message : 'Provider activation was cancelled')
  error.name = 'AbortError'
  return error
}

function activationDoneTitle(mode: ProviderActivationMode, total: number, t: ReturnType<typeof useTranslation>['t']): string {
  if (mode === 'single' || total === 1) return t('providerSettings.activationSingleDone')
  if (mode === 'all') return t('providerSettings.activationAllDone')
  return t('providerSettings.activationBatchDone')
}

function scheduleActivationJobDismiss(tone: 'mint' | 'amber' | 'danger', clearActivationJob: () => void) {
  if (tone !== 'mint') return
  const jobId = useActivationJobStore.getState().job?.id
  setTimeout(() => {
    const current = useActivationJobStore.getState().job
    if (current && current.id === jobId && current.status !== 'running') clearActivationJob()
  }, 5000)
}

function activationResultIssueStage(result: ProviderActivationResult, t: ReturnType<typeof useTranslation>['t']): string {
  if (result.missingToken || !result.hadCredential) return t('providerActivation.missingToken')
  if (!result.modelCount) return t('providerActivation.noModels')
  const messages = dedupeActivationMessages(result.failures.map((failure) => failure.message))
  return messages[0] ?? t('providerSettings.activationProviderNeedsCheck', { name: result.providerName })
}

function dedupeActivationMessages(messages: string[]): string[] {
  const seen = new Set<string>()
  return messages
    .map((message) => message.trim())
    .filter((message) => {
      if (!message || seen.has(message)) return false
      seen.add(message)
      return true
    })
}
