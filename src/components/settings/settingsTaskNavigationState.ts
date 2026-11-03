import { useSyncExternalStore } from 'react'

export const SETTINGS_TASK_AREAS = ['everyday', 'capabilities', 'manage', 'support'] as const
export type SettingsTaskArea = typeof SETTINGS_TASK_AREAS[number]

export function createSettingsTaskNavigationState() {
  let area: SettingsTaskArea = 'everyday'
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => area,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    select: (next: SettingsTaskArea) => {
      if (next === area) return
      area = next
      listeners.forEach(listener => listener())
    },
  }
}

// Navigation survives a return route without becoming an execution setting.
export const settingsTaskNavigationState = createSettingsTaskNavigationState()

export function useSettingsTaskNavigation() {
  const area = useSyncExternalStore(settingsTaskNavigationState.subscribe,
    settingsTaskNavigationState.getSnapshot, settingsTaskNavigationState.getSnapshot)
  return { area, select: settingsTaskNavigationState.select }
}
