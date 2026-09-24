import { RadioGroup } from 'animal-island-ui-rn'
import { useEffect, useId, useMemo, useState, type RefObject } from 'react'
import { Text, View, useWindowDimensions, type GestureResponderEvent } from 'react-native'
import { MotiView } from 'moti'
import { useTranslation } from 'react-i18next'
import { IsleButton } from '@/components/ui/isle'
import { IsleInput } from '@/components/ui/isle/IsleKit'
import { IslePressable } from '@/components/ui/isle/Pressable'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { getColors, normalizeThemeAccent } from '@/theme/colors'
import { resolveThemeComponentExpression, resolveThemeExpression } from '@/theme/themeExpression'
import { ThemeRadioMark } from './ThemeRadioMark'

const THEME_ACCENT_OPTIONS = [
  { id: 'default', color: undefined, labelKey: 'settings.themeAccentDefault' },
  { id: 'teal', color: '#0F766E', labelKey: 'settings.themeAccentTeal' },
  { id: 'indigo', color: '#4F46A5', labelKey: 'settings.themeAccentIndigo' },
  { id: 'coral', color: '#B94B3F', labelKey: 'settings.themeAccentCoral' },
  { id: 'amber', color: '#A96A12', labelKey: 'settings.themeAccentAmber' },
] as const

/** Page-session draft only: closing the foldout must not discard unfinished work. */
export interface ThemeAccentDraft {
  text?: string
  customAccent?: string
}

export function SettingsThemeAccentControl({ value, draftRef, onChange }: {
  value?: string
  draftRef: RefObject<ThemeAccentDraft>
  onChange: (accent: string | undefined, event?: GestureResponderEvent) => void
}) {
  const { t } = useTranslation()
  const { colors, canonicalThemeId, mode } = useAppTheme()
  const { width } = useWindowDimensions()
  const compact = width < 430
  const hintId = useId()
  const activeCustomThemeAccent = Boolean(value && !THEME_ACCENT_OPTIONS.some((item) => item.color === value))
  const customValue = activeCustomThemeAccent ? value : undefined
  const [draft, setDraft] = useState(() => draftRef.current.text ?? customValue ?? '')
  const [savedCustom, setSavedCustom] = useState(() => customValue ?? draftRef.current.customAccent)
  const [validated, setValidated] = useState(false)

  useEffect(() => {
    if (customValue) {
      setSavedCustom(customValue)
      draftRef.current.customAccent = customValue
    }
    // Follow external changes only until the user starts editing. Presets and
    // theme switches must never overwrite a manually entered draft.
    if (draftRef.current.text === undefined) setDraft(customValue ?? '')
  }, [customValue, draftRef])

  const normalized = normalizeThemeAccent(draft)
  const applied = Boolean(normalized && normalized === value)
  const invalid = validated && !normalized
  const preview = useMemo(() => getColors(mode, canonicalThemeId, undefined, normalized ?? value), [mode, canonicalThemeId, normalized, value])
  const setText = (text: string) => {
    draftRef.current.text = text
    setDraft(text)
  }
  const apply = () => {
    setValidated(true)
    if (!normalized || applied) return
    setText(normalized)
    onChange(normalized)
  }
  const hint = invalid
    ? t('settings.themeAccentInvalid')
    : applied
      ? t('settings.themeAccentAppliedHint')
      : normalized
        ? t('settings.themeAccentPreviewHint')
        : t('settings.themeAccentCustomHint')

  return (
    <View style={{ gap: 12 }}>
      <RadioGroup testID="settings-theme-accent-group" accessibilityLabel={t('settings.themeAccent')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {THEME_ACCENT_OPTIONS.map((item) => (
          <ThemeAccentSwatch
            key={item.id}
            label={t(item.labelKey)}
            color={item.color}
            active={value === item.color}
            compact={width < 600}
            onPress={(event) => { if (value !== item.color) onChange(item.color, event) }}
            testID={`settings-theme-accent-${item.id}`}
          />
        ))}
        <ThemeAccentSwatch
          label={t('settings.themeAccentCustom')}
          color={customValue ?? savedCustom}
          active={activeCustomThemeAccent}
          compact={width < 600}
          disabled={!customValue && !savedCustom}
          onPress={(event) => {
            // The radio restores exactly the color it shows, never a hidden draft.
            const accent = customValue ?? savedCustom
            if (accent && accent !== value) onChange(accent, event)
          }}
          testID="settings-theme-accent-custom"
        />
      </RadioGroup>
      <View testID="settings-theme-accent-editor" style={{ gap: 8 }}>
        <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 18, fontWeight: '800' }}>{t('settings.themeAccentCustom')}</Text>
        <View style={{ flexDirection: compact ? 'column' : 'row', gap: 8, alignItems: 'stretch' }}>
          <IsleInput
            value={draft}
            onChangeText={setText}
            onFocus={() => setValidated(false)}
            onBlur={() => setValidated(Boolean(draft.trim()))}
            onSubmitEditing={apply}
            submitBehavior="submit"
            // RN Web 0.21 still reads the legacy prop; Enter must not blur there.
            blurOnSubmit={false}
            returnKeyType="done"
            autoCapitalize="characters"
            autoCorrect={false}
            spellCheck={false}
            placeholder="#4963A6"
            accessibilityLabel={t('settings.themeAccentCustom')}
            accessibilityHint={hint}
            aria-describedby={hintId}
            status={invalid ? 'error' : undefined}
            // Reserve room for the themed status border without shrinking the hit target.
            wrapperStyle={[{ minHeight: 48, justifyContent: 'center' }, compact ? undefined : { flex: 1, minWidth: 0 }]}
            prefix={<View aria-hidden pointerEvents="none" style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 1, borderColor: colors.ui.semantic.chrome.border, backgroundColor: normalized ?? colors.ui.semantic.surface.muted }} />}
            testID="settings-theme-accent-input"
          />
          <IsleButton
            label={t(applied ? 'settings.themeAccentApplied' : 'settings.themeAccentApply')}
            tone={applied ? 'soft' : 'primary'}
            disabled={!normalized || applied}
            testID="settings-theme-accent-apply"
            onPress={apply}
            style={{ minHeight: 48, minWidth: compact ? undefined : 120, alignSelf: 'stretch' }}
          />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 54 }}>
          <View aria-hidden pointerEvents="none" testID="settings-theme-accent-preview" style={{ width: 52, height: 40, borderRadius: colors.ui.radius.controlSmall, alignItems: 'center', justifyContent: 'center', backgroundColor: preview.ui.control.primaryBackground }}>
            <Text style={{ color: preview.ui.control.primaryForeground, fontSize: 16, fontWeight: '700' }}>Aa</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, fontWeight: '700' }}>
              {t(normalized ? 'settings.themeAccentPreview' : 'settings.themeAccentCurrent')}{normalized ? ` · ${normalized}` : ''}
            </Text>
            <Text nativeID={hintId} testID="settings-theme-accent-hint" accessibilityLiveRegion="polite" style={{ color: invalid ? colors.ui.tone.danger.foreground : colors.textTertiary, fontSize: 11, lineHeight: 16, minHeight: 32 }}>{hint}</Text>
          </View>
        </View>
      </View>
    </View>
  )
}

function ThemeAccentSwatch({
  label,
  color,
  active,
  compact,
  disabled = false,
  onPress,
  testID,
}: {
  label: string
  color?: string
  active: boolean
  compact: boolean
  disabled?: boolean
  onPress: (event: GestureResponderEvent) => void
  testID: string
}) {
  const { colors, canonicalThemeId, mode } = useAppTheme()
  const swatchColor = color ?? getColors(mode, canonicalThemeId).ui.control.primaryBackground
  const motion = useMotionPreference()
  const radioExpression = resolveThemeComponentExpression(canonicalThemeId, 'radio')
  const themeExpression = resolveThemeExpression(canonicalThemeId)
  const borderColor = active
    ? colors.ui.control.primaryBorder
    : radioExpression.surface === 'atmosphere'
      ? colors.ui.control.focus
      : radioExpression.surface === 'lens'
        ? colors.ui.actionBar.itemBorder
        : colors.ui.semantic.chrome.border
  const swatchRadius = radioExpression.shape === 'angular'
    ? 2
    : radioExpression.shape === 'soft'
      ? 14
      : radioExpression.shape === 'material'
        ? 12
        : 18
  const inactiveBackground = radioExpression.surface === 'boundary'
    ? 'transparent'
    : radioExpression.surface === 'lens'
      ? colors.ui.semantic.chrome.background
      : colors.ui.semantic.surface.muted
  return (
    <IslePressable
      haptic
      testID={testID}
      accessibilityRole="radio"
      accessibilityLabel={color ? `${label}, ${color}` : label}
      accessibilityState={{ checked: active }}
      aria-checked={active}
      disabled={disabled}
      onPress={onPress}
      style={{ minWidth: 76, minHeight: 64, flexGrow: 1, flexBasis: compact ? '28%' : '13%' }}
    >
      <MotiView
        animate={{ backgroundColor: active ? colors.ui.semantic.surface.raised : inactiveBackground, borderColor }}
        transition={{ type: 'timing', duration: motion === 'full' ? themeExpression.motion.duration.interaction : 1 }}
        style={{ minHeight: 64, borderRadius: swatchRadius, borderWidth: 2, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 6, overflow: 'hidden' }}
      >
        <View style={{ position: 'absolute', top: 4, right: 4 }}>
          <ThemeRadioMark active={active} disabled={disabled} size={15} />
        </View>
        <View aria-hidden testID={`${testID}-color`} style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: swatchColor, borderWidth: 2, borderColor: color ? 'rgba(255,255,255,0.7)' : colors.ui.semantic.chrome.border, overflow: 'hidden' }}>
          {color === undefined ? <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 12, backgroundColor: colors.ui.semantic.surface.base }} /> : null}
        </View>
        <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 10, lineHeight: 13, fontWeight: '600' }}>{label}</Text>
      </MotiView>
    </IslePressable>
  )
}
