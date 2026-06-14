import { useEffect, useState } from 'react'
import * as SystemUI from 'expo-system-ui'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { initializeContextStore } from '@/services/contextStore'
import { localDataStore } from '@/services/localDataStore'
import { checkLatestApkReleaseSilently, shouldAutoCheckApkUpdate, shouldRecordApkUpdateCheck } from '@/services/appUpdates'
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
    async function load() {
      const results = await Promise.allSettled([
        safeBootstrap(st('bootstrap.chatData'), loadChats),
        safeBootstrap(st('bootstrap.settings'), loadSettings),
      ])
      const initialErrors = results.filter((result) => result.status === 'rejected').length
      initI18n(useSettingsStore.getState().settings.language)

      if (mounted) {
        // 优化：不再在启动时初始化 contextStore (会加载 AI 模型)
        // AI 模型现在采用延迟加载，仅在首次使用时加载
        void safeBootstrap(st('bootstrap.localDatabase'), async () => {
          await localDataStore.initialize()
          // 移除: await initializeContextStore()
          // Context store 将在首次需要时通过 lazyEmbedding 自动初始化
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
