import { usePreferenceUndo } from './usePreferenceUndo'
import { SettingsValueSlider } from './SettingsValueSlider'
import { SettingsSection, useSettingsTarget } from './SettingsSection'
import { IsleButton } from '@/components/ui/isle'
import { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native'
import { MotiView } from 'moti'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/ui/AppIcon'
import { IsleField, IslePressable, IsleToggle } from '@/components/ui/isle'
import { acceptNumericDraft, commitNumericDraft, type NumericDraftKind, type NumericDraftRange } from '@/components/ui/numericDraft'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { normalizeSettingsIdentityDisplayName, SETTINGS_IDENTITY_DISPLAY_NAME_MAX_LENGTH } from '@/modules/settings'
import {
  clampProviderPlatformOutputTokens,
  clampProviderPlatformTemperature,
  PROVIDER_PLATFORM_MAX_OUTPUT_TOKENS,
  PROVIDER_PLATFORM_MAX_TEMPERATURE,
  PROVIDER_PLATFORM_MIN_CONFIGURED_OUTPUT_TOKENS,
  PROVIDER_PLATFORM_MIN_TEMPERATURE,
} from '@/modules/providers'
import { useSettingsStore } from '@/store/settingsStore'
import {
  LiquidGlassPreferenceSettingsExperience,
  MaterialPreferenceSettingsExperience,
  MinimalPreferenceSettingsExperience,
  MonetPreferenceSettingsExperience,
} from '@/components/settings/theme-experiences/PreferenceSettingsExperiences'
export function PreferenceSettingsContent() {
  const { colors, canonicalThemeId } = useAppTheme()
  const { t } = useTranslation()
  const motion = useMotionPreference()
  const settings = useSettingsStore((state) => state.settings)
  const { updateSettings, undo, canUndo } = usePreferenceUndo()
  const { width, fontScale } = useWindowDimensions()
  const [workflowOpen, setWorkflowOpen] = useState(false)
  const target = useSettingsTarget()
  useEffect(() => { if (target === 'workflow') setWorkflowOpen(true) }, [target])
  const compact = width / fontScale < 430
  const fieldRowStyle = { flexDirection: compact ? 'column' : 'row', gap: 10, marginBottom: 8 } as const
  const fieldFlexStyle = compact ? undefined : { flex: 1, minWidth: 0 }
  const foldoutCardStyle = {
    marginTop: 8,
    borderRadius: Math.min(colors.ui.radius.card, 8),
    padding: compact ? 10 : 11,
    backgroundColor: colors.ui.liquidGlass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted,
    borderWidth: colors.ui.monet ? 1 : StyleSheet.hairlineWidth,
    borderColor: colors.ui.liquidGlass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border,
  } as const
  const workflowMaxSteps = settings.agentWorkflowMaxSteps ?? 3
  const workflowMaxToolCalls = settings.agentWorkflowMaxToolCallsPerStep ?? 1
  const workflowOutputLimit = settings.agentWorkflowOutputCharLimit ?? 4800
  const capabilityTileWidth: ViewStyle['flexBasis'] = canonicalThemeId === 'material' ? '100%' : compact ? '48%' : canonicalThemeId === 'minimal' ? '48%' : '24%'
  const identitySection = (
      <View testID="preference-section-identity">
        <PreferenceSectionHeading icon="bot" title={t('preferences.identity')} detail={settings.assistantDisplayName ?? t('preferences.identityDefault')} />
        <View style={{ marginTop: 10 }}>
          <PreferenceIdentityField
            label={t('preferences.assistantDisplayName')}
            placeholder={t('preferences.assistantDisplayNamePlaceholder')}
            value={settings.assistantDisplayName}
            onCommit={(assistantDisplayName) => updateSettings({ assistantDisplayName })}
          />
        </View>
      </View>
  )
  const generationSection = (
      <View testID="preference-section-generation">
        <PreferenceSectionHeading icon="settings-sliders" title={t('preferences.generation')} detail={t('preferences.generationSubtitle')} />
        <View style={[fieldRowStyle, { marginTop: 10, marginBottom: 0 }]}>
          <SettingsSection id="generation-temperature"><PreferenceNumericField
            label={t('chat.temperature')}
            style={fieldFlexStyle}
            value={settings.defaultTemperature}
            onReset={() => updateSettings({ defaultTemperature: undefined })}
            range={{ min: PROVIDER_PLATFORM_MIN_TEMPERATURE, max: PROVIDER_PLATFORM_MAX_TEMPERATURE }}
            kind="decimal"
            placeholder={t('preferences.followModel')}
            normalize={clampProviderPlatformTemperature}
            onCommit={(value) => updateSettings({ defaultTemperature: value })}
          /></SettingsSection>
          <SettingsSection id="generation-tokens"><PreferenceNumericField
            label={t('chat.maxTokens')}
            style={fieldFlexStyle}
            value={settings.defaultMaxTokens}
            onReset={() => updateSettings({ defaultMaxTokens: undefined })}
            range={{ min: PROVIDER_PLATFORM_MIN_CONFIGURED_OUTPUT_TOKENS, max: PROVIDER_PLATFORM_MAX_OUTPUT_TOKENS }}
            kind="integer"
            placeholder={t('preferences.followModel')}
            normalize={clampProviderPlatformOutputTokens}
            onCommit={(value) => updateSettings({ defaultMaxTokens: value })}
          /></SettingsSection>
        </View>
      </View>
  )
  const interactionSection = (
      <View testID="preference-section-interaction">
        <PreferenceSectionHeading icon="command" title={t('preferences.interaction')} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          <PreferenceCapabilityTile
            icon={settings.hapticsEnabled ? 'sun' : 'moon'}
            title={t('settings.haptics')}
            active={settings.hapticsEnabled}
            width={capabilityTileWidth}
            onPress={() => updateSettings({ hapticsEnabled: !settings.hapticsEnabled })}
          />
          <PreferenceCapabilityTile
            icon="command"
            title={t('preferences.commandPalette')}
            active={settings.commandPaletteEnabled ?? true}
            width={capabilityTileWidth}
            onPress={() => updateSettings({ commandPaletteEnabled: !(settings.commandPaletteEnabled ?? true) })}
          />


        </View>
      </View>
  )
  const workflowSection = (
      <View testID="preference-section-workflow">
      <IslePressable
        haptic
        accessibilityRole="button"
        accessibilityLabel={`${t('preferences.agentWorkflow')}. ${t('preferences.agentWorkflowCollapsedDetail', { steps: workflowMaxSteps, tools: workflowMaxToolCalls, limit: workflowOutputLimit })}`}
        accessibilityState={{ expanded: workflowOpen }}
        onPress={() => setWorkflowOpen((value) => !value)}
        style={{
          minHeight: canonicalThemeId === 'material' ? 46 : 54,
          borderRadius: canonicalThemeId === 'material' ? 4 : Math.min(colors.ui.radius.controlLarge, 8),
          paddingHorizontal: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          backgroundColor: canonicalThemeId === 'minimal' ? 'transparent' : colors.ui.semantic.surface.muted,
          borderWidth: canonicalThemeId === 'minimal' ? 0 : canonicalThemeId === 'monet' ? 1 : StyleSheet.hairlineWidth,
          borderBottomWidth: canonicalThemeId === 'minimal' ? StyleSheet.hairlineWidth : undefined,
          borderColor: colors.ui.monet ? colors.material.stroke : colors.ui.semantic.chrome.border,
        }}
      >
        <AppIcon name="workflow" color={colors.textTertiary} size={16} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: '800' }}>{t('preferences.agentWorkflow')}</Text>
          <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, marginTop: 1 }}>{t('preferences.agentWorkflowCollapsedDetail', { steps: workflowMaxSteps, tools: workflowMaxToolCalls, limit: workflowOutputLimit })}</Text>
        </View>
        <MotiView animate={{ rotate: workflowOpen && motion === 'full' ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: motion === 'full' ? 160 : 0 }}>
          <AppIcon name="collapse" color={colors.textTertiary} size={16} />
        </MotiView>
      </IslePressable>
      {workflowOpen ? (
        <MotiView from={target || motion !== 'full' ? undefined : { opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: motion === 'full' ? 144 : 0 }} style={[foldoutCardStyle, canonicalThemeId === 'material' ? { borderRadius: 4, borderLeftWidth: 3, borderLeftColor: colors.ui.section.divider } : canonicalThemeId === 'liquid-glass' ? { borderRadius: colors.ui.radius.panel, borderWidth: 1, borderColor: colors.ui.semantic.chrome.border } : null]}>
          <PreferenceFoldoutHeader title={t('preferences.agentWorkflow')} description={t('preferences.agentWorkflowSubtitle')} />
          <View style={fieldRowStyle}>
            <PreferenceNumericField
              label={t('preferences.agentWorkflowMaxSteps')}
              note={t('preferences.agentWorkflowMaxStepsNote')}
              style={fieldFlexStyle}
              value={settings.agentWorkflowMaxSteps ?? 3}
              range={{ min: 1, max: 8 }}
              kind="integer"
              onCommit={(value) => updateSettings({ agentWorkflowMaxSteps: value })}
            />
            <PreferenceNumericField
              label={t('preferences.agentWorkflowMaxToolCalls')}
              note={t('preferences.agentWorkflowMaxToolCallsNote')}
              style={fieldFlexStyle}
              value={settings.agentWorkflowMaxToolCallsPerStep ?? 1}
              range={{ min: 1, max: 3 }}
              kind="integer"
              onCommit={(value) => updateSettings({ agentWorkflowMaxToolCallsPerStep: value })}
            />
          </View>
          <PreferenceNumericField
            label={t('preferences.agentWorkflowOutputLimit')}
            note={t('preferences.agentWorkflowOutputLimitNote')}
            value={settings.agentWorkflowOutputCharLimit ?? 4800}
            range={{ min: 512, max: 12000 }}
            kind="integer"
            onCommit={(value) => updateSettings({ agentWorkflowOutputCharLimit: value })}
          />
          <View style={{ gap: 8, marginTop: 10 }}>
            <IsleToggle
              icon={<AppIcon name="shield" color={colors.text} size={18} />}
              title={t('preferences.agentWorkflowReadOnlyTools')}
              description={t('preferences.agentWorkflowReadOnlyToolsDescription')}
              active={settings.agentWorkflowAllowReadOnlyTools ?? true}
              onPress={() => updateSettings({ agentWorkflowAllowReadOnlyTools: !(settings.agentWorkflowAllowReadOnlyTools ?? true) })}
            />
            <IsleToggle
              icon={<AppIcon name="shield" color={colors.text} size={18} />}
              title={t('preferences.agentWorkflowVisibleWrites')}
              description={t('preferences.agentWorkflowVisibleWritesDescription')}
              active={(settings.agentWorkflowAllowReadWriteTools ?? 'visible') !== false}
              onPress={() => updateSettings({ agentWorkflowAllowReadWriteTools: (settings.agentWorkflowAllowReadWriteTools ?? 'visible') === false ? 'visible' : false })}
            />
            <IsleToggle
              icon={<AppIcon name="shield" color={colors.text} size={18} />}
              title={t('preferences.agentWorkflowDestructiveConfirm')}
              description={t('preferences.agentWorkflowDestructiveConfirmDescription')}
              active={(settings.agentWorkflowAllowDestructiveTools ?? 'confirm') === 'confirm'}
              onPress={() => updateSettings({ agentWorkflowAllowDestructiveTools: (settings.agentWorkflowAllowDestructiveTools ?? 'confirm') === 'confirm' ? false : 'confirm' })}
            />
          </View>
        </MotiView>
      ) : null}
      </View>
  )
  const Experience = canonicalThemeId === 'monet'
    ? MonetPreferenceSettingsExperience
    : canonicalThemeId === 'material'
      ? MaterialPreferenceSettingsExperience
      : canonicalThemeId === 'liquid-glass'
        ? LiquidGlassPreferenceSettingsExperience
        : MinimalPreferenceSettingsExperience
  return (
    <>
    {canUndo ? <IsleButton label={t('settingsWorkspace.undo')} onPress={undo} /> : null}
    <Experience
      identity={<SettingsSection id="identity">{identitySection}</SettingsSection>}
      generation={<SettingsSection id="generation">{generationSection}</SettingsSection>}
      interaction={<SettingsSection id="interaction">{interactionSection}</SettingsSection>}
      workflow={<SettingsSection id="workflow">{workflowSection}</SettingsSection>}
      labels={{
        identity: t('preferences.identity'),
        generation: t('preferences.generation'),
        interaction: t('preferences.interaction'),
        workflow: t('preferences.agentWorkflow'),
      }}
      compact={compact}
    />
    </>
  )
}

function PreferenceSectionHeading({
  icon,
  title,
  detail,
}: {
  icon: Parameters<typeof AppIcon>[0]['name']
  title: string
  detail?: string
}) {
  const { colors, canonicalThemeId } = useAppTheme()
  if (canonicalThemeId === 'minimal') {
    return (
      <View style={{ paddingBottom: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.semantic.chrome.border }}>
        <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '800' }}>{title}</Text>
        {detail ? <Text style={{ marginTop: 2, color: colors.textTertiary, fontSize: 14, lineHeight: 20, fontWeight: '500' }}>{detail}</Text> : null}
      </View>
    )
  }
  if (canonicalThemeId === 'material') {
    return (
      <View style={{ gap: 2 }}>
        <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '800' }}>{title}</Text>
        {detail ? <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, fontWeight: '500' }}>{detail}</Text> : null}
      </View>
    )
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
      <View style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 7, backgroundColor: colors.ui.semantic.surface.muted }}>
        <AppIcon name={icon} color={colors.textSecondary} size={16} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '800', includeFontPadding: false }}>{title}</Text>
        {detail ? <Text style={{ marginTop: 1, color: colors.textTertiary, fontSize: 14, lineHeight: 20, fontWeight: '600', includeFontPadding: false }}>{detail}</Text> : null}
      </View>
    </View>
  )
}

function PreferenceCapabilityTile({
  icon,
  title,
  active,
  width,
  onPress,
}: {
  icon: Parameters<typeof AppIcon>[0]['name']
  title: string
  active: boolean
  width: ViewStyle['flexBasis']
  onPress: () => void
}) {
  const { colors, canonicalThemeId } = useAppTheme()
  const { t } = useTranslation()
  if (canonicalThemeId === 'minimal') {
    return (
      <IslePressable
        haptic
        accessibilityRole="switch"
        accessibilityLabel={title}
        accessibilityState={{ checked: active }}
        onPress={onPress}
        style={{ flexGrow: 1, flexBasis: width, minWidth: 0, minHeight: 52, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.semantic.chrome.border }}
      >
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: active ? colors.ui.tone.success.foreground : colors.ui.semantic.chrome.border }} />
        <Text style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '700' }}>{title}</Text>
        <Text style={{ color: active ? colors.ui.tone.success.foreground : colors.textTertiary, fontSize: 14, lineHeight: 20, fontWeight: '800' }}>{active ? t('settings.enabled') : t('settings.disabled')}</Text>
      </IslePressable>
    )
  }
  if (canonicalThemeId === 'material') {
    return (
      <IslePressable
        haptic
        accessibilityRole="switch"
        accessibilityLabel={title}
        accessibilityState={{ checked: active }}
        onPress={onPress}
        style={{ minHeight: 46, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.ui.semantic.surface.muted, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.section.divider }}
      >
        <AppIcon name={icon} color={active ? colors.ui.tone.success.foreground : colors.textTertiary} size={15} />
        <Text style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '700' }}>{title}</Text>
        <Text style={{ color: active ? colors.ui.tone.success.foreground : colors.textTertiary, fontSize: 14, lineHeight: 20, fontWeight: '700' }}>{active ? t('settings.enabled') : t('settings.disabled')}</Text>
      </IslePressable>
    )
  }
  return (
    <IslePressable
      haptic
      accessibilityRole="switch"
      accessibilityLabel={title}
      accessibilityState={{ checked: active }}
      onPress={onPress}
      style={{
        flexGrow: 1,
        flexBasis: width,
        minWidth: 0,
        minHeight: 74,
        paddingHorizontal: 11,
        paddingVertical: 10,
        borderRadius: Math.min(colors.ui.radius.controlLarge, 8),
        backgroundColor: active ? colors.ui.control.primaryBackground : colors.ui.semantic.surface.muted,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: active ? colors.ui.control.primaryBorder : colors.ui.semantic.chrome.border,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <AppIcon name={icon} color={active ? colors.ui.control.primaryForeground : colors.textTertiary} size={17} />
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: active ? colors.ui.control.primaryForeground : colors.ui.semantic.chrome.border }} />
      </View>
      <Text style={{ marginTop: 9, color: active ? colors.ui.control.primaryForeground : colors.text, fontSize: 14, lineHeight: 20, fontWeight: '800', includeFontPadding: false }}>{title}</Text>
      <Text style={{ marginTop: 2, color: active ? colors.ui.control.primaryForeground : colors.textTertiary, fontSize: 14, lineHeight: 20, fontWeight: '700', includeFontPadding: false }}>
        {active ? t('settings.enabled') : t('settings.disabled')}
      </Text>
    </IslePressable>
  )
}

function PreferenceIdentityField({
  label,
  placeholder,
  value,
  onCommit,
}: {
  label: string
  placeholder: string
  value: string | undefined
  onCommit: (value: string | undefined) => void
}) {
  const externalDraft = value ?? ''
  const [draft, setDraft] = useState(externalDraft)
  const commitPending = useRef(false)

  useEffect(() => {
    setDraft(externalDraft)
    commitPending.current = false
  }, [externalDraft])

  function commit() {
    if (!commitPending.current) return
    commitPending.current = false
    const normalized = normalizeSettingsIdentityDisplayName(draft)
    setDraft(normalized ?? '')
    onCommit(normalized)
  }

  return (
    <IsleField
      label={label}
      inputProps={{
        value: draft,
        onChangeText: (next) => {
          commitPending.current = true
          setDraft(next)
        },
        onBlur: commit,
        onSubmitEditing: commit,
        maxLength: SETTINGS_IDENTITY_DISPLAY_NAME_MAX_LENGTH * 2,
        placeholder,
        autoCorrect: false,
      }}
    />
  )
}

function PreferenceNumericField({ label, value, range, kind, placeholder, normalize, onCommit, onReset, style }: {
  label: string; note?: string; value: number | undefined; range: NumericDraftRange; kind: NumericDraftKind; placeholder?: string;
  normalize?: (value: number) => number; onCommit: (value: number) => void; onReset?: () => void; style?: StyleProp<ViewStyle>
}) {
  const { t } = useTranslation()
  const { colors } = useAppTheme()
  const externalDraft = typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
  const [draft, setDraft] = useState(externalDraft)
  const [custom, setCustom] = useState(!onReset || value !== undefined)
  const commitPending = useRef(false)
  useEffect(() => {
    if (!commitPending.current) { setDraft(externalDraft); setCustom(!onReset || value !== undefined) }
  }, [externalDraft, value])
  function commit() {
    if (!commitPending.current) return
    commitPending.current = false
    const parsed = commitNumericDraft(draft, range, kind)
    if (parsed === undefined) { setDraft(externalDraft); return }
    const next = normalize ? normalize(parsed) : parsed
    setDraft(String(next))
    onCommit(next)
  }
  function step(direction: number) {
    const amount = kind === 'decimal' ? 0.1 : range.max > 1000 ? 256 : 1
    const next = commitNumericDraft(String(Math.max(range.min, Math.min(range.max, Math.round(((Number(draft) || value || range.min) + direction * amount) * 10) / 10))), range, kind)
    if (next === undefined) return
    commitPending.current = false
    setDraft(String(next))
    onCommit(normalize ? normalize(next) : next)
  }
  return <View style={[style, { gap: 8 }]}>
    {onReset ? <>
      <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>{label}</Text>
      <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {[false, true].map(option => <IslePressable key={String(option)} accessibilityRole="radio" accessibilityState={{ checked: custom === option }} onPress={() => {
          setCustom(option)
          if (!option) { commitPending.current = false; setDraft(''); onReset() }
        }} style={{ minHeight: 44, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.ui.semantic.chrome.border, backgroundColor: custom === option ? colors.ui.control.primaryBackground : colors.ui.semantic.surface.muted }}>
          <Text style={{ fontSize: 14, color: custom === option ? colors.ui.control.primaryForeground : colors.text }}>{t(option ? 'settingsWorkspace.customValue' : 'settingsWorkspace.modelDefault')}</Text>
        </IslePressable>)}
      </View>
    </> : null}
    {custom ? <>
      {onReset && value === undefined ? <Text style={{ fontSize: 14, color: colors.textSecondary }}>{t('settingsWorkspace.chooseValue')}</Text> : null}
      {onReset ? <SettingsValueSlider label={label} value={value ?? range.min} min={range.min} max={range.max} step={kind === 'decimal' ? 0.1 : 1} logarithmic={kind === 'integer' && range.min > 0} onCommit={next => {
        commitPending.current = false
        setDraft(String(next))
        onCommit(normalize ? normalize(next) : next)
      }} /> : null}
      <IsleField label={onReset ? '' : label} inputProps={{ accessibilityLabel: label, value: draft, onChangeText: next => {
        const accepted = acceptNumericDraft(draft, next, kind)
        if (accepted !== draft) { commitPending.current = true; setDraft(accepted) }
      }, onBlur: commit, onSubmitEditing: commit, keyboardType: kind === 'integer' ? 'number-pad' : 'decimal-pad', placeholder: onReset ? t('settingsWorkspace.chooseValue') : placeholder }} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <IsleButton label="−" accessibilityLabel={label + ' −'} onPress={() => step(-1)} />
        <IsleButton label="+" accessibilityLabel={label + ' +'} onPress={() => step(1)}/>
      </View>
    </> : null}
  </View>
}

function PreferenceFoldoutHeader({ title, description }: { title: string; description?: string }) {
  const { colors } = useAppTheme()
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '800', includeFontPadding: false }}>
        {title}
      </Text>
      {description ? (
        <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, marginTop: 2, fontWeight: '700', includeFontPadding: false }}>
          {description}
        </Text>
      ) : null}
    </View>
  )
}
