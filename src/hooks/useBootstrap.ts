import { useEffect, useState } from 'react'
import * as SystemUI from 'expo-system-ui'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { checkLatestApkReleaseSilently, shouldAutoCheckApkUpdate, shouldRecordApkUpdateCheck } from '@/services/appUpdates'
import { clearStagedApkDownloads } from '@/services/apkInstallCache'
import {
  createVNextConversationRuntime,
  initializePortableDataApplication,
  recoverInterruptedPortableImport,
  recoverConversationWorkspaceWritebackReceipts,
  recoverVNextInterruptedTasks,
  recoverVNextWorkflowCheckpoints,
} from '@/bootstrap'
import { initializeConversationReplyStart } from '@/bootstrap/conversationReplyStart'
import { initializeConversationSkills } from '@/bootstrap/conversationSkills'
import { initializeConversationStorePersistence } from '@/bootstrap/conversationStorePersistence'
import { initializeSettingsStorePersistence } from '@/bootstrap/settingsStorePersistence'
import { cancelAllConversationAssistantDetachedWork } from '@/bootstrap/conversationAssistantDetachedWorkRegistry'
import { recoverVNextChatRuns } from '@/presentation/features/conversations/vnextPlainChatCommand'
import { initI18n } from '@/i18n'
import { st } from '@/i18n/service'
import { useAppTheme } from './useAppTheme'
export function useBootstrap() {
  const loadChats = useChatStore((state) => state.load)
  const loadSettings = useSettingsStore((state) => state.load)
  const { colors } = useAppTheme()
  const [state, setState] = useState(() => ({
    ready: false,
    errorCount: 0,
    bootStartedAt: Date.now(),
    updateNotice: null as string | null,
  }))

  useEffect(() => {
    let mounted = true
    const recoveryController = new AbortController()
    async function load() {
      try {
        const portableImportRecovery = await recoverInterruptedPortableImport()
        if (portableImportRecovery.status === 'recovery_required') {
          throw new Error('Portable import recovery requires attention.')
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : st('error.unknownError')
        useChatStore.getState().setError(st('bootstrap.failed', {
          label: st('bootstrap.chatData'),
          message,
        }))
        if (mounted) {
          setState((current) => ({ ...current, errorCount: current.errorCount + 1 }))
        }
        return
      }
      initializePortableDataApplication()
      initializeConversationStorePersistence()
      initializeSettingsStorePersistence()
      initializeConversationSkills()
      initializeConversationReplyStart()
      const results = await Promise.allSettled([
        safeBootstrap(st('bootstrap.chatData'), loadChats),
        safeBootstrap(st('bootstrap.settings'), loadSettings),
      ])
      let initialErrors = results.filter((result) => result.status === 'rejected').length
      try {
        const recoveredRuns = await recoverVNextChatRuns(createVNextConversationRuntime())
        const workflowCheckpointRecovery = await recoverVNextWorkflowCheckpoints(
          recoveredRuns.map((run) => run.id),
          { signal: recoveryController.signal },
        )
        if (workflowCheckpointRecovery.completion === 'cancelled') return
        if (workflowCheckpointRecovery.failedCount > 0) initialErrors += 1
        const workspaceReceiptRecovery = await recoverConversationWorkspaceWritebackReceipts(
          recoveredRuns,
          { signal: recoveryController.signal },
        )
        if (workspaceReceiptRecovery.status === 'cancelled') return
        if (
          workspaceReceiptRecovery.ambiguousReceiptCount > 0
          || workspaceReceiptRecovery.failedReceiptCount > 0
        ) {
          initialErrors += 1
        }
        const taskRecovery = await recoverVNextInterruptedTasks()
        if (!taskRecovery.ok) throw new Error(taskRecovery.error.message)
      } catch {
        initialErrors += 1
      }
      initI18n(useSettingsStore.getState().settings.language)

      if (mounted) {
        void safeBootstrap(st('bootstrap.stagedApkCleanup'), async () => {
          await clearStagedApkDownloads()
        }).catch(() => {
          setState((current) => ({ ...current, errorCount: current.errorCount + 1 }))
        })
        setState((current) => ({
          ...current,
          ready: true,
          errorCount: current.errorCount + initialErrors,
        }))
        void safeBootstrap(st('bootstrap.updateCheck'), async () => {
          const settings = useSettingsStore.getState().settings
          if (!(settings.autoUpdateCheckEnabled ?? true)) return
          if (!shouldAutoCheckApkUpdate(settings.lastApkUpdateCheckAt)) return
          const result = await checkLatestApkReleaseSilently()
          if (shouldRecordApkUpdateCheck(result)) {
            useSettingsStore.getState().updateSettings({ lastApkUpdateCheckAt: Date.now() })
          }
          if (result.status === 'available' && result.release) {
            setState((current) => ({ ...current, updateNotice: st('updates.available', { version: result.release?.version ?? '' }) }))
          }
        }).catch(() => {
          setState((current) => ({ ...current, errorCount: current.errorCount + 1 }))
        })
      }
    }
    void load()
    return () => {
      mounted = false
      recoveryController.abort()
      cancelAllConversationAssistantDetachedWork()
    }
  }, [loadChats, loadSettings])

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.surface)
  }, [colors.surface])

  return state
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
