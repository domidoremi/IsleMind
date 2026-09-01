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
      <View style={styles.monetChromeDrift}>{chrome}</View>
      <View style={styles.monetSetupCanvas}>
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.monetSetupGlow, { backgroundColor: colors.ui.semantic.surface.muted }]} />
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.monetSetupGlowSecondary, { backgroundColor: colors.ui.icon.accentBackground }]} />
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.monetSetupPlane, { backgroundColor: colors.ui.semantic.surface.base }]} />
        <View style={styles.monetSetupContent}>
          <View style={styles.monetStatusDrift}>{status}</View>
          <View style={styles.contentFirst}>{content}</View>
        </View>
      </View>
      {controls}
      <View style={styles.monetComposerDock}>{composer}</View>
    </View>
  )
}

function MaterialSetupExperience({ colors, chrome, status, content, controls, composer }: ChatSetupThemeExperienceProps) {
  return (
    <View testID="chat-setup-experience-material" style={styles.root}>
      <View style={[styles.materialTopAppBar, { backgroundColor: colors.ui.semantic.surface.muted }]}>
        {chrome}
        <View style={styles.materialStatusBand}>{status}</View>
      </View>
      <View style={styles.materialSetupCanvas}>
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={styles.materialSetupRail}>
          <View style={[styles.materialRailMarker, { backgroundColor: colors.ui.actionBar.itemActiveBackground }]} />
          <View style={[styles.materialRailMarkerShort, { backgroundColor: colors.ui.semantic.chrome.border }]} />
          <View style={[styles.materialRailMarker, { backgroundColor: colors.ui.semantic.chrome.border }]} />
        </View>
        <View style={styles.materialSetupColumn}>{content}</View>
      </View>
      {controls}
      <View style={styles.materialComposerDock}>{composer}</View>
    </View>
  )
}

function LiquidGlassSetupExperience({ colors, chrome, status, content, controls, composer }: ChatSetupThemeExperienceProps) {
  return (
    <View testID="chat-setup-experience-liquid-glass" style={styles.root}>
      <View style={styles.glassLayer}>{chrome}</View>
      <View style={styles.glassStatusLayer}>{status}</View>
      <View style={styles.glassSetupCanvas}>
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.glassSetupAperture, { borderColor: colors.ui.actionBar.itemBorder }]} />
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.glassSetupHighlight, { backgroundColor: colors.ui.control.primaryForeground }]} />
        <View style={styles.glassSetupColumn}>{content}</View>
      </View>
      {controls}
      <View style={styles.glassLayer}>{composer}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  contentFirst: { flex: 1 },
  monetChromeDrift: { marginHorizontal: 2 },
  monetSetupCanvas: { flex: 1, position: 'relative', overflow: 'hidden' },
  monetSetupGlow: { position: 'absolute', top: -30, right: -34, width: 210, height: 124, borderBottomLeftRadius: 108, opacity: 0.16 },
  monetSetupGlowSecondary: { position: 'absolute', bottom: 18, left: -42, width: 180, height: 98, borderTopRightRadius: 96, opacity: 0.12 },
  monetSetupPlane: { position: 'absolute', top: '25%', right: '5%', bottom: '30%', left: '5%', borderTopLeftRadius: 38, borderBottomRightRadius: 56, opacity: 0.16, transform: [{ rotate: '1deg' }] },
  monetSetupContent: { flex: 1, marginLeft: 8 },
  monetStatusDrift: { marginLeft: -6, marginRight: 12 },
  monetComposerDock: { marginHorizontal: 3 },
  materialTopAppBar: { zIndex: 2, paddingBottom: 2 },
  materialStatusBand: { paddingHorizontal: 4 },
  materialSetupCanvas: { flex: 1, position: 'relative', overflow: 'hidden', paddingLeft: 24 },
  materialSetupRail: { position: 'absolute', top: 12, bottom: 12, left: 5, width: 12, alignItems: 'center', justifyContent: 'space-between', opacity: 0.84 },
  materialRailMarker: { width: 8, height: 26, borderRadius: 4 },
  materialRailMarkerShort: { width: 8, height: 8, borderRadius: 4 },
  materialSetupColumn: { flex: 1, minWidth: 0, paddingLeft: 4 },
  materialComposerDock: { paddingHorizontal: 2 },
  glassLayer: { zIndex: 2 },
  glassStatusLayer: { zIndex: 1, paddingHorizontal: 4 },
  glassSetupCanvas: { flex: 1, position: 'relative', overflow: 'hidden', paddingHorizontal: 3 },
  glassSetupColumn: { flex: 1, minWidth: 0, marginHorizontal: 8, paddingHorizontal: 4, borderLeftWidth: 1, borderRightWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  glassSetupAperture: { position: 'absolute', top: 4, right: 2, bottom: 4, left: 2, borderWidth: 1, borderRadius: 22, opacity: 0.22 },
  glassSetupHighlight: { position: 'absolute', top: 5, right: 44, left: 44, height: 1, opacity: 0.34 },
})
