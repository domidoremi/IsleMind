import { useEffect, useSyncExternalStore } from 'react'
import { Platform } from 'react-native'
import {
  getSettingsSearchSnapshot,
  loadSettingsSearch,
  retrySettingsSearch,
  setSettingsSearchQuery,
  subscribeSettingsSearch,
} from '@/presentation/features/settings/settingsStorePersistenceCommand'

export function useSettingsSearch() {
  const snapshot = useSyncExternalStore(subscribeSettingsSearch, getSettingsSearchSnapshot, getSettingsSearchSnapshot)
  useEffect(() => { void loadSettingsSearch().catch(() => undefined) }, [])
  useEffect(() => {
    if (Platform.OS !== 'web') return
    const preventUnload = (event: BeforeUnloadEvent) => {
      const current = getSettingsSearchSnapshot()
      if (!current.pending && current.failure !== 'save') return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', preventUnload)
    return () => window.removeEventListener('beforeunload', preventUnload)
  }, [])
  return {
    ...snapshot,
    setQuery: (query: string) => { void setSettingsSearchQuery(query).catch(() => undefined) },
    retry: () => { void retrySettingsSearch().catch(() => undefined) },
  }
}
