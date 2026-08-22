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
      <View style={styles.contentFirst}>{messageList}</View>
      {controls}
      {composer}
    </View>
  )
}

function MonetActiveExperience({ colors, compactViewport, chrome, status, messageList, controls, composer }: ChatActiveThemeExperienceProps) {
  return (
    <View testID="chat-active-experience-monet" style={styles.root}>
      {chrome}
      {status}
      <View style={[styles.monetCanvas, { marginHorizontal: compactViewport ? 8 : 14, backgroundColor: colors.ui.semantic.surface.canvas, borderColor: colors.ui.semantic.chrome.border }]}>
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.monetCloud, { backgroundColor: colors.ui.semantic.surface.muted }]} />
        <View style={styles.monetMessageArea}>{messageList}</View>
      </View>
      {controls}
      {composer}
    </View>
  )
}

function MaterialActiveExperience({ colors, compactViewport, chrome, status, messageList, controls, composer }: ChatActiveThemeExperienceProps) {
  return (
    <View testID="chat-active-experience-material" style={styles.root}>
      {chrome}
      {status}
      <View style={[styles.materialCanvas, { marginHorizontal: compactViewport ? 6 : 12, backgroundColor: colors.ui.semantic.surface.muted, borderColor: colors.ui.semantic.chrome.border }]}>
        {messageList}
      </View>
      {controls}
      {composer}
    </View>
  )
}

function LiquidGlassActiveExperience({ colors, compactViewport, chrome, status, messageList, controls, composer }: ChatActiveThemeExperienceProps) {
  return (
    <View testID="chat-active-experience-liquid-glass" style={styles.root}>
      <View style={styles.glassChromeLayer}>{chrome}</View>
      {status}
      <View style={[styles.glassCanvas, { marginHorizontal: compactViewport ? 5 : 10, backgroundColor: colors.ui.semantic.surface.canvas }]}>
        {messageList}
      </View>
      {controls}
      <View style={styles.glassComposerLayer}>{composer}</View>
    </View>
  )
}

const styles = {
  root: { flex: 1 } as const,
  contentFirst: { flex: 1 } as const,
  monetCanvas: { flex: 1, position: 'relative', overflow: 'hidden', borderRadius: 24, borderWidth: 1 } as const,
  monetCloud: { position: 'absolute', top: 0, right: -18, width: 180, height: 110, borderBottomLeftRadius: 90, opacity: 0.34 } as const,
  monetMessageArea: { flex: 1, paddingHorizontal: 6 } as const,
  materialCanvas: { flex: 1, borderRadius: 16, borderWidth: 1, overflow: 'hidden' } as const,
  glassChromeLayer: { zIndex: 2 } as const,
  glassCanvas: { flex: 1, borderRadius: 26, overflow: 'hidden' } as const,
  glassComposerLayer: { zIndex: 2 } as const,
}
