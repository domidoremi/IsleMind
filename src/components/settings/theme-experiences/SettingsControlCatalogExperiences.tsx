import { StyleSheet, Text, View } from 'react-native'
import { AppIcon, type AppIconName } from '@/components/ui/AppIcon'
import { IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
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
  const { themeId } = useAppTheme()
  if (themeId === 'lime-road') return <LimeRoadControlNavigation value={value} onChange={onChange} />
  if (themeId === 'markdown') return <MarkdownControlNavigation value={value} onChange={onChange} />
  return <MinimalControlNavigation value={value} onChange={onChange} />
}

export function SettingsControlCatalog({
  entries,
  compact,
}: {
  entries: SettingsControlExperienceEntry[]
  compact: boolean
}) {
  const { themeId } = useAppTheme()
  if (themeId === 'lime-road') return <LimeRoadControlCatalog entries={entries} compact={compact} />
  if (themeId === 'markdown') return <MarkdownControlCatalog entries={entries} compact={compact} />
  return <MinimalControlCatalog entries={entries} />
}

function MinimalControlNavigation({ value, onChange }: { value: SettingsControlView | null; onChange: (value: SettingsControlView) => void }) {
  const { colors } = useAppTheme()
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
            <Text numberOfLines={1} style={{ color: active ? colors.text : colors.textTertiary, fontSize: 12, lineHeight: 16, fontWeight: active ? '800' : '600' }}>{tab.label}</Text>
          </IslePressable>
        )
      })}
    </View>
  )
}

function LimeRoadControlNavigation({ value, onChange }: { value: SettingsControlView | null; onChange: (value: SettingsControlView) => void }) {
  const { colors } = useAppTheme()
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
            <AppIcon name={tab.icon} color={active ? colors.ui.control.primaryForeground : colors.textSecondary} size={15} />
            <Text numberOfLines={1} style={{ color: active ? colors.ui.control.primaryForeground : colors.text, fontSize: 11.5, lineHeight: 15, fontWeight: '900' }}>{tab.label}</Text>
          </IslePressable>
        )
      })}
    </View>
  )
}

function MarkdownControlNavigation({ value, onChange }: { value: SettingsControlView | null; onChange: (value: SettingsControlView) => void }) {
  const { colors } = useAppTheme()
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
            <AppIcon name={tab.icon} color={active ? colors.ui.control.link : colors.textTertiary} size={14} />
            <Text numberOfLines={1} style={{ color: active ? colors.text : colors.textSecondary, fontSize: 11, lineHeight: 15, fontWeight: active ? '800' : '600' }}>{tab.label}</Text>
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
