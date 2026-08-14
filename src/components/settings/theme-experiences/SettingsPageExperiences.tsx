import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { useAppTheme } from '@/hooks/useAppTheme'

export interface SettingsPageExperienceProps {
  title: string
  subtitle?: string
  rootTitle: string
  routeKey: string
  compact: boolean
  leading: ReactNode
  children: ReactNode
}

export function MinimalSettingsPageExperience({
  title,
  subtitle,
  rootTitle: _rootTitle,
  routeKey: _routeKey,
  compact,
  leading,
  children,
}: SettingsPageExperienceProps) {
  const { colors } = useAppTheme()
  return (
    <View testID="settings-page-experience-minimal" style={styles.minimalRoot}>
      <View style={[styles.header, { minHeight: compact ? 52 : 56, borderBottomColor: colors.ui.semantic.chrome.border }]}>
        {leading}
        <View style={styles.titleBlock}>
          <Text accessibilityRole="header" numberOfLines={1} style={[styles.minimalTitle, { color: colors.text }]}>{title}</Text>
          {subtitle ? <Text numberOfLines={compact ? 2 : 1} style={[styles.subtitle, { color: colors.textTertiary }]}>{subtitle}</Text> : null}
        </View>
      </View>
      <View testID="settings-detail-surface-minimal" style={[styles.content, { paddingTop: compact ? 10 : 12 }]}>{children}</View>
    </View>
  )
}

export function LimeRoadSettingsPageExperience({
  title,
  subtitle,
  rootTitle: _rootTitle,
  routeKey: _routeKey,
  compact,
  leading,
  children,
}: SettingsPageExperienceProps) {
  const { colors } = useAppTheme()
  return (
    <View testID="settings-page-experience-lime-road" style={styles.routeRoot}>
      <View style={[styles.header, { minHeight: compact ? 54 : 58, borderBottomWidth: 1, borderBottomColor: colors.material.stroke }]}>
        {leading}
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.routeMarker, { backgroundColor: colors.ui.control.link }]} />
        <View style={styles.titleBlock}>
          <Text accessibilityRole="header" numberOfLines={1} style={[styles.routeTitle, { color: colors.text }]}>{title}</Text>
          {subtitle ? <Text numberOfLines={compact ? 2 : 1} style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text> : null}
        </View>
      </View>
      <View testID="settings-detail-surface-lime-road" style={[styles.content, styles.routeContent, { borderLeftColor: colors.ui.control.link, paddingTop: compact ? 10 : 12 }]}>{children}</View>
    </View>
  )
}

export function MarkdownSettingsPageExperience({
  title,
  subtitle,
  rootTitle: _rootTitle,
  routeKey: _routeKey,
  compact,
  leading,
  children,
}: SettingsPageExperienceProps) {
  const { colors } = useAppTheme()
  return (
    <View testID="settings-page-experience-markdown" style={styles.documentRoot}>
      <View style={[styles.header, { minHeight: compact ? 52 : 56, borderBottomColor: colors.ui.section.divider }]}>
        {leading}
        <View style={styles.titleBlock}>
          <Text accessibilityRole="header" numberOfLines={1} style={[styles.documentTitle, { color: colors.text }]}>{title}</Text>
          {subtitle ? <Text numberOfLines={compact ? 2 : 1} style={[styles.subtitle, { color: colors.textTertiary }]}>{subtitle}</Text> : null}
        </View>
      </View>
      <View testID="settings-markdown-detail-outline" style={[styles.content, styles.documentContent, { borderLeftColor: colors.ui.section.divider, paddingTop: compact ? 10 : 12 }]}>
        <View testID="settings-detail-surface-markdown" style={styles.content}>{children}</View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  minimalRoot: { width: '100%', maxWidth: 860 },
  routeRoot: { width: '100%', maxWidth: 900 },
  documentRoot: { width: '100%', maxWidth: 880 },
  header: { paddingHorizontal: 2, paddingVertical: 5, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 10 },
  titleBlock: { flex: 1, minWidth: 0 },
  minimalTitle: { fontSize: 18, lineHeight: 23, fontWeight: '800', includeFontPadding: false },
  routeTitle: { fontSize: 19, lineHeight: 24, fontWeight: '900', includeFontPadding: false },
  documentTitle: { fontSize: 17, lineHeight: 22, fontWeight: '800', includeFontPadding: false },
  subtitle: { marginTop: 1, fontSize: 11, lineHeight: 15, fontWeight: '500', includeFontPadding: false },
  content: { minWidth: 0, gap: 9 },
  routeMarker: { width: 16, height: 3 },
  routeContent: { marginTop: 10, paddingLeft: 12, borderLeftWidth: 3 },
  documentContent: { marginTop: 10, paddingLeft: 11, borderLeftWidth: 2 },
})
