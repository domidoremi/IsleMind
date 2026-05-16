import { useEffect, useState } from 'react'
import * as SystemUI from 'expo-system-ui'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { initializeContextStore } from '@/services/contextStore'
import { localDataStore } from '@/services/localDataStore'
import { colors } from '@/theme/colors'
import { useAppTheme } from './useAppTheme'

export function useBootstrap() {
  const loadChats = useChatStore((state) => state.load)
  const loadSettings = useSettingsStore((state) => state.load)
  const { isDark } = useAppTheme()
  const [state, setState] = useState(() => ({
    ready: false,
    errorCount: 0,
    bootStartedAt: Date.now(),
  }))

  useEffect(() => {
    let mounted = true
    async function load() {
      const results = await Promise.allSettled([
        safeBootstrap('对话数据', loadChats),
        safeBootstrap('应用设置', loadSettings),
      ])
      const initialErrors = results.filter((result) => result.status === 'rejected').length

      if (mounted) {
        void safeBootstrap('本地数据库', async () => {
          await localDataStore.initialize()
          await initializeContextStore()
        }).catch(() => {
          setState((current) => ({ ...current, errorCount: current.errorCount + 1 }))
        })
        setState((current) => ({
          ...current,
          ready: true,
          errorCount: current.errorCount + initialErrors,
        }))
      }
    }
    void load()
    return () => {
      mounted = false
    }
  }, [loadChats, loadSettings])

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(isDark ? colors.dark.surface : colors.light.surface)
  }, [isDark])

  return state
}

async function safeBootstrap(label: string, task: () => Promise<void>): Promise<void> {
  try {
    await task()
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    useChatStore.getState().setError(`${label}初始化失败：${message}`)
    throw error
  }
}
