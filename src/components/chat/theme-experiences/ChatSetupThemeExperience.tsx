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
      <View style={styles.contentFirst}>{content}</View>
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
      <View style={[styles.monetSetupCanvas, { backgroundColor: colors.material.canvas, borderColor: colors.material.stroke }]}>
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.monetSetupGlow, { backgroundColor: colors.ui.semantic.surface.muted }]} />
        <View style={styles.contentFirst}>{content}</View>
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
      <View style={[styles.materialSetupCanvas, { backgroundColor: colors.ui.semantic.surface.muted, borderColor: colors.ui.semantic.chrome.border }]}>
        <View style={styles.contentFirst}>{content}</View>
      </View>
      {controls}
      {composer}
    </View>
  )
}

function LiquidGlassSetupExperience({ colors, chrome, status, content, controls, composer }: ChatSetupThemeExperienceProps) {
  return (
    <View testID="chat-setup-experience-liquid-glass" style={styles.root}>
      <View style={styles.glassLayer}>{chrome}</View>
      {status}
      <View style={[styles.glassSetupCanvas, { backgroundColor: colors.ui.semantic.surface.canvas }]}>
        <View style={styles.contentFirst}>{content}</View>
      </View>
      {controls}
      <View style={styles.glassLayer}>{composer}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  contentFirst: { flex: 1 },
  monetSetupCanvas: { flex: 1, marginHorizontal: 10, paddingHorizontal: 8, borderRadius: 26, borderWidth: 1, overflow: 'hidden' },
  monetSetupGlow: { position: 'absolute', top: -24, right: -26, width: 170, height: 130, borderRadius: 80, opacity: 0.32 },
  materialSetupCanvas: { flex: 1, marginHorizontal: 6, paddingHorizontal: 4, borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  glassLayer: { zIndex: 2 },
  glassSetupCanvas: { flex: 1, marginHorizontal: 4, borderRadius: 26, overflow: 'hidden' },
})
