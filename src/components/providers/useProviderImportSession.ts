import { useRef, useState } from 'react'
import { parseProviderImportText } from '@/bootstrap/providerRegistry'
import { useSettingsStore } from '@/store/settingsStore'
import { flushPersistedSettings } from '@/presentation/features/settings/settingsStorePersistenceCommand'
import type { AIProvider } from '@/types/providerContracts'
import { useSettingsLifetime } from '@/components/settings/SettingsEditBoundary'

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
  const lifetime = useSettingsLifetime()
  const [persistencePending, setPersistencePending] = useState(false)

  function reset() {
    if (running.current || lifetime.current?.signal.aborted) return
    attempt.current = null
    setPersistencePending(false)
  }

  async function save(input: string, onPrepared: (total: number) => Promise<void>, onProgress: (progress: ImportProgress) => void, skipExisting = true): Promise<ImportResult | null> {
    const signal = lifetime.current?.signal
    if (running.current || signal?.aborted) return null
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
      if (signal?.aborted) return null
      if (!current.committed) {
        await store.addProviders(result.providers, {
          persist: 'deferred', yieldEvery: 4, selectDefaultIfEmpty: false, signal,
          onProgress: progress => { if (!signal?.aborted) onProgress(progress) },
        })
        current.committed = true
        if (!signal?.aborted) setPersistencePending(true)
      } else {
        // Requeue the latest settings after a failed write, preserving later edits.
        store.updateSettings({})
      }
      await store.flushProviderPersistence()
      await flushPersistedSettings()
      attempt.current = null
      if (signal?.aborted) return null
      setPersistencePending(false)
      return result
    } catch (error) {
      if (signal?.aborted && !attempt.current?.committed) return null
      throw error
    } finally {
      running.current = false
    }
  }

  return { save, reset, persistencePending }
}
