import type { ReactNode, Ref } from 'react'
import { StyleSheet, View } from 'react-native'

import { useAppTheme } from '@/hooks/useAppTheme'
import { WorkspaceHeader } from '@/presentation/layout/WorkspaceHeader'

export interface SettingsPageExperienceProps {
  title: string
  subtitle?: string
  rootTitle: string
  routeKey: string
  compact: boolean
  titleRef?: Ref<View>
  trailing?: ReactNode
  leading: ReactNode
  children: ReactNode
}

export function MinimalSettingsPageExperience({
  title,
  subtitle,
  rootTitle,
  routeKey: _routeKey,
  compact,
  leading,
  trailing,
  titleRef,
  children,
}: SettingsPageExperienceProps) {
  return (
    <View testID="settings-page-experience-minimal" style={styles.minimalRoot}>
      <WorkspaceHeader title={title} subtitle={subtitle} contextLabel={title !== rootTitle ? rootTitle : undefined}
        compact={compact} leading={leading} trailing={trailing} titleRef={titleRef} />
      <View testID="settings-detail-surface-minimal" style={[styles.content, { paddingTop: compact ? 10 : 12 }]}>{children}</View>
    </View>
  )
}

export function LiquidGlassSettingsPageExperience({
  title,
  subtitle,
  rootTitle,
  routeKey: _routeKey,
  compact,
  leading,
  trailing,
  titleRef,
  children,
}: SettingsPageExperienceProps) {
  const { colors } = useAppTheme()
  return (
    <View testID="settings-page-experience-liquid-glass" style={styles.glassRoot}>
      <WorkspaceHeader title={title} subtitle={subtitle} contextLabel={title !== rootTitle ? rootTitle : undefined}
        compact={compact} leading={leading} trailing={trailing} titleRef={titleRef} />
      <View testID="settings-detail-surface-liquid-glass" style={[styles.glassContent, { borderColor: colors.ui.actionBar.itemBorder }]}>
        {children}
      </View>
    </View>
  )
}

export function MonetSettingsPageExperience({
  title,
  subtitle,
  rootTitle,
  routeKey: _routeKey,
  compact,
  leading,
  trailing,
  titleRef,
  children,
}: SettingsPageExperienceProps) {
  const { colors } = useAppTheme()
  return (
    <View testID="settings-page-experience-monet" style={styles.monetRoot}>
      <WorkspaceHeader title={title} subtitle={subtitle} contextLabel={title !== rootTitle ? rootTitle : undefined}
        compact={compact} leading={leading} trailing={trailing} titleRef={titleRef} />
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
  rootTitle,
  routeKey: _routeKey,
  compact,
  leading,
  trailing,
  titleRef,
  children,
}: SettingsPageExperienceProps) {
  return (
    <View testID="settings-page-experience-material" style={styles.materialRoot}>
      <WorkspaceHeader title={title} subtitle={subtitle} contextLabel={title !== rootTitle ? rootTitle : undefined}
        compact={compact} leading={leading} trailing={trailing} titleRef={titleRef} />
      <View testID="settings-detail-surface-material" style={[styles.materialContent, { paddingTop: compact ? 12 : 16 }]}>
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
  content: { minWidth: 0, gap: 9 },
  glassContent: { position: 'relative', marginTop: 12, minWidth: 0, gap: 10, paddingHorizontal: 8, paddingTop: 8 },
  monetContent: { position: 'relative', width: '96%', marginTop: 10, marginLeft: 6, paddingLeft: 16, paddingRight: 3, minWidth: 0, gap: 11 },
  monetContentSpine: { position: 'absolute', top: 10, bottom: 14, left: 2, width: 3, borderRadius: 2, opacity: 0.58 },
  // Reserve inline space for rotation without clipping the settings content.
  monetContentWash: { position: 'absolute', top: 26, right: 4, width: 132, height: 42, borderTopLeftRadius: 34, borderBottomLeftRadius: 12, opacity: 0.12, transform: [{ rotate: '4deg' }] },
  materialContent: { position: 'relative', minWidth: 0, gap: 16 },
})
