import type { ReactNode } from 'react'
import { View } from 'react-native'

import type { useAppTheme } from '@/hooks/useAppTheme'
import type { CanonicalThemeId } from '@/types/settingsContracts'

type ChatThemeColors = ReturnType<typeof useAppTheme>['colors']

export interface ChatActiveThemeExperienceProps {
  /** Canonical family avoids the legacy presentation projection. */
  themeId: CanonicalThemeId
  colors: ChatThemeColors
  compactViewport: boolean
  documentMetadata: string
  documentTitle: string
  chrome: ReactNode
  status: ReactNode
  messageList: ReactNode
  controls: ReactNode
  composer: ReactNode
}

/**
 * Chat Home is one spatial model in every family:
 *
 *   application chrome  ->  continuous conversation canvas  ->  composer dock
 *
 * The canvas is the page. Families change the atmosphere behind it and the
 * material of the chrome, never the number of boxes stacked inside it, so the
 * message column always spans the full content width.
 */
export function ChatActiveThemeExperience(props: ChatActiveThemeExperienceProps) {
  switch (props.themeId) {
    case 'monet': return <MonetActiveExperience {...props} />
    case 'material': return <MaterialActiveExperience {...props} />
    case 'liquid-glass': return <LiquidGlassActiveExperience {...props} />
    case 'minimal':
    default: return <MinimalActiveExperience {...props} />
  }
}

function MinimalActiveExperience({ chrome, status, messageList, controls, composer }: ChatActiveThemeExperienceProps) {
  return (
    <View testID="chat-active-experience-minimal" style={styles.root}>
      {chrome}
      {status}
      <View style={styles.canvas}>{messageList}</View>
      {controls}
      {composer}
    </View>
  )
}

/** Monet keeps its atmosphere behind the canvas, not as panels inside it. */
function MonetActiveExperience({ colors, chrome, status, messageList, controls, composer }: ChatActiveThemeExperienceProps) {
  return (
    <View testID="chat-active-experience-monet" style={styles.root}>
      {chrome}
      {status}
      <View style={styles.canvas}>
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.monetSkyWash, { backgroundColor: colors.ui.semantic.surface.muted }]} />
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.monetGroundWash, { backgroundColor: colors.ui.icon.accentBackground }]} />
        {messageList}
      </View>
      {controls}
      {composer}
    </View>
  )
}

/**
 * Material 3 separates the top app bar from the canvas by tone. The canvas is
 * the base surface and owns no rails, gutters, or per-region containers.
 */
function MaterialActiveExperience({ colors, chrome, status, messageList, controls, composer }: ChatActiveThemeExperienceProps) {
  return (
    <View testID="chat-active-experience-material" style={styles.root}>
      {chrome}
      {status}
      <View style={[styles.canvas, { backgroundColor: colors.ui.semantic.surface.canvas }]}>{messageList}</View>
      {controls}
      {composer}
    </View>
  )
}

/**
 * Liquid Glass reads as environment -> glass chrome -> clear conversation ->
 * glass composer. The canvas contributes light, never another frame.
 */
function LiquidGlassActiveExperience({ colors, chrome, status, messageList, controls, composer }: ChatActiveThemeExperienceProps) {
  return (
    <View testID="chat-active-experience-liquid-glass" style={styles.root}>
      {chrome}
      {status}
      <View style={styles.canvas}>
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.glassEnvironmentTop, { backgroundColor: colors.ui.icon.accentBackground }]} />
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.glassEnvironmentBottom, { backgroundColor: colors.ui.control.primaryBackground }]} />
        {messageList}
      </View>
      {controls}
      {composer}
    </View>
  )
}

const styles = {
  root: { flex: 1 } as const,
  /** One continuous scroll surface per family; no inner column insets. */
  canvas: { flex: 1, minWidth: 0, position: 'relative' } as const,
  monetSkyWash: { position: 'absolute', top: -30, right: -40, width: 260, height: 150, borderBottomLeftRadius: 150, opacity: 0.2 } as const,
  monetGroundWash: { position: 'absolute', bottom: -40, left: -50, width: 230, height: 170, borderTopRightRadius: 170, opacity: 0.14 } as const,
  glassEnvironmentTop: { position: 'absolute', top: -60, right: -70, width: 300, height: 200, borderRadius: 200, opacity: 0.18 } as const,
  glassEnvironmentBottom: { position: 'absolute', bottom: -90, left: -80, width: 280, height: 220, borderRadius: 220, opacity: 0.07 } as const,
}
