import { StyleSheet, View } from 'react-native'
import { Text } from '@/components/ui/AppText'
import { AppIcon, type AppIconName } from '@/components/ui/AppIcon'
import { IslePressable } from '@/components/ui/isle'
import { GlassSurface } from '@/components/ui/isle/GlassSurface'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useTranslation } from 'react-i18next'
import { WorkspaceChoice } from '@/presentation/layout/WorkspaceChoice'

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
  const { t } = useTranslation()
  const family = canonicalThemeId === 'animal-island-ui' ? 'minimal' : canonicalThemeId
  return <View testID={`settings-control-navigation-${family}`} accessibilityRole="tablist"
    style={{ flexDirection: 'row', gap: 4 }}>
    {controlTabs(t).map(tab => <WorkspaceChoice key={tab.value} testID={`settings-control-tab-${tab.value}`}
      label={tab.label} icon={canonicalThemeId === 'minimal' ? undefined : tab.icon}
      selected={value === tab.value} onPress={() => onChange(tab.value)} style={{ flex: 1, minWidth: 0 }} />)}
  </View>
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
              <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '700' }}>{entry.title}</Text>
              <Text style={{ marginTop: 2, color: colors.textTertiary, fontSize: 14, lineHeight: 20, fontWeight: '500' }}>{entry.detail}</Text>
            </View>
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
              <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '700' }}>{entry.title}</Text>
              <Text numberOfLines={compact ? 1 : 2} style={{ marginTop: 2, color: colors.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: '500' }}>{entry.detail}</Text>
            </View>
            <View style={{ width: 22, height: 4, borderRadius: 2, backgroundColor: entry.active || entry.tone ? tone.foreground : colors.ui.semantic.chrome.border, opacity: 0.66 }} />
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
          <IslePressable key={entry.key} testID={`settings-${entry.key}-toggle`} haptic accessibilityRole="button" accessibilityLabel={`${entry.title}. ${entry.detail}`} accessibilityState={{ selected: entry.active }} onPress={entry.onPress} style={{ minHeight: compact ? 72 : 86, width: compact ? '100%' : '48.8%', flexGrow: compact ? 0 : 1, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 16, backgroundColor: entry.active ? colors.ui.actionBar.itemActiveBackground : colors.design?.semantic.color.surfaceContainer ?? colors.ui.semantic.surface.muted }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <View testID={`settings-control-icon-material-${entry.key}`} style={{ width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', borderWidth: 0 }}><AppIcon name={entry.icon} color={tone.foreground} size={18} /></View>
              <View style={{ flex: 1 }} />
              <AppIcon name="arrow-right" color={colors.textTertiary} size={15} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ marginTop: 7, color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '700' }}>{entry.title}</Text>
              <Text numberOfLines={compact ? 1 : 2} style={{ marginTop: 2, color: colors.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: '500' }}>{entry.detail}</Text>
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
    <GlassSurface colors={colors} testID="settings-control-catalog-liquid-glass" style={{ gap: 3, padding: 5 }}>
      {entries.map((entry) => {
        const tone = controlTone(colors, entry)
        return (
          <IslePressable key={entry.key} testID={`settings-${entry.key}-toggle`} haptic accessibilityRole="button" accessibilityLabel={`${entry.title}. ${entry.detail}`} accessibilityState={{ selected: entry.active }} onPress={entry.onPress} style={{ position: 'relative', minHeight: compact ? 62 : 68, paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 10, overflow: 'hidden', borderRadius: 22, backgroundColor: entry.active ? colors.ui.actionBar.itemActiveBackground : 'transparent', borderWidth: 1, borderColor: entry.active ? colors.ui.control.primaryBorder : 'transparent' }}>
            <View testID={`settings-control-icon-liquid-glass-${entry.key}`} style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', borderWidth: 0 }}><AppIcon name={entry.icon} color={tone.foreground} size={16} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '700' }}>{entry.title}</Text>
              <Text numberOfLines={compact ? 1 : 2} style={{ marginTop: 2, color: colors.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: '500' }}>{entry.detail}</Text>
            </View>
            <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.ui.actionBar.itemBorder }}><AppIcon name="arrow-right" color={colors.textTertiary} size={14} /></View>
          </IslePressable>
        )
      })}
    </GlassSurface>
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
