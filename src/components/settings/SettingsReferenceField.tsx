import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Text } from '@/components/ui/AppText'
import { IsleButton, IsleInput, IslePressable, IsleSelect } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'

export interface SettingsReferenceOption { value: string; label: string }

/** Selecting a reference changes the draft only; it never enables or authorizes a resource. */
export function SettingsReferenceField({ label, value, options, onChange, disabled = false, multiple = true, catalogReady = true }: {
  label: string; value: string; options: SettingsReferenceOption[]; onChange: (value: string) => void
  disabled?: boolean; multiple?: boolean; catalogReady?: boolean
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [manual, setManual] = useState(false)
  const selected = multiple ? [...new Set(value.split(/[,，\n]/).map(id => id.trim()).filter(Boolean))] : value.trim() ? [value.trim()] : []
  const unique = [...new Map(options.map(option => [option.value, option])).values()]
  const candidates = unique.filter(option => !selected.includes(option.value) && `${option.label} ${option.value}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const snapshot = JSON.stringify([label, value, multiple, disabled, catalogReady, query, unique])
  const current = useRef({ snapshot, onChange })
  if (current.current.snapshot !== snapshot) current.current = { snapshot, onChange }
  else current.current.onChange = onChange
  const reviewed = current.current
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  function change(next: string) {
    if (!mounted.current || disabled || current.current !== reviewed) return false
    current.current.onChange(next)
    return true
  }
  return <View style={{ gap: 8 }}>
    <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '700' }}>{label}</Text>
    {selected.map(id => {
      const option = unique.find(item => item.value === id)
      const name = option?.label ?? (catalogReady ? `${id} · ${t('agents.unresolved')}` : id)
      return <View key={id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text selectable style={{ flex: 1, minWidth: 0, color: option || !catalogReady ? colors.textSecondary : colors.ui.tone.warning.foreground, fontSize: 14, lineHeight: 20 }}>{name}</Text>
        <IsleButton compact label={t('settingsReferences.remove')} accessibilityLabel={`${t('settingsReferences.remove')} ${name}`} disabled={disabled}
          onPress={() => change(selected.filter(item => item !== id).join('\n'))} />
      </View>
    })}
    {unique.length > 8 ? <IsleInput accessibilityLabel={`${t('common.search')} ${label}`} placeholder={t('common.search')} value={query} onChangeText={setQuery} editable={!disabled} /> : null}
    <IsleSelect placeholder={t('settingsReferences.choose', { label })} disabled={disabled || !catalogReady || !candidates.length} options={candidates}
      onChange={id => { if (catalogReady && candidates.some(option => option.value === id) && change(multiple ? [...selected, id].join('\n') : id)) setQuery('') }} />
    {catalogReady && !unique.length ? <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20 }}>{t('settingsReferences.empty')}</Text> : null}
    <IslePressable accessibilityRole="button" accessibilityLabel={`${t('settingsReferences.manual')} ${label}`} accessibilityState={{ expanded: manual, disabled }} disabled={disabled}
      onPress={() => setManual(open => !open)} style={{ minHeight: 44, justifyContent: 'center' }}>
      <Text style={{ color: colors.textSecondary, fontSize: 14 }}>{t('settingsReferences.manual')} {manual ? '−' : '+'}</Text>
    </IslePressable>
    {manual ? <IsleInput accessibilityLabel={label} value={value} onChangeText={change} editable={!disabled} multiline={multiple} autoCapitalize="none" autoCorrect={false} /> : null}
  </View>
}
