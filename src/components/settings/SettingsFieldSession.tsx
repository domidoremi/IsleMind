import { useRef, useState } from 'react'
import { View } from 'react-native'
import { Text } from '@/components/ui/AppText'
import { useTranslation } from 'react-i18next'
import { IsleButton, IsleField } from '@/components/ui/isle'
import { useSettingsStore } from '@/store/settingsStore'
import type { Settings } from '@/types/settingsContracts'
import { flushPersistedSettings } from '@/presentation/features/settings/settingsStorePersistenceCommand'
import type { CommittedSettingsFieldProps } from './CommittedSettingsField'
import { useSettingsDraft, useSettingsLifetime } from './SettingsEditBoundary'
import { useAppTheme } from '@/hooks/useAppTheme'
import { SettingsReferenceField, type SettingsReferenceOption } from './SettingsReferenceField'
import { FeedbackGlyph } from '@/components/ui/FeedbackGlyph'
import { AppIcon } from '@/components/ui/AppIcon'

type Entry = { draft: string; baseline: string | undefined; error?: 'conflict' | 'saveFailed' }
/** Owned by the page, not its conditionally mounted advanced fields. */
export function useSettingsFieldSession() {
  const [entries, setEntries] = useState<Partial<Record<keyof Settings, Entry>>>({})
  const [busy, setBusy] = useState(false)
  const [savingKey, setSavingKey] = useState<keyof Settings | null>(null)
  const [receipts, setReceipts] = useState<Partial<Record<keyof Settings, { baseline: string | undefined }>>>({})
  const lock = useRef(false)
  const lifetime = useSettingsLifetime()
  const latestEntries = useRef(entries)
  latestEntries.current = entries
  useSettingsDraft(Object.keys(entries).length > 0, busy, () => setEntries({}), JSON.stringify(entries))
  function discard(key: keyof Settings) {
    if (lock.current || lifetime.current?.signal.aborted) return
    setEntries(current => { const next = { ...current }; delete next[key]; return next })
  }
  function edit(key: keyof Settings, draft: string, saved: string) {
    if (lock.current || lifetime.current?.signal.aborted) return
    setReceipts(current => { const next = { ...current }; delete next[key]; return next })
    if (draft === saved) { discard(key); return }
    const baseline = JSON.stringify(useSettingsStore.getState().settings[key])
    setEntries(current => ({ ...current, [key]: { draft, baseline: current[key] ? current[key].baseline : baseline } }))
  }
  async function save(key: keyof Settings, commit: (value: string) => void, normalize: (value: string) => string) {
    const signal = lifetime.current?.signal
    const entry = latestEntries.current[key]
    if (!entry || lock.current || signal?.aborted) return
    if (entry.baseline !== JSON.stringify(useSettingsStore.getState().settings[key])) {
      setEntries(current => ({ ...current, [key]: { ...entry, error: 'conflict' } }))
      return
    }
    lock.current = true
    setBusy(true)
    setSavingKey(key)
    try {
      commit(normalize(entry.draft))
      // A retry may follow a committed-memory / failed-disk write.
      const baseline = JSON.stringify(useSettingsStore.getState().settings[key])
      setEntries(current => ({ ...current, [key]: { ...entry, baseline, error: undefined } }))
      await flushPersistedSettings()
      if (signal?.aborted) return
      if (baseline !== JSON.stringify(useSettingsStore.getState().settings[key])) {
        setEntries(current => current[key] ? { ...current, [key]: { ...current[key], error: 'conflict' } } : current)
        return
      }
      setEntries(current => { const next = { ...current }; delete next[key]; return next })
      setReceipts(current => ({ ...current, [key]: { baseline } }))
    } catch {
      if (signal?.aborted) return
      setEntries(current => current[key] ? { ...current, [key]: { ...current[key], error: 'saveFailed' } } : current)
    }
    finally { lock.current = false; if (!signal?.aborted) { setBusy(false); setSavingKey(null) } }
  }
  return { entries, receipts, busy, savingKey, edit, save, discard }
}
export function SavedSettingsField({ session, settingKey, value, onCommit, normalize = value => value, inputProps, referenceOptions, commitOnSubmit: _commitOnSubmit, ...props }: CommittedSettingsFieldProps & {
  session: ReturnType<typeof useSettingsFieldSession>; settingKey: keyof Settings; referenceOptions?: SettingsReferenceOption[]
}) {
  const { t } = useTranslation()
  const { colors } = useAppTheme()
  const entry = session.entries[settingKey]
  return <View style={{ gap: 8 }}>
    {referenceOptions ? <View style={props.style}>
      <SettingsReferenceField label={props.label} labelAccessory={<SettingsFieldReceipt session={session} settingKey={settingKey} />} value={entry?.draft ?? value} options={referenceOptions}
        disabled={session.busy} onChange={draft => session.edit(settingKey, draft, value)} />
      {props.note ? <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 21, marginTop: 6 }}>{props.note}</Text> : null}
    </View> : <IsleField {...props} labelAccessory={<SettingsFieldReceipt session={session} settingKey={settingKey} />} inputProps={{ ...inputProps, value: entry?.draft ?? value, editable: !session.busy, onChangeText: draft => session.edit(settingKey, draft, value) }} />}
    {entry?.error ? <Text accessibilityRole="alert" style={{ fontSize: 14, lineHeight: 21, color: colors.ui.tone.danger.foreground }}>{t(`settingsWorkspace.${entry.error}`)}</Text> : null}
    {entry ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      <IsleButton label={t('settingsWorkspace.save')} feedbackPhase={session.savingKey === settingKey ? 'pending' : 'idle'}
        icon={<AppIcon name="check" size={16} color={colors.text} />} busy={session.savingKey === settingKey}
        disabled={session.busy} onPress={() => void session.save(settingKey, onCommit, normalize)} />
      <IsleButton label={t('settingsWorkspace.reload')} disabled={session.busy} onPress={() => session.discard(settingKey)} />
    </View> : null}
  </View>
}

export function SettingsFieldReceipt({ session, settingKey }: {
  session: ReturnType<typeof useSettingsFieldSession>
  settingKey: keyof Settings
}) {
  const { t } = useTranslation()
  const receipt = session.receipts[settingKey]
  const saved = Boolean(receipt && !session.entries[settingKey] && receipt.baseline === JSON.stringify(useSettingsStore.getState().settings[settingKey]))
  const pending = session.savingKey === settingKey
  return <FeedbackGlyph phase={pending ? 'pending' : saved ? 'success' : 'idle'}
    label={pending ? t('settingsWorkspace.saving') : saved ? t('settingsWorkspace.saved') : undefined}
    testID={`settings-field-${settingKey}-status`} />
}
