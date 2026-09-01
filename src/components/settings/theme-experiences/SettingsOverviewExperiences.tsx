import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useAppTheme } from '@/hooks/useAppTheme'

export interface SettingsOverviewExperienceProps {
  title: string
  leading?: ReactNode
  status: ReactNode
  attention?: ReactNode
  search: ReactNode
  tabs: ReactNode
  catalog: ReactNode
  emptyState?: ReactNode
  searchLabel: string
  controlLabel: string
  compact: boolean
  embedded: boolean
}

export function MinimalSettingsOverviewExperience({
  title,
  leading,
  status,
  attention,
  search,
  tabs,
  catalog,
  emptyState,
  embedded,
}: SettingsOverviewExperienceProps) {
  const { colors } = useAppTheme()
  return (
    <View testID="settings-overview-experience-minimal">
      {!embedded ? <View style={{ minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.semantic.chrome.border }}>
        {leading}
        <Text accessibilityRole="header" numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 18, lineHeight: 23, fontWeight: '700', includeFontPadding: false }}>{title}</Text>
      </View> : null}
      <View testID="settings-minimal-utility-status" style={{ paddingTop: embedded ? 0 : 10 }}>
        {status}
      </View>
      {attention ? <View style={{ marginTop: 8 }}>{attention}</View> : null}
      <View style={{ marginTop: 12, gap: 9 }}>
        {search}
        {tabs}
        <View style={{ paddingTop: 1 }}>{catalog}</View>
        {emptyState}
      </View>
    </View>
  )
}

export function LimeRoadSettingsOverviewExperience({
  title,
  leading,
  status,
  attention,
  search,
  tabs,
  catalog,
  emptyState,
  searchLabel: _searchLabel,
  controlLabel: _controlLabel,
  embedded,
}: SettingsOverviewExperienceProps) {
  const { colors } = useAppTheme()
  return (
    <View testID="settings-overview-experience-lime-road">
      {!embedded ? <View style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 2, borderBottomWidth: 1, borderBottomColor: colors.material.stroke }}>
          {leading}
          <Text accessibilityRole="header" numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 20, lineHeight: 26, fontWeight: '900', includeFontPadding: false }}>{title}</Text>
        </View> : null}
      <View testID="settings-lime-road-itinerary" style={{ marginTop: embedded ? 0 : 10, paddingLeft: 12, borderLeftWidth: 3, borderLeftColor: colors.ui.control.link }}>
        {status}
        {attention ? <View style={{ marginTop: 8 }}>{attention}</View> : null}
        <View style={{ marginTop: 12, gap: 9 }}>
          {search}
          {tabs}
          <View style={{ paddingTop: 1 }}>{catalog}</View>
          {emptyState}
        </View>
      </View>
    </View>
  )
}

export function MarkdownSettingsOverviewExperience({
  title,
  leading,
  status,
  attention,
  search,
  tabs,
  catalog,
  emptyState,
  searchLabel: _searchLabel,
  controlLabel: _controlLabel,
  compact: _compact,
  embedded,
}: SettingsOverviewExperienceProps) {
  const { colors } = useAppTheme()
  return (
    <View testID="settings-overview-experience-markdown">
      {!embedded ? <View testID="settings-markdown-breadcrumb" style={{ minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.section.divider }}>
        {leading}
        <Text accessibilityRole="header" numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: '800' }}>{title}</Text>
      </View> : null}
      <View style={{ marginTop: embedded ? 0 : 10, paddingLeft: 11, borderLeftWidth: 2, borderLeftColor: colors.ui.section.divider }}>
        {status}
        {attention ? <View style={{ marginTop: 8 }}>{attention}</View> : null}
        <View style={{ marginTop: 12, gap: 9 }}>
          {search}
          {tabs}
          {catalog}
          {emptyState}
        </View>
      </View>
    </View>
  )
}

export function MonetSettingsOverviewExperience({
  title,
  leading,
  status,
  attention,
  search,
  tabs,
  catalog,
  emptyState,
  embedded,
}: SettingsOverviewExperienceProps) {
  const { colors } = useAppTheme()
  return (
    <View testID="settings-overview-experience-monet">
      {!embedded ? (
        <View style={{ minHeight: 62, paddingHorizontal: 4, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.semantic.chrome.border }}>
          {leading}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text accessibilityRole="header" numberOfLines={1} style={{ color: colors.text, fontSize: 22, lineHeight: 29, fontWeight: '600', includeFontPadding: false }}>{title}</Text>
            <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', gap: 5, marginTop: 5, height: 3 }}>
              <View style={{ flex: 1.1, borderRadius: 2, backgroundColor: colors.primary }} />
              <View style={{ flex: 0.38, borderRadius: 2, backgroundColor: colors.accent }} />
            </View>
          </View>
        </View>
      ) : null}
      <View testID="settings-monet-atmosphere" style={{ marginTop: embedded ? 0 : 10, gap: 10 }}>
        <View style={{ paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: colors.primary }}>{status}</View>
        {attention ? <View style={{ marginTop: -3 }}>{attention}</View> : null}
        <View style={{ gap: 10 }}>
          {search}
          {tabs}
          {catalog}
          {emptyState}
        </View>
      </View>
    </View>
  )
}

export function MaterialSettingsOverviewExperience({
  title,
  leading,
  status,
  attention,
  search,
  tabs,
  catalog,
  emptyState,
  embedded,
}: SettingsOverviewExperienceProps) {
  const { colors } = useAppTheme()
  return (
    <View testID="settings-overview-experience-material">
      {!embedded ? (
        <View style={{ minHeight: 64, paddingHorizontal: 4, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.section.divider, backgroundColor: colors.ui.semantic.surface.muted }}>
          {leading}
          <Text accessibilityRole="header" numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 23, lineHeight: 30, fontWeight: '500', includeFontPadding: false }}>{title}</Text>
        </View>
      ) : null}
      <View testID="settings-material-surface" style={{ marginTop: embedded ? 0 : 10, gap: 10 }}>
        <View style={{ paddingHorizontal: 4 }}>{status}</View>
        {attention ? <View>{attention}</View> : null}
        <View style={{ gap: 12 }}>
          {search}
          {tabs}
          {catalog}
          {emptyState}
        </View>
      </View>
    </View>
  )
}

export function LiquidGlassSettingsOverviewExperience({
  title,
  leading,
  status,
  attention,
  search,
  tabs,
  catalog,
  emptyState,
  embedded,
}: SettingsOverviewExperienceProps) {
  const { colors } = useAppTheme()
  return (
    <View testID="settings-overview-experience-liquid-glass">
      {!embedded ? (
        <View style={{ minHeight: 60, paddingHorizontal: 6, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 18, borderWidth: 1, borderColor: colors.ui.semantic.chrome.border, backgroundColor: colors.ui.semantic.chrome.background }}>
          {leading}
          <Text accessibilityRole="header" numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 20, lineHeight: 27, fontWeight: '700', includeFontPadding: false }}>{title}</Text>
        </View>
      ) : null}
      <View testID="settings-liquid-glass-chrome" style={{ marginTop: embedded ? 0 : 10, gap: 10 }}>
        <View style={{ paddingHorizontal: 6 }}>{status}</View>
        {attention ? <View>{attention}</View> : null}
        <View style={{ gap: 10 }}>
          {search}
          {tabs}
          {catalog}
          {emptyState}
        </View>
      </View>
    </View>
  )
}
