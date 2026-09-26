import { useRef, useState } from 'react'
import { Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { IsleButton, IsleField, useIsleDialog } from '@/components/ui/isle'
import { useSettingsStore } from '@/store/settingsStore'
import type { Settings } from '@/types/settingsContracts'
import { flushPersistedSettings } from '@/presentation/features/settings/settingsStorePersistenceCommand'
import type { CommittedSettingsFieldProps } from './CommittedSettingsField'
import { useSettingsDraft } from './SettingsEditBoundary'
import { useAppTheme } from '@/hooks/useAppTheme'

type Entry = { draft: string; baseline: string | undefined; error?: 'conflict' | 'saveFailed' }
/** Owned by the page, not its conditionally mounted advanced fields. */
export function useSettingsFieldSession() {
  const [entries, setEntries] = useState<Partial<Record<keyof Settings, Entry>>>({})
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  useSettingsDraft(Object.keys(entries).length > 0, busy, () => setEntries({}))
  function discard(key: keyof Settings) { setEntries(current => { const next = { ...current }; delete next[key]; return next }) }
  function edit(key: keyof Settings, draft: string, saved: string) {
    if (lock.current) return
    if (draft === saved) { discard(key); return }
    const baseline = JSON.stringify(useSettingsStore.getState().settings[key])
    setEntries(current => ({ ...current, [key]: { draft, baseline: current[key] ? current[key].baseline : baseline } }))
  }
  async function save(key: keyof Settings, commit: (value: string) => void, normalize: (value: string) => string) {
    const entry = entries[key]
    if (!entry || lock.current) return
    if (entry.baseline !== JSON.stringify(useSettingsStore.getState().settings[key])) {
      setEntries(current => ({ ...current, [key]: { ...entry, error: 'conflict' } }))
      dialog.toast({ title: t('settingsWorkspace.conflict'), tone: 'amber' }); return
    }
    lock.current = true
    setBusy(true)
    try {
      commit(normalize(entry.draft))
      // A retry may follow a committed-memory / failed-disk write.
      const baseline = JSON.stringify(useSettingsStore.getState().settings[key])
      setEntries(current => ({ ...current, [key]: { ...entry, baseline, error: undefined } }))
      await flushPersistedSettings()
      discard(key)
      dialog.toast({ title: t('settingsWorkspace.saved'), tone: 'mint' })
    } catch {
      setEntries(current => current[key] ? { ...current, [key]: { ...current[key], error: 'saveFailed' } } : current)
      dialog.toast({ title: t('settingsWorkspace.saveFailed'), tone: 'danger' })
    }
    finally { lock.current = false; setBusy(false) }
  }
  return { entries, busy, edit, save, discard }
}
export function SavedSettingsField({ session, settingKey, value, onCommit, normalize = value => value, inputProps, commitOnSubmit: _commitOnSubmit, ...props }: CommittedSettingsFieldProps & {
  session: ReturnType<typeof useSettingsFieldSession>; settingKey: keyof Settings
}) {
  const { t } = useTranslation()
  const { colors } = useAppTheme()
  const entry = session.entries[settingKey]
  return <View style={{ gap: 8 }}>
    <IsleField {...props} inputProps={{ ...inputProps, value: entry?.draft ?? value, editable: !session.busy, onChangeText: draft => session.edit(settingKey, draft, value) }} />
    {entry?.error ? <Text accessibilityRole="alert" style={{ fontSize: 14, lineHeight: 21, color: colors.ui.tone.danger.foreground }}>{t(`settingsWorkspace.${entry.error}`)}</Text> : null}
    {entry ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      <IsleButton label={t(session.busy ? 'settingsWorkspace.saving' : 'settingsWorkspace.save')} disabled={session.busy} onPress={() => void session.save(settingKey, onCommit, normalize)} />
      <IsleButton label={t('settingsWorkspace.reload')} disabled={session.busy} onPress={() => session.discard(settingKey)} />
    </View> : null}
  </View>
}
