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

export function LiquidGlassSettingsPageExperience({
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
    <View testID="settings-page-experience-liquid-glass" style={styles.glassRoot}>
      <View style={[styles.glassHeader, { backgroundColor: colors.ui.semantic.chrome.background, borderColor: colors.ui.semantic.chrome.border }]}>
        {leading}
        <View style={styles.titleBlock}>
          <Text accessibilityRole="header" numberOfLines={1} style={[styles.glassTitle, { color: colors.text }]}>{title}</Text>
          {subtitle ? <Text numberOfLines={compact ? 2 : 1} style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text> : null}
        </View>
      </View>
      <View testID="settings-detail-surface-liquid-glass" style={[styles.glassContent, { backgroundColor: colors.ui.semantic.surface.canvas }]}>
        {children}
      </View>
    </View>
  )
}

export function MonetSettingsPageExperience({
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
    <View testID="settings-page-experience-monet" style={styles.monetRoot}>
      <View style={[styles.monetHeader, { minHeight: compact ? 58 : 64, borderBottomColor: colors.ui.semantic.chrome.border }]}>
        {leading}
        <View style={styles.titleBlock}>
          <Text accessibilityRole="header" numberOfLines={1} style={[styles.monetTitle, { color: colors.text }]}>{title}</Text>
          {subtitle ? <Text numberOfLines={compact ? 2 : 1} style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text> : null}
          <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.monetBrushRow}>
            <View style={[styles.monetBrushLong, { backgroundColor: colors.primary }]} />
            <View style={[styles.monetBrushShort, { backgroundColor: colors.accent }]} />
          </View>
        </View>
      </View>
      <View testID="settings-detail-surface-monet" style={[styles.monetContent, { borderLeftColor: colors.primary, paddingTop: compact ? 12 : 16 }]}>{children}</View>
    </View>
  )
}

export function MaterialSettingsPageExperience({
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
    <View testID="settings-page-experience-material" style={styles.materialRoot}>
      <View style={[styles.materialHeader, { minHeight: compact ? 64 : 72, backgroundColor: colors.ui.semantic.surface.muted }]}>
        {leading}
        <View style={styles.titleBlock}>
          <Text accessibilityRole="header" numberOfLines={1} style={[styles.materialTitle, { color: colors.text }]}>{title}</Text>
          {subtitle ? <Text numberOfLines={compact ? 2 : 1} style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text> : null}
        </View>
      </View>
      <View testID="settings-detail-surface-material" style={[styles.materialContent, { paddingTop: compact ? 12 : 16 }]}>{children}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  minimalRoot: { width: '100%', maxWidth: 860 },
  routeRoot: { width: '100%', maxWidth: 900 },
  documentRoot: { width: '100%', maxWidth: 880 },
  glassRoot: { width: '100%', maxWidth: 900 },
  monetRoot: { width: '100%', maxWidth: 900 },
  materialRoot: { width: '100%', maxWidth: 900 },
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
  glassHeader: { minHeight: 60, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 24, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  glassTitle: { fontSize: 18, lineHeight: 24, fontWeight: '700', includeFontPadding: false },
  glassContent: { marginTop: 12, padding: 10, borderRadius: 26, minWidth: 0, gap: 10, overflow: 'hidden' },
  monetHeader: { paddingHorizontal: 4, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 10 },
  monetTitle: { fontSize: 21, lineHeight: 28, fontWeight: '600', includeFontPadding: false },
  monetBrushRow: { flexDirection: 'row', gap: 5, height: 3, marginTop: 5, maxWidth: 112 },
  monetBrushLong: { flex: 1.1, borderRadius: 2 },
  monetBrushShort: { flex: 0.42, borderRadius: 2 },
  monetContent: { marginTop: 12, paddingLeft: 12, borderLeftWidth: 2, minWidth: 0, gap: 10 },
  materialHeader: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 24, flexDirection: 'row', alignItems: 'center', gap: 12 },
  materialTitle: { fontSize: 22, lineHeight: 29, fontWeight: '500', includeFontPadding: false },
  materialContent: { minWidth: 0, gap: 12 },
})
