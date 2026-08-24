import { useCallback, useEffect, useRef, useState } from 'react'
import * as SystemUI from 'expo-system-ui'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { initializePortableDataApplication } from '@/bootstrap/portableDataApplication'
import { recoverInterruptedPortableImport } from '@/bootstrap/portableImportRecovery'
import { initializeConversationReplyStart } from '@/bootstrap/conversationReplyStart'
import { initializeConversationSkills } from '@/bootstrap/conversationSkills'
import { initializeConversationStorePersistence } from '@/bootstrap/conversationStorePersistence'
import { initializeConversationComposerDraftPersistence } from '@/bootstrap/conversationComposerDrafts'
import { initializeSettingsStorePersistence } from '@/bootstrap/settingsStorePersistence'
import { cancelAllConversationAssistantDetachedWork } from '@/bootstrap/conversationAssistantDetachedWorkRegistry'
import { initI18n } from '@/i18n'
import { st } from '@/i18n/service'
import { useAppTheme } from './useAppTheme'

type BootstrapStatus = 'loading' | 'ready' | 'blocked'

interface BootstrapFailure {
  reference: 'BOOT-PORTABLE-RECOVERY' | 'BOOT-STARTUP'
  message: string
}

export function useBootstrap() {
  const loadChats = useChatStore((state) => state.load)
  const loadSettings = useSettingsStore((state) => state.load)
  const { colors } = useAppTheme()
  const retryRequestedRef = useRef(false)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState(() => ({
    status: 'loading' as BootstrapStatus,
    ready: false,
    errorCount: 0,
    bootStartedAt: Date.now(),
    updateNotice: null as string | null,
    failure: null as BootstrapFailure | null,
  }))

  const retry = useCallback(() => {
    if (retryRequestedRef.current) return
    retryRequestedRef.current = true
    useChatStore.getState().setError(null)
    setState((current) => ({
      ...current,
      status: 'loading',
      ready: false,
      bootStartedAt: Date.now(),
      updateNotice: null,
      failure: null,
    }))
    setAttempt((current) => current + 1)
  }, [])

  useEffect(() => {
    let mounted = true
    const recoveryController = new AbortController()
    retryRequestedRef.current = false

    function blockBootstrap(reference: BootstrapFailure['reference'], error: unknown) {
      if (!mounted || recoveryController.signal.aborted) return
      const detail = formatBootstrapFailureMessage(error)
      const message = st('bootstrap.failed', {
        label: st('bootstrap.chatData'),
        message: detail,
      })
      useChatStore.getState().setError(message)
      retryRequestedRef.current = false
      setState((current) => ({
        ...current,
        status: 'blocked',
        ready: false,
        errorCount: current.errorCount + 1,
        failure: { reference, message },
      }))
    }

    async function recoverDeferredRuntimeState(): Promise<void> {
      try {
        const [
          { recoverChatRuns },
          { createConversationRuntime },
          { recoverConversationWorkspaceWritebackReceipts },
          { recoverInterruptedTasks },
          { recoverWorkflowCheckpoints },
        ] = await Promise.all([
          import('@/presentation/features/conversations/plainChatCommand'),
          import('@/bootstrap/conversationRuntime'),
          import('@/bootstrap/conversationWorkspaceWritebackRecoveryRuntime'),
          import('@/bootstrap/taskRuntime'),
          import('@/bootstrap/workflowCheckpointRecovery'),
        ])
        if (!mounted || recoveryController.signal.aborted) return

        let deferredErrors = 0
        const recoveredRuns = await recoverChatRuns(createConversationRuntime())
        const workflowCheckpointRecovery = await recoverWorkflowCheckpoints(
          recoveredRuns.map((run) => run.id),
          { signal: recoveryController.signal },
        )
        if (workflowCheckpointRecovery.completion === 'cancelled') return
        if (workflowCheckpointRecovery.failedCount > 0) deferredErrors += 1
        const workspaceReceiptRecovery = await recoverConversationWorkspaceWritebackReceipts(
          recoveredRuns,
          { signal: recoveryController.signal },
        )
        if (workspaceReceiptRecovery.status === 'cancelled') return
        if (
          workspaceReceiptRecovery.ambiguousReceiptCount > 0
          || workspaceReceiptRecovery.failedReceiptCount > 0
        ) {
          deferredErrors += 1
        }
        const taskRecovery = await recoverInterruptedTasks()
        if (!taskRecovery.ok) deferredErrors += 1
        if (deferredErrors > 0 && mounted && !recoveryController.signal.aborted) {
          setState((current) => ({ ...current, errorCount: current.errorCount + deferredErrors }))
        }
      } catch {
        if (!mounted || recoveryController.signal.aborted) return
        setState((current) => ({ ...current, errorCount: current.errorCount + 1 }))
      }
    }

    async function load() {
      let blockingFailureReference: BootstrapFailure['reference'] = 'BOOT-PORTABLE-RECOVERY'
      try {
        const portableImportRecovery = await recoverInterruptedPortableImport()
        if (portableImportRecovery.status === 'recovery_required') {
          throw new Error('Portable import recovery requires attention.')
        }
        if (!mounted || recoveryController.signal.aborted) return

        blockingFailureReference = 'BOOT-STARTUP'
        initializePortableDataApplication()
        initializeConversationStorePersistence()
        initializeConversationComposerDraftPersistence()
        initializeSettingsStorePersistence()
        initializeConversationSkills()
        initializeConversationReplyStart()
        const results = await Promise.allSettled([
          safeBootstrap(st('bootstrap.chatData'), loadChats),
          safeBootstrap(st('bootstrap.settings'), loadSettings),
        ])
        if (!mounted || recoveryController.signal.aborted) return

        const initialErrors = results.filter((result) => result.status === 'rejected').length
        initI18n(useSettingsStore.getState().settings.language)

        if (!mounted || recoveryController.signal.aborted) return
        setState((current) => ({
          ...current,
          status: 'ready',
          ready: true,
          errorCount: current.errorCount + initialErrors,
          failure: null,
        }))
        void recoverDeferredRuntimeState()
        void safeBootstrap(st('bootstrap.stagedApkCleanup'), async () => {
          const { clearStagedApkDownloads } = await import('@/services/apkInstallCache')
          await clearStagedApkDownloads()
        }).catch(() => {
          if (!mounted) return
          setState((current) => ({ ...current, errorCount: current.errorCount + 1 }))
        })
        void safeBootstrap(st('bootstrap.updateCheck'), async () => {
          const {
            checkLatestApkReleaseSilently,
            shouldAutoCheckApkUpdate,
            shouldRecordApkUpdateCheck,
          } = await import('@/platform/native/androidApkUpdates')
          const settings = useSettingsStore.getState().settings
          if (!(settings.autoUpdateCheckEnabled ?? true)) return
          if (!shouldAutoCheckApkUpdate(settings.lastApkUpdateCheckAt)) return
          const result = await checkLatestApkReleaseSilently()
          if (shouldRecordApkUpdateCheck(result)) {
            useSettingsStore.getState().updateSettings({ lastApkUpdateCheckAt: Date.now() })
          }
          if (result.status === 'available' && result.release && mounted) {
            setState((current) => ({ ...current, updateNotice: st('updates.available', { version: result.release?.version ?? '' }) }))
          }
        }).catch(() => {
          if (!mounted) return
          setState((current) => ({ ...current, errorCount: current.errorCount + 1 }))
        })
      } catch (error) {
        blockBootstrap(blockingFailureReference, error)
      }
    }
    void load()
    return () => {
      mounted = false
      recoveryController.abort()
      cancelAllConversationAssistantDetachedWork()
    }
  }, [attempt, loadChats, loadSettings])

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.surface)
  }, [colors.surface])

  return { ...state, retry }
}

function formatBootstrapFailureMessage(error: unknown): string {
  const message = error instanceof Error && error.message.trim()
    ? error.message.trim()
    : st('error.unknownError')
  return message
    .replace(/\b(tp-[A-Za-z0-9_-]{24,})\b/g, 'tp-***')
    .replace(/\b(sk-[A-Za-z0-9_-]{20,})\b/g, 'sk-***')
    .replace(/\b(gh[pousr]_[A-Za-z0-9_]{20,})\b/g, 'gh***')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{20,}\b/gi, '$1***')
    .replace(/([?&](?:api[_-]?key|key|token|access_token)=)[^&\s]+/gi, '$1***')
    .slice(0, 320)
}

async function safeBootstrap(label: string, task: () => Promise<void>): Promise<void> {
  try {
    await task()
  } catch (error) {
    const message = error instanceof Error ? error.message : st('error.unknownError')
    useChatStore.getState().setError(st('bootstrap.failed', { label, message }))
    throw error
  }
}
