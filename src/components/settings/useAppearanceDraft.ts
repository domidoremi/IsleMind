import { useEffect, useRef, useState } from 'react'
import type { GestureResponderEvent } from 'react-native'
import type { Settings } from '@/types/settingsContracts'
import { normalizeThemeAccent, normalizeThemeId } from '@/theme/colors'
import { useSettingsStore } from '@/store/settingsStore'
import { flushPersistedSettings } from '@/presentation/features/settings/settingsStorePersistenceCommand'
import type { ThemeSelection } from '@/hooks/useThemeSelection'
import { useSettingsDraft, useSettingsLifetime } from './SettingsEditBoundary'

type AppearanceSettings = Pick<Settings, 'theme' | 'themeId' | 'themeAccent'>
export function appearanceSelection(settings: AppearanceSettings) {
  return { theme: settings.theme, themeId: normalizeThemeId(settings.themeId), themeAccent: normalizeThemeAccent(settings.themeAccent) }
}
export type AppearanceSelection = ReturnType<typeof appearanceSelection>

/** Color previews stay local; discrete choices and Apply share one durable commit. */
export function useAppearanceDraft(settings: AppearanceSettings, select: (selection: ThemeSelection, event?: GestureResponderEvent, canCommit?: () => boolean) => Promise<boolean>) {
  const source = appearanceSelection(settings)
  const sourceKey = JSON.stringify(source)
  const [draft, setDraft] = useState(source)
  const [baseline, setBaseline] = useState(sourceKey)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<'conflict' | 'saveFailed'>()
  const locked = useRef(false)
  const lifetime = useSettingsLifetime()
  const draftKey = JSON.stringify(draft)
  const dirty = draftKey !== baseline || error !== undefined
  const read = () => appearanceSelection(useSettingsStore.getState().settings)

  useEffect(() => {
    if (locked.current || sourceKey === baseline) return
    if (draftKey === baseline && !error) {
      setDraft(JSON.parse(sourceKey) as AppearanceSelection)
      setBaseline(sourceKey); setSaved(false); setError(undefined)
    } else setError('conflict')
  }, [baseline, draftKey, error, sourceKey])

  function discard() {
    if (locked.current || lifetime.current?.signal.aborted) return
    const next = read()
    setDraft(next); setBaseline(JSON.stringify(next)); setError(undefined); setSaved(false)
  }
  useSettingsDraft(dirty, busy, discard, draftKey)

  function edit(patch: ThemeSelection) {
    if (locked.current || lifetime.current?.signal.aborted) return
    setDraft(current => appearanceSelection({ ...current, ...patch }))
    setSaved(false)
  }
  async function commit(selection: AppearanceSelection, event?: GestureResponderEvent) {
    const signal = lifetime.current?.signal
    if (locked.current || signal?.aborted) return false
    if (JSON.stringify(read()) !== baseline) { setError('conflict'); return false }
    const selectionKey = JSON.stringify(selection)
    locked.current = true; setBusy(true); setSaved(false); setError(undefined)
    let committedKey: string | undefined
    try {
      if (!await select(selection, event, () => !signal?.aborted && JSON.stringify(read()) === baseline)) throw new Error('appearance_selection_failed')
      if (signal?.aborted) return false
      const memory = JSON.stringify(read())
      committedKey = memory
      setBaseline(memory)
      if (memory !== selectionKey) { setError('conflict'); return false }
      await flushPersistedSettings()
      if (signal?.aborted) return false
      if (JSON.stringify(read()) !== selectionKey) { setError('conflict'); return false }
      setSaved(true)
      return true
    } catch {
      if (!signal?.aborted) {
        // A disk retry can follow a successful in-memory appearance commit.
        const current = JSON.stringify(read())
        if ((committedKey && current !== committedKey) || (!committedKey && current !== baseline && current !== selectionKey)) setError('conflict')
        else { setBaseline(current); setError('saveFailed') }
      }
      return false
    } finally {
      locked.current = false
      if (!signal?.aborted) setBusy(false)
    }
  }
  function choose(patch: Pick<ThemeSelection, 'theme' | 'themeId'>, event?: GestureResponderEvent) {
    if (locked.current || lifetime.current?.signal.aborted) return Promise.resolve(false)
    const current = read()
    if (JSON.stringify(current) !== baseline) { setError('conflict'); return Promise.resolve(false) }
    // A family/mode tap must not silently submit a separate color preview.
    setDraft(previous => appearanceSelection({ ...previous, ...patch }))
    return commit(appearanceSelection({ ...current, ...patch }), event)
  }
  function apply(event?: GestureResponderEvent) {
    return commit(draft, event)
  }
  return { draft, dirty, busy, saved, error, edit, choose, apply, discard }
}
