import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsleDialog } from '@/components/ui/isle'
import { syncAndTestProvider, summarizeProviderActivation, type ProviderActivationResult } from '@/services/providerActivation'
import { ACTIVATION_STAGE_PROGRESS, aggregateActivationItems, createActivationItems, patchActivationItem, resolveProviderActivationRuntimePolicy, type ActivationItemPatch } from '@/services/providerActivationJob'
import { useActivationJobStore, type ActivationJobItemState } from '@/store/activationJobStore'
import { useSettingsStore } from '@/store/settingsStore'
import type { AIProvider } from '@/types'

export type ProviderActivationMode = 'single' | 'batch' | 'all'

interface UseProviderActivationJobInput {
  onActivationCompleted?: () => void
}

export function useProviderActivationJob(input: UseProviderActivationJobInput = {}) {
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const settings = useSettingsStore((state) => state.settings)
  const hydrateProviderKey = useSettingsStore((state) => state.hydrateProviderKey)
  const updateProvider = useSettingsStore((state) => state.updateProvider)
  const updateProviderCredentialGroupHealth = useSettingsStore((state) => state.updateProviderCredentialGroupHealth)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const activationJob = useActivationJobStore((state) => state.job)
  const startActivationJob = useActivationJobStore((state) => state.start)
  const updateActivationJob = useActivationJobStore((state) => state.update)
  const finishActivationJob = useActivationJobStore((state) => state.finish)
  const clearActivationJob = useActivationJobStore((state) => state.clear)
  const [activationBusy, setActivationBusy] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  async function activateProviders(ids: string[], mode: ProviderActivationMode): Promise<void> {
    if (activationBusy || activationJob?.status === 'running') return
    const currentProviders = useSettingsStore.getState().providers
    const chosen = ids.map((id) => currentProviders.find((provider) => provider.id === id)).filter((provider): provider is AIProvider => !!provider)
    if (!chosen.length) {
      dialog.toast({ title: t('providerSettings.enableNone'), tone: 'amber' })
      return
    }
    const startTitle = chosen.length === 1 ? t('providerSettings.activatingProvider') : t('providerSettings.activationStarted')
    const activationPolicy = resolveProviderActivationRuntimePolicy(chosen.length, mode)
    const activationConcurrency = activationPolicy.concurrency
    setActivationBusy(true)
    try {
      dialog.toast({
        title: startTitle,
        message: t('providerSettings.activationStartedMessage', { count: chosen.length, concurrency: activationConcurrency }),
        tone: 'mint',
        position: 'bottom',
        durationMs: 1800,
      })
      let activationItems = createActivationItems(chosen, t('providerSettings.activationQueued'))
      const publishActivationItems = (nextItems: ActivationJobItemState[], stage?: string, currentName?: string) => {
        activationItems = nextItems
        const aggregate = aggregateActivationItems(activationItems)
        updateActivationJob({
          status: 'running',
          total: chosen.length,
          completed: aggregate.completed,
          progress: aggregate.progress,
          synced: aggregate.synced,
          tested: aggregate.tested,
          failed: aggregate.failed,
          currentName,
          stage: stage ?? t('providerSettings.activationStartedMessage', { count: chosen.length, concurrency: activationConcurrency }),
          items: activationItems,
        })
      }
      const publishActivationItem = (providerId: string, updates: ActivationItemPatch, stage?: string, currentName?: string) => {
        publishActivationItems(patchActivationItem(activationItems, providerId, updates), stage, currentName)
      }
      startActivationJob({
        status: 'running',
        total: chosen.length,
        completed: 0,
        progress: 0,
        synced: 0,
        tested: 0,
        failed: 0,
        stage: chosen.length === 1 ? t('providerSettings.activationQueued') : t('providerSettings.activationStartedMessage', { count: chosen.length, concurrency: activationConcurrency }),
        items: activationItems,
      })
      const runProviderActivation = async (provider: AIProvider): Promise<ProviderActivationResult> => {
        const currentStage = t('providerSettings.activationCurrent', { name: provider.name })
        publishActivationItem(provider.id, {
          status: 'running',
          progress: 0.04,
          stage: currentStage,
        }, currentStage, provider.name)
        const result = await syncAndTestProvider(provider, {
          updateProvider,
          hydrateProviderKey,
          updateProviderCredentialGroupHealth,
          onStage: (event) => {
            publishActivationItem(event.providerId, {
              status: event.stage === 'failed' ? 'failed' : 'running',
              progress: ACTIVATION_STAGE_PROGRESS[event.stage],
              failed: event.stage === 'failed',
              stage: event.message,
            }, event.message, event.providerName)
          },
        }, {
          enable: true,
          testModel: settings.modelTestModel,
          checkParameters: false,
          accessSettings: settings,
          maxTestCandidates: activationPolicy.maxTestCandidates,
          modelSyncTimeoutMs: activationPolicy.modelSyncTimeoutMs,
          modelTestTimeoutMs: activationPolicy.modelTestTimeoutMs,
        }).catch((error): ProviderActivationResult => ({
          providerId: provider.id,
          providerName: provider.name,
          enabled: provider.enabled,
          hadCredential: !!provider.apiKey?.trim() || !!provider.credentialGroups?.some((group) => group.enabled && group.apiKey?.trim()),
          synced: false,
          syncAttempted: true,
          modelCount: provider.models.length,
          syncedGroups: 0,
          missingToken: false,
          tested: false,
          testOk: false,
          messages: [],
          failures: [{
            providerName: provider.name,
            message: error instanceof Error ? error.message : t('providerSettings.activationFailed'),
          }],
        }))
        const resultStage = result.testOk
          ? t('providerSettings.activationProviderReady', { name: result.providerName })
          : activationResultIssueStage(result, t)
        const resultFailed = result.failures.length > 0 && !result.testOk
        publishActivationItem(result.providerId, {
          status: resultFailed ? 'failed' : 'done',
          progress: 1,
          synced: result.synced,
          tested: result.testOk,
          failed: resultFailed,
          stage: resultStage,
        }, resultStage, result.providerName)
        return result
      }

      if (activationConcurrency > 1) {
        publishActivationItems(activationItems, t('providerSettings.activationStartedMessage', { count: chosen.length, concurrency: activationConcurrency }))
      }
      const results = await runProviderActivationPool(chosen, activationConcurrency, runProviderActivation, activationPolicy.afterProviderDelayMs)
      activationItems = finalizeActivationItemsFromResults(activationItems, results)

      const finalAggregate = aggregateActivationItems(activationItems)
      const summary = summarizeProviderActivation(results)
      const doneTitle = activationDoneTitle(mode, chosen.length, t)
      const primaryReady = results.find((result) => result.testOk)
      if (primaryReady) {
        updateSettings({ defaultProvider: primaryReady.providerId })
      }
      if (mode === 'single') {
        const result = results[0]
        const title = result?.testOk
          ? t('providerSettings.activationSuccess')
          : result?.synced
            ? t('providerSettings.activationPartial')
            : t('providerSettings.activationFailed')
        dialog.toast({ title, message: summary.message, tone: summary.tone, position: 'bottom', durationMs: 3800 })
      } else {
        dialog.toast({
          title: doneTitle,
          message: summary.message,
          tone: summary.tone,
          position: 'bottom',
          durationMs: 4200,
        })
      }
      if (mountedRef.current) {
        input.onActivationCompleted?.()
      }
      finishActivationJob({
        status: summary.tone === 'danger' ? 'failed' : 'done',
        total: chosen.length,
        completed: finalAggregate.completed,
        progress: 1,
        synced: finalAggregate.synced,
        tested: finalAggregate.tested,
        failed: finalAggregate.failed,
        stage: summary.message,
        items: activationItems,
      })
      scheduleActivationJobDismiss(summary.tone, clearActivationJob)
    } finally {
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

async function runProviderActivationPool(
  providers: AIProvider[],
  concurrency: number,
  runProviderActivation: (provider: AIProvider) => Promise<ProviderActivationResult>,
  afterProviderDelayMs = 0
): Promise<ProviderActivationResult[]> {
  const results: ProviderActivationResult[] = new Array(providers.length)
  let nextIndex = 0
  const workerCount = Math.min(providers.length, Math.max(1, concurrency))
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < providers.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await runProviderActivation(providers[currentIndex])
      if (afterProviderDelayMs > 0 && nextIndex < providers.length) {
        await delayForInteractions(afterProviderDelayMs)
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
    const failed = result.failures.length > 0 && !result.testOk
    return {
      ...item,
      status: failed ? 'failed' : 'done',
      progress: 1,
      synced: result.synced,
      tested: result.testOk,
      failed,
    }
  })
}

function delayForInteractions(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
