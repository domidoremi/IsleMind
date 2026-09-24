import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsleDialog } from '@/components/ui/isle'
import { useSettingsStore } from '@/store/settingsStore'
import { flushPersistedSettings } from '@/presentation/features/settings/settingsStorePersistenceCommand'
import type { Settings } from '@/types/settingsContracts'

// Never offer blanket undo for permission, network, data or billing operations.
const reversible = new Set<keyof Settings>(['theme', 'themeId', 'themeAccent', 'backgroundVariation', 'backgroundMotion', 'backgroundIntensity', 'backgroundPreset', 'hapticsEnabled', 'commandPaletteEnabled', 'assistantDisplayName', 'defaultTemperature', 'defaultMaxTokens'])
type Undo = { previous: Partial<Settings>; versions: Map<keyof Settings, number> }
export function usePreferenceUndo() {
  const revisions = useRef(new Map<keyof Settings, number>())
  const sequence = useRef(0)
  const [pending, setPending] = useState<Undo | null>(null)
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  useEffect(() => useSettingsStore.subscribe((next, previous) => {
    for (const key of reversible) if (!Object.is(next.settings[key], previous.settings[key])) revisions.current.set(key, (revisions.current.get(key) ?? 0) + 1)
  }), [])
  useEffect(() => () => { sequence.current += 1 }, [])
  function updateSettings(patch: Partial<Settings>) {
    const operation = ++sequence.current
    setPending(null)
    const store = useSettingsStore.getState()
    const keys = Object.keys(patch) as (keyof Settings)[]
    const previous = Object.fromEntries(keys.map(key => [key, store.settings[key]])) as Partial<Settings>
    store.updateSettings(patch)
    if (keys.length && keys.every(key => reversible.has(key))) {
      const versions = new Map(keys.map(key => [key, revisions.current.get(key) ?? 0]))
      void flushPersistedSettings().then(() => { if (operation === sequence.current) setPending({ previous, versions }) })
        .catch(() => dialog.toast({ title: t('settingsWorkspace.saveFailed'), tone: 'danger' }))
    }
  }
  function undo() {
    if (!pending) return
    const keys = [...pending.versions.keys()].filter(key => (revisions.current.get(key) ?? 0) === pending.versions.get(key))
    sequence.current += 1
    setPending(null)
    if (!keys.length) return
    useSettingsStore.getState().updateSettings(Object.fromEntries(keys.map(key => [key, pending.previous[key]])) as Partial<Settings>)
    void flushPersistedSettings().catch(() => dialog.toast({ title: t('settingsWorkspace.saveFailed'), tone: 'danger' }))
  }
  return { updateSettings, undo, canUndo: pending !== null }
}
