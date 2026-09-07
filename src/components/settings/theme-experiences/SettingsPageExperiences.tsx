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
        <View pointerEvents="none" style={[styles.minimalSectionMark, { backgroundColor: colors.ui.control.primaryBackground }]} />
        <View style={styles.titleBlock}>
          <Text accessibilityRole="header" numberOfLines={1} style={[styles.minimalTitle, { color: colors.text }]}>{title}</Text>
          {subtitle ? <Text numberOfLines={compact ? 2 : 1} style={[styles.subtitle, { color: colors.textTertiary }]}>{subtitle}</Text> : null}
        </View>
      </View>
      <View testID="settings-detail-surface-minimal" style={[styles.content, { paddingTop: compact ? 10 : 12 }]}>{children}</View>
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
        <View pointerEvents="none" style={[styles.glassHeaderPlane, { borderColor: colors.ui.actionBar.itemBorder }]} />
        {leading}
        <View style={styles.titleBlock}>
          <Text accessibilityRole="header" numberOfLines={1} style={[styles.glassTitle, { color: colors.text }]}>{title}</Text>
          {subtitle ? <Text numberOfLines={compact ? 2 : 1} style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text> : null}
        </View>
      </View>
      <View testID="settings-detail-surface-liquid-glass" style={[styles.glassContent, { borderColor: colors.ui.actionBar.itemBorder }]}>
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
      <View style={[styles.monetHeader, { minHeight: compact ? 58 : 64 }]}>
        <View pointerEvents="none" style={[styles.monetHeaderWash, { backgroundColor: colors.ui.icon.accentBackground }]} />
        {leading}
        <View style={styles.titleBlock}>
          <Text accessibilityRole="header" numberOfLines={1} style={[styles.monetTitle, { color: colors.text }]}>{title}</Text>
          {subtitle ? <Text numberOfLines={compact ? 2 : 1} style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text> : null}
          <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.monetBrushRow}>
            <View style={[styles.monetBrushLong, { backgroundColor: colors.primary }]} />
            <View style={[styles.monetBrushShort, { backgroundColor: colors.tertiary }]} />
          </View>
        </View>
      </View>
      <View testID="settings-detail-surface-monet" style={[styles.monetContent, { paddingTop: compact ? 12 : 16 }]}>
        <View pointerEvents="none" style={[styles.monetContentSpine, { backgroundColor: colors.primary }]} />
        <View pointerEvents="none" style={[styles.monetContentWash, { backgroundColor: colors.ui.semantic.surface.muted }]} />
        {children}
      </View>
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
      <View style={[styles.materialHeader, { minHeight: compact ? 58 : 64, backgroundColor: colors.ui.semantic.surface.muted, borderBottomColor: colors.ui.section.divider }]}>
        <View style={[styles.materialLeadingSlot, { backgroundColor: colors.ui.semantic.surface.raised }]}>{leading}</View>
        <View style={styles.titleBlock}>
          <Text accessibilityRole="header" numberOfLines={1} style={[styles.materialTitle, { color: colors.text }]}>{title}</Text>
          {subtitle ? <Text numberOfLines={compact ? 2 : 1} style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text> : null}
        </View>
        <View pointerEvents="none" style={[styles.materialHeaderIndicator, { backgroundColor: colors.primary }]} />
      </View>
      <View testID="settings-detail-surface-material" style={[styles.materialContent, { paddingTop: compact ? 12 : 16 }]}>
        <View pointerEvents="none" style={[styles.materialContentRail, { backgroundColor: colors.ui.semantic.surface.muted }]} />
        {children}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  minimalRoot: { width: '100%', maxWidth: 860 },
  glassRoot: { width: '100%', maxWidth: 900 },
  monetRoot: { width: '100%', maxWidth: 900 },
  materialRoot: { width: '100%', maxWidth: 900 },
  header: { paddingHorizontal: 2, paddingVertical: 5, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 10 },
  minimalSectionMark: { width: 2, height: 22, opacity: 0.72 },
  titleBlock: { flex: 1, minWidth: 0 },
  minimalTitle: { fontSize: 18, lineHeight: 23, fontWeight: '800', includeFontPadding: false },
  subtitle: { marginTop: 1, fontSize: 11, lineHeight: 15, fontWeight: '500', includeFontPadding: false },
  content: { minWidth: 0, gap: 9 },
  glassHeader: { position: 'relative', minHeight: 58, paddingHorizontal: 7, paddingVertical: 7, borderRadius: 22, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 10, overflow: 'hidden' },
  glassHeaderPlane: { position: 'absolute', top: 2, right: 2, bottom: 2, left: 2, borderRadius: 19, borderWidth: StyleSheet.hairlineWidth, opacity: 0.42 },
  glassTitle: { fontSize: 18, lineHeight: 24, fontWeight: '700', includeFontPadding: false },
  glassContent: { position: 'relative', marginTop: 12, minWidth: 0, gap: 10, paddingHorizontal: 8, paddingTop: 8, borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth },
  monetHeader: { position: 'relative', paddingHorizontal: 5, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 10, overflow: 'hidden' },
  monetHeaderWash: { position: 'absolute', top: -20, right: -18, width: 176, height: 76, borderBottomLeftRadius: 62, opacity: 0.2, transform: [{ rotate: '-3deg' }] },
  monetTitle: { fontSize: 21, lineHeight: 28, fontWeight: '600', includeFontPadding: false },
  monetBrushRow: { flexDirection: 'row', gap: 5, height: 3, marginTop: 5, maxWidth: 112 },
  monetBrushLong: { flex: 1.1, borderRadius: 2 },
  monetBrushShort: { flex: 0.42, borderRadius: 2 },
  monetContent: { position: 'relative', width: '96%', marginTop: 10, marginLeft: 6, paddingLeft: 16, paddingRight: 3, minWidth: 0, gap: 11 },
  monetContentSpine: { position: 'absolute', top: 10, bottom: 14, left: 2, width: 3, borderRadius: 2, opacity: 0.58 },
  monetContentWash: { position: 'absolute', top: 26, right: -14, width: 132, height: 42, borderTopLeftRadius: 34, borderBottomLeftRadius: 12, opacity: 0.12, transform: [{ rotate: '4deg' }] },
  materialHeader: { position: 'relative', paddingHorizontal: 6, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 12 },
  materialLeadingSlot: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  materialHeaderIndicator: { position: 'absolute', right: 18, bottom: 0, left: 66, height: 3, borderTopLeftRadius: 2, borderTopRightRadius: 2, opacity: 0.78 },
  materialTitle: { fontSize: 22, lineHeight: 29, fontWeight: '500', includeFontPadding: false },
  materialContent: { position: 'relative', minWidth: 0, gap: 12, paddingLeft: 14 },
  materialContentRail: { position: 'absolute', top: 14, bottom: 8, left: 0, width: 6, borderRadius: 3 },
})
