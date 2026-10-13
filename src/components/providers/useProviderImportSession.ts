import { useRef, useState } from 'react'
import { parseProviderImportText } from '@/bootstrap/providerRegistry'
import { useSettingsStore } from '@/store/settingsStore'
import { flushPersistedSettings } from '@/presentation/features/settings/settingsStorePersistenceCommand'
import type { AIProvider } from '@/types/providerContracts'

type ImportResult = ReturnType<typeof parseProviderImportText>
type ImportProgress = { completed: number; total: number; currentProviderName?: string }

export function isExistingProviderImport(candidate: AIProvider, existing: readonly AIProvider[]): boolean {
  return existing.some(provider => provider.name.trim().toLowerCase() === candidate.name.trim().toLowerCase()
    && (provider.baseUrl ?? '').trim().replace(/\/+$/, '') === (candidate.baseUrl ?? '').trim().replace(/\/+$/, ''))
}

/** Keep retry identity in this editor only; never replay an already committed import. */
export function useProviderImportSession() {
  const attempt = useRef<{ input: string; skipExisting: boolean; result: ImportResult; committed: boolean } | null>(null)
  const running = useRef(false)
  const [persistencePending, setPersistencePending] = useState(false)

  function reset() {
    if (running.current) return
    attempt.current = null
    setPersistencePending(false)
  }

  async function save(input: string, onPrepared: (total: number) => Promise<void>, onProgress: (progress: ImportProgress) => void, skipExisting = true): Promise<ImportResult | null> {
    if (running.current) return null
    running.current = true
    try {
      const store = useSettingsStore.getState()
      if (!attempt.current || (!attempt.current.committed && (attempt.current.input !== input || attempt.current.skipExisting !== skipExisting))) {
        const parsed = parseProviderImportText(input, { accessSettings: store.settings })
        const result = skipExisting ? { ...parsed, providers: parsed.providers.filter(provider => !isExistingProviderImport(provider, store.providers ?? [])) } : parsed
        attempt.current = { input, skipExisting, result, committed: false }
      }
      const current = attempt.current
      const { result } = current
      if (!result.providers.length) return result
      await onPrepared(result.providers.length)
      if (!current.committed) {
        await store.addProviders(result.providers, { persist: 'deferred', yieldEvery: 4, onProgress, selectDefaultIfEmpty: false })
        current.committed = true
        setPersistencePending(true)
      } else {
        // Requeue the latest settings after a failed write, preserving later edits.
        store.updateSettings({})
      }
      await store.flushProviderPersistence()
      await flushPersistedSettings()
      attempt.current = null
      setPersistencePending(false)
      return result
    } finally {
      running.current = false
    }
  }

  return { save, reset, persistencePending }
}
