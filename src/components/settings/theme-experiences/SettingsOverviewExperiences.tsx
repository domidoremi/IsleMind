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
