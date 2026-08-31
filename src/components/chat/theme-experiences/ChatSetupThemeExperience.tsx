import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'

import type { useAppTheme } from '@/hooks/useAppTheme'
import type { CanonicalThemeId } from '@/types/settingsContracts'

type ChatThemeColors = ReturnType<typeof useAppTheme>['colors']

export interface ChatSetupThemeExperienceProps {
  /** Canonical family avoids the legacy presentation projection. */
  themeId: CanonicalThemeId
  colors: ChatThemeColors
  compactViewport: boolean
  chrome: ReactNode
  status: ReactNode
  content: ReactNode
  controls: ReactNode
  composer: ReactNode
}

/**
 * Setup shares Chat Home's spatial model: application chrome, one continuous
 * canvas, composer dock. Families change the atmosphere behind the canvas, not
 * the number of surfaces inside it.
 */
export function ChatSetupThemeExperience(props: ChatSetupThemeExperienceProps) {
  switch (props.themeId) {
    case 'monet': return <MonetSetupExperience {...props} />
    case 'material': return <MaterialSetupExperience {...props} />
    case 'liquid-glass': return <LiquidGlassSetupExperience {...props} />
    case 'minimal':
    default: return <MinimalSetupExperience {...props} />
  }
}

function MinimalSetupExperience({ chrome, status, content, controls, composer }: ChatSetupThemeExperienceProps) {
  return (
    <View testID="chat-setup-experience-minimal" style={styles.root}>
      {chrome}
      {status}
      <View style={styles.canvas}>{content}</View>
      {controls}
      {composer}
    </View>
  )
}

function MonetSetupExperience({ colors, chrome, status, content, controls, composer }: ChatSetupThemeExperienceProps) {
  return (
    <View testID="chat-setup-experience-monet" style={styles.root}>
      {chrome}
      {status}
      <View style={styles.canvas}>
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.monetSkyWash, { backgroundColor: colors.ui.semantic.surface.muted }]} />
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.monetGroundWash, { backgroundColor: colors.ui.icon.accentBackground }]} />
        {content}
      </View>
      {controls}
      {composer}
    </View>
  )
}

function MaterialSetupExperience({ colors, chrome, status, content, controls, composer }: ChatSetupThemeExperienceProps) {
  return (
    <View testID="chat-setup-experience-material" style={styles.root}>
      {chrome}
      {status}
      <View style={[styles.canvas, { backgroundColor: colors.ui.semantic.surface.canvas }]}>{content}</View>
      {controls}
      {composer}
    </View>
  )
}

function LiquidGlassSetupExperience({ colors, chrome, status, content, controls, composer }: ChatSetupThemeExperienceProps) {
  return (
    <View testID="chat-setup-experience-liquid-glass" style={styles.root}>
      {chrome}
      {status}
      <View style={styles.canvas}>
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.glassEnvironmentTop, { backgroundColor: colors.ui.icon.accentBackground }]} />
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.glassEnvironmentBottom, { backgroundColor: colors.ui.control.primaryBackground }]} />
        {content}
      </View>
      {controls}
      {composer}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  canvas: { flex: 1, minWidth: 0, position: 'relative' },
  monetSkyWash: { position: 'absolute', top: -30, right: -40, width: 260, height: 150, borderBottomLeftRadius: 150, opacity: 0.2 },
  monetGroundWash: { position: 'absolute', bottom: -40, left: -50, width: 230, height: 170, borderTopRightRadius: 170, opacity: 0.14 },
  glassEnvironmentTop: { position: 'absolute', top: -60, right: -70, width: 300, height: 200, borderRadius: 200, opacity: 0.18 },
  glassEnvironmentBottom: { position: 'absolute', bottom: -90, left: -80, width: 280, height: 220, borderRadius: 220, opacity: 0.07 },
})
