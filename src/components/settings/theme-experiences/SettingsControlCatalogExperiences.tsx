import { StyleSheet, Text, View } from 'react-native'
import { AppIcon, type AppIconName } from '@/components/ui/AppIcon'
import { IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { MotiView } from 'moti'
import { useTranslation } from 'react-i18next'

export type SettingsControlView = 'ai' | 'system'

export interface SettingsControlExperienceEntry {
  key: string
  title: string
  detail: string
  icon: AppIconName
  active?: boolean
  tone?: 'default' | 'warning' | 'danger'
  onPress: () => void
}

export function SettingsControlNavigation({
  value,
  onChange,
}: {
  value: SettingsControlView | null
  onChange: (value: SettingsControlView) => void
}) {
  const { canonicalThemeId } = useAppTheme()
  switch (canonicalThemeId) {
    case 'monet': return <MonetControlNavigation value={value} onChange={onChange} />
    case 'material': return <MaterialControlNavigation value={value} onChange={onChange} />
    case 'liquid-glass': return <LiquidGlassControlNavigation value={value} onChange={onChange} />
    case 'minimal':
    default: return <MinimalControlNavigation value={value} onChange={onChange} />
  }
}

export function SettingsControlCatalog({
  entries,
  compact,
}: {
  entries: SettingsControlExperienceEntry[]
  compact: boolean
}) {
  const { canonicalThemeId } = useAppTheme()
  switch (canonicalThemeId) {
    case 'monet': return <MonetControlCatalog entries={entries} compact={compact} />
    case 'material': return <MaterialControlCatalog entries={entries} compact={compact} />
    case 'liquid-glass': return <LiquidGlassControlCatalog entries={entries} compact={compact} />
    case 'minimal':
    default: return <MinimalControlCatalog entries={entries} />
  }
}

function MinimalControlNavigation({ value, onChange }: { value: SettingsControlView | null; onChange: (value: SettingsControlView) => void }) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const { t } = useTranslation()
  const tabs = controlTabs(t)
  return (
    <View testID="settings-control-navigation-minimal" accessibilityRole="tablist" style={{ flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.semantic.chrome.border }}>
      {tabs.map((tab) => {
        const active = value === tab.value
        return (
          <IslePressable
            key={tab.value}
            testID={`settings-control-tab-${tab.value}`}
            haptic
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: active }}
            onPress={() => onChange(tab.value)}
            style={{ minHeight: 44, flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderBottomWidth: active ? 2 : 0, borderBottomColor: colors.text }}
          >
            <MotiView animate={{ opacity: active ? 1 : 0.72, translateY: active ? 0 : 1, scale: active ? 1 : 0.98 }} transition={{ type: 'timing', duration: motion === 'full' ? 180 : 1 }}>
              <Text numberOfLines={1} style={{ color: active ? colors.text : colors.textTertiary, fontSize: 12, lineHeight: 16, fontWeight: active ? '800' : '600' }}>{tab.label}</Text>
            </MotiView>
          </IslePressable>
        )
      })}
    </View>
  )
}

function LimeRoadControlNavigation({ value, onChange }: { value: SettingsControlView | null; onChange: (value: SettingsControlView) => void }) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const { t } = useTranslation()
  const tabs = controlTabs(t)
  return (
    <View testID="settings-control-navigation-lime-road" accessibilityRole="tablist" style={{ flexDirection: 'row', alignItems: 'stretch', gap: 8 }}>
      {tabs.map((tab) => {
        const active = value === tab.value
        return (
          <IslePressable
            key={tab.value}
            testID={`settings-control-tab-${tab.value}`}
            haptic
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: active }}
            onPress={() => onChange(tab.value)}
            style={{ flex: 1, minWidth: 0, minHeight: 46, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 6, backgroundColor: active ? colors.ui.control.primaryBackground : colors.ui.semantic.surface.muted, borderWidth: 1, borderColor: active ? colors.ui.control.primaryBorder : colors.material.stroke }}
          >
            <MotiView animate={{ opacity: active ? 1 : 0.72, translateY: active ? 0 : 1, scale: active ? 1 : 0.98 }} transition={{ type: 'timing', duration: motion === 'full' ? 180 : 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <AppIcon name={tab.icon} color={active ? colors.ui.control.primaryForeground : colors.textSecondary} size={15} />
              <Text numberOfLines={1} style={{ color: active ? colors.ui.control.primaryForeground : colors.text, fontSize: 11.5, lineHeight: 15, fontWeight: '900' }}>{tab.label}</Text>
            </MotiView>
          </IslePressable>
        )
      })}
    </View>
  )
}

function MonetControlNavigation({ value, onChange }: { value: SettingsControlView | null; onChange: (value: SettingsControlView) => void }) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const { t } = useTranslation()
  const tabs = controlTabs(t)
  return (
    <View testID="settings-control-navigation-monet" accessibilityRole="tablist" style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 3 }}>
      {tabs.map((tab, index) => {
        const active = value === tab.value
        return (
          <IslePressable key={tab.value} testID={`settings-control-tab-${tab.value}`} haptic accessibilityRole="tab" accessibilityLabel={tab.label} accessibilityState={{ selected: active }} onPress={() => onChange(tab.value)} style={{ position: 'relative', minHeight: active ? 52 : 46, flex: 1, minWidth: 0, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, overflow: 'hidden', borderTopLeftRadius: index ? 9 : 18, borderTopRightRadius: index ? 18 : 10, borderBottomRightRadius: index ? 11 : 20, borderBottomLeftRadius: index ? 20 : 12, backgroundColor: active ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.base, borderWidth: StyleSheet.hairlineWidth, borderColor: active ? colors.primary : colors.ui.semantic.chrome.border }}>
            <View pointerEvents="none" style={{ position: 'absolute', top: -18, right: -16, width: 76, height: 52, borderBottomLeftRadius: 46, backgroundColor: active ? colors.ui.icon.accentBackground : colors.ui.semantic.surface.muted, opacity: active ? 0.28 : 0.14 }} />
            <MotiView animate={{ opacity: active ? 1 : 0.72, translateY: active ? 0 : 1, scale: active ? 1 : 0.98 }} transition={{ type: 'timing', duration: motion === 'full' ? 180 : 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <AppIcon name={tab.icon} color={active ? colors.primary : colors.textTertiary} size={16} />
              <Text numberOfLines={1} style={{ color: active ? colors.text : colors.textSecondary, fontSize: 12, lineHeight: 16, fontWeight: active ? '700' : '600' }}>{tab.label}</Text>
            </MotiView>
          </IslePressable>
        )
      })}
    </View>
  )
}

function MarkdownControlNavigation({ value, onChange }: { value: SettingsControlView | null; onChange: (value: SettingsControlView) => void }) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const { t } = useTranslation()
  const tabs = controlTabs(t)
  return (
    <View testID="settings-control-navigation-markdown" accessibilityRole="tablist" style={{ flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.section.divider }}>
      {tabs.map((tab) => {
        const active = value === tab.value
        return (
          <IslePressable
            key={tab.value}
            testID={`settings-control-tab-${tab.value}`}
            haptic
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: active }}
            onPress={() => onChange(tab.value)}
            style={{ minHeight: 44, flex: 1, minWidth: 0, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: active ? colors.ui.semantic.surface.muted : 'transparent', borderBottomWidth: active ? 2 : 0, borderBottomColor: colors.ui.control.link }}
          >
            <MotiView animate={{ opacity: active ? 1 : 0.72, translateY: active ? 0 : 1, scale: active ? 1 : 0.98 }} transition={{ type: 'timing', duration: motion === 'full' ? 180 : 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <AppIcon name={tab.icon} color={active ? colors.ui.control.link : colors.textTertiary} size={14} />
              <Text numberOfLines={1} style={{ color: active ? colors.text : colors.textSecondary, fontSize: 11, lineHeight: 15, fontWeight: active ? '800' : '600' }}>{tab.label}</Text>
            </MotiView>
          </IslePressable>
        )
      })}
    </View>
  )
}

function MaterialControlNavigation({ value, onChange }: { value: SettingsControlView | null; onChange: (value: SettingsControlView) => void }) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const { t } = useTranslation()
  const tabs = controlTabs(t)
  return (
    <View testID="settings-control-navigation-material" accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 4, padding: 4, borderRadius: 16, backgroundColor: colors.ui.semantic.surface.muted }}>
      {tabs.map((tab) => {
        const active = value === tab.value
        return (
          <IslePressable key={tab.value} testID={`settings-control-tab-${tab.value}`} haptic accessibilityRole="tab" accessibilityLabel={tab.label} accessibilityState={{ selected: active }} onPress={() => onChange(tab.value)} style={{ minHeight: 58, flex: 1, minWidth: 0, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 3, backgroundColor: active ? colors.ui.control.primaryBackground : 'transparent' }}>
            <MotiView animate={{ opacity: active ? 1 : 0.72, translateY: active ? 0 : 1, scale: active ? 1 : 0.98 }} transition={{ type: 'timing', duration: motion === 'full' ? 180 : 1 }} style={{ alignItems: 'center', gap: 3 }}>
              <AppIcon name={tab.icon} color={active ? colors.ui.control.primaryForeground : colors.textSecondary} size={15} />
              <Text numberOfLines={1} style={{ color: active ? colors.ui.control.primaryForeground : colors.textSecondary, fontSize: 12, lineHeight: 16, fontWeight: active ? '700' : '600' }}>{tab.label}</Text>
            </MotiView>
          </IslePressable>
        )
      })}
    </View>
  )
}

function LiquidGlassControlNavigation({ value, onChange }: { value: SettingsControlView | null; onChange: (value: SettingsControlView) => void }) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const { t } = useTranslation()
  const tabs = controlTabs(t)
  return (
    <View testID="settings-control-navigation-liquid-glass" accessibilityRole="tablist" style={{ position: 'relative', flexDirection: 'row', gap: 6, padding: 5, borderRadius: 26, overflow: 'hidden', backgroundColor: colors.ui.semantic.chrome.background, borderWidth: 1, borderColor: colors.ui.semantic.chrome.border }}>
      <View pointerEvents="none" style={{ position: 'absolute', top: 2, right: 24, left: 24, height: StyleSheet.hairlineWidth, backgroundColor: colors.ui.control.primaryForeground, opacity: 0.42 }} />
      {tabs.map((tab) => {
        const active = value === tab.value
        return (
          <IslePressable key={tab.value} testID={`settings-control-tab-${tab.value}`} haptic accessibilityRole="tab" accessibilityLabel={tab.label} accessibilityState={{ selected: active }} onPress={() => onChange(tab.value)} style={{ minHeight: 42, flex: 1, minWidth: 0, borderRadius: 21, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: active ? colors.ui.semantic.surface.raised : 'transparent', borderWidth: active ? 1 : StyleSheet.hairlineWidth, borderColor: active ? colors.ui.control.primaryBorder : colors.ui.actionBar.itemBorder }}>
            <MotiView animate={{ opacity: active ? 1 : 0.72, translateY: active ? 0 : 1, scale: active ? 1 : 0.98 }} transition={{ type: 'timing', duration: motion === 'full' ? 180 : 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <AppIcon name={tab.icon} color={active ? colors.ui.control.link : colors.textTertiary} size={15} />
              <Text numberOfLines={1} style={{ color: active ? colors.text : colors.textSecondary, fontSize: 11.5, lineHeight: 15, fontWeight: active ? '700' : '600' }}>{tab.label}</Text>
            </MotiView>
          </IslePressable>
        )
      })}
    </View>
  )
}

function MinimalControlCatalog({ entries }: { entries: SettingsControlExperienceEntry[] }) {
  const { colors } = useAppTheme()
  return (
    <View testID="settings-control-catalog-minimal" style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.ui.semantic.chrome.border }}>
      {entries.map((entry) => {
        const tone = controlTone(colors, entry)
        return (
          <IslePressable
            key={entry.key}
            testID={`settings-${entry.key}-toggle`}
            haptic
            accessibilityRole="button"
            accessibilityLabel={`${entry.title}. ${entry.detail}`}
            accessibilityState={{ selected: entry.active }}
            onPress={entry.onPress}
            style={{ minHeight: 64, paddingVertical: 10, paddingHorizontal: 2, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.semantic.chrome.border }}
          >
            <View style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: entry.active || entry.tone ? tone.foreground : 'transparent' }} />
            <AppIcon name={entry.icon} color={entry.active || entry.tone ? tone.foreground : colors.textTertiary} size={17} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '700' }}>{entry.title}</Text>
              <Text numberOfLines={2} style={{ marginTop: 2, color: colors.textTertiary, fontSize: 11, lineHeight: 15, fontWeight: '500' }}>{entry.detail}</Text>
            </View>
          </IslePressable>
        )
      })}
    </View>
  )
}

function LimeRoadControlCatalog({ entries, compact }: { entries: SettingsControlExperienceEntry[]; compact: boolean }) {
  const { colors } = useAppTheme()
  return (
    <View testID="settings-control-catalog-lime-road" style={{ borderTopWidth: 1, borderTopColor: colors.material.stroke }}>
      {entries.map((entry, index) => {
        const tone = controlTone(colors, entry)
        return (
          <IslePressable
            key={entry.key}
            testID={`settings-${entry.key}-toggle`}
            haptic
            accessibilityRole="button"
            accessibilityLabel={`${entry.title}. ${entry.detail}`}
            accessibilityState={{ selected: entry.active }}
            onPress={entry.onPress}
            style={{ minHeight: compact ? 62 : 66, paddingHorizontal: 4, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: index === entries.length - 1 ? 0 : 1, borderBottomColor: colors.material.stroke }}
          >
            <View style={{ width: 3, alignSelf: 'stretch', backgroundColor: entry.active || entry.tone ? tone.foreground : 'transparent' }} />
            <View style={{ width: 30, height: 30, borderRadius: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: tone.background }}>
              <AppIcon name={entry.icon} color={tone.foreground} size={16} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13, lineHeight: 17, fontWeight: '900' }}>{entry.title}</Text>
              <Text numberOfLines={compact ? 1 : 2} style={{ marginTop: 2, color: colors.textTertiary, fontSize: 10.5, lineHeight: 14, fontWeight: '600' }}>{entry.detail}</Text>
            </View>
            <AppIcon name="arrow-right" color={colors.textTertiary} size={14} />
          </IslePressable>
        )
      })}
    </View>
  )
}

function MonetControlCatalog({ entries, compact }: { entries: SettingsControlExperienceEntry[]; compact: boolean }) {
  const { colors } = useAppTheme()
  return (
    <View testID="settings-control-catalog-monet" style={{ gap: compact ? 7 : 9, paddingHorizontal: 2 }}>
      {entries.map((entry, index) => {
        const tone = controlTone(colors, entry)
        return (
          <IslePressable key={entry.key} testID={`settings-${entry.key}-toggle`} haptic accessibilityRole="button" accessibilityLabel={`${entry.title}. ${entry.detail}`} accessibilityState={{ selected: entry.active }} onPress={entry.onPress} style={{ position: 'relative', minHeight: compact ? 62 : 70, marginLeft: index % 2 ? 10 : 0, marginRight: index % 2 ? 0 : 10, paddingHorizontal: 10, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 11, overflow: 'hidden', backgroundColor: entry.active ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.base, borderWidth: StyleSheet.hairlineWidth, borderColor: entry.active || entry.tone ? tone.border : colors.ui.semantic.chrome.border, borderTopLeftRadius: index % 2 ? 9 : 18, borderTopRightRadius: index % 2 ? 18 : 10, borderBottomRightRadius: index % 2 ? 11 : 20, borderBottomLeftRadius: index % 2 ? 20 : 12 }}>
            <View pointerEvents="none" style={{ position: 'absolute', top: -20, right: -16, width: 92, height: 62, borderBottomLeftRadius: 56, backgroundColor: entry.active || entry.tone ? tone.background : colors.ui.icon.accentBackground, opacity: 0.24 }} />
            <View testID={`settings-control-icon-monet-${entry.key}`} style={{ width: 32, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', borderWidth: 0 }}><AppIcon name={entry.icon} color={tone.foreground} size={16} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '700' }}>{entry.title}</Text>
              <Text numberOfLines={compact ? 1 : 2} style={{ marginTop: 2, color: colors.textSecondary, fontSize: 10.5, lineHeight: 14, fontWeight: '500' }}>{entry.detail}</Text>
            </View>
            <View style={{ width: 22, height: 4, borderRadius: 2, backgroundColor: entry.active || entry.tone ? tone.foreground : colors.ui.semantic.chrome.border, opacity: 0.66 }} />
          </IslePressable>
        )
      })}
    </View>
  )
}

function MarkdownControlCatalog({ entries, compact }: { entries: SettingsControlExperienceEntry[]; compact: boolean }) {
  const { colors } = useAppTheme()
  return (
    <View testID="settings-control-catalog-markdown" style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.ui.section.divider }}>
      {entries.map((entry, index) => {
        const tone = controlTone(colors, entry)
        return (
          <IslePressable
            key={entry.key}
            testID={`settings-${entry.key}-toggle`}
            haptic
            accessibilityRole="button"
            accessibilityLabel={`${entry.title}. ${entry.detail}`}
            accessibilityState={{ selected: entry.active }}
            onPress={entry.onPress}
            style={{ minHeight: compact ? 60 : 64, paddingHorizontal: 9, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: index % 2 ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.base, borderLeftWidth: 2, borderLeftColor: entry.active || entry.tone ? tone.foreground : 'transparent', borderBottomWidth: index === entries.length - 1 ? 0 : StyleSheet.hairlineWidth, borderBottomColor: colors.ui.section.divider }}
          >
            <AppIcon name={entry.icon} color={entry.active || entry.tone ? tone.foreground : colors.textTertiary} size={16} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: colors.text, fontSize: 12.5, lineHeight: 17, fontWeight: '800' }}>{entry.title}</Text>
              <Text numberOfLines={compact ? 1 : 2} style={{ marginTop: 2, color: colors.textTertiary, fontSize: 10.5, lineHeight: 14, fontWeight: '500' }}>{entry.detail}</Text>
            </View>
            <AppIcon name="arrow-right" color={colors.textTertiary} size={14} />
          </IslePressable>
        )
      })}
    </View>
  )
}

function MaterialControlCatalog({ entries, compact }: { entries: SettingsControlExperienceEntry[]; compact: boolean }) {
  const { colors } = useAppTheme()
  return (
    <View testID="settings-control-catalog-material" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {entries.map((entry) => {
        const tone = controlTone(colors, entry)
        return (
          <IslePressable key={entry.key} testID={`settings-${entry.key}-toggle`} haptic accessibilityRole="button" accessibilityLabel={`${entry.title}. ${entry.detail}`} accessibilityState={{ selected: entry.active }} onPress={entry.onPress} style={{ minHeight: compact ? 72 : 86, width: compact ? '100%' : '48.8%', flexGrow: compact ? 0 : 1, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: entry.active ? colors.ui.actionBar.itemActiveBackground : colors.ui.semantic.surface.muted }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <View testID={`settings-control-icon-material-${entry.key}`} style={{ width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', borderWidth: 0 }}><AppIcon name={entry.icon} color={tone.foreground} size={18} /></View>
              <View style={{ flex: 1 }} />
              <AppIcon name="arrow-right" color={colors.textTertiary} size={15} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ marginTop: 7, color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '700' }}>{entry.title}</Text>
              <Text numberOfLines={compact ? 1 : 2} style={{ marginTop: 2, color: colors.textSecondary, fontSize: 11, lineHeight: 15, fontWeight: '500' }}>{entry.detail}</Text>
            </View>
          </IslePressable>
        )
      })}
    </View>
  )
}

function LiquidGlassControlCatalog({ entries, compact }: { entries: SettingsControlExperienceEntry[]; compact: boolean }) {
  const { colors } = useAppTheme()
  return (
    <View testID="settings-control-catalog-liquid-glass" style={{ gap: 8 }}>
      {entries.map((entry) => {
        const tone = controlTone(colors, entry)
        return (
          <IslePressable key={entry.key} testID={`settings-${entry.key}-toggle`} haptic accessibilityRole="button" accessibilityLabel={`${entry.title}. ${entry.detail}`} accessibilityState={{ selected: entry.active }} onPress={entry.onPress} style={{ position: 'relative', minHeight: compact ? 62 : 68, paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 10, overflow: 'hidden', borderRadius: 22, backgroundColor: entry.active ? colors.ui.actionBar.itemActiveBackground : colors.ui.semantic.chrome.background, borderWidth: 1, borderColor: entry.active ? colors.ui.control.primaryBorder : colors.ui.actionBar.itemBorder }}>
            <View pointerEvents="none" style={{ position: 'absolute', top: 2, right: 28, left: 28, height: StyleSheet.hairlineWidth, backgroundColor: colors.ui.control.primaryForeground, opacity: 0.42 }} />
            <View testID={`settings-control-icon-liquid-glass-${entry.key}`} style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', borderWidth: 0 }}><AppIcon name={entry.icon} color={tone.foreground} size={16} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13, lineHeight: 17, fontWeight: '700' }}>{entry.title}</Text>
              <Text numberOfLines={compact ? 1 : 2} style={{ marginTop: 2, color: colors.textSecondary, fontSize: 10.5, lineHeight: 14, fontWeight: '500' }}>{entry.detail}</Text>
            </View>
            <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.ui.actionBar.itemBorder }}><AppIcon name="arrow-right" color={colors.textTertiary} size={14} /></View>
          </IslePressable>
        )
      })}
    </View>
  )
}

function controlTabs(t: ReturnType<typeof useTranslation>['t']): { value: SettingsControlView; label: string; icon: AppIconName }[] {
  return [
    { value: 'ai', label: t('settings.controlAi'), icon: 'spark' },
    { value: 'system', label: t('settings.controlSystem'), icon: 'settings-sliders' },
  ]
}

function controlTone(colors: ReturnType<typeof useAppTheme>['colors'], entry: SettingsControlExperienceEntry) {
  if (entry.tone === 'danger') return colors.ui.tone.danger
  if (entry.tone === 'warning') return colors.ui.tone.warning
  if (entry.active) return colors.ui.tone.success
  return colors.ui.tone.neutral
}
