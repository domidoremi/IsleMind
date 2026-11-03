import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'

import type { useAppTheme } from '@/hooks/useAppTheme'
import type { CanonicalThemeId } from '@/types/settingsContracts'

type ChatThemeColors = ReturnType<typeof useAppTheme>['colors']

export interface ChatSetupThemeExperienceProps {
  /** Canonical family shared by settings, tokens, and presentation. */
  themeId: CanonicalThemeId
  colors: ChatThemeColors
  compactViewport: boolean
  chrome: ReactNode
  status: ReactNode
  content: ReactNode
  controls: ReactNode
  composer: ReactNode
}

export function ChatSetupThemeExperience({ themeId, chrome, status, content, controls, composer }: ChatSetupThemeExperienceProps) {
  // Slot ancestry is stable: changing material cannot replace a live composer.
  return (
    <View testID={`chat-setup-experience-${themeId}`} style={styles.root}>
      {chrome}
      <View pointerEvents="box-none" style={styles.statusLayer}>{status}</View>
      <View testID="chat-entry-canvas" style={[styles.canvas, { paddingHorizontal: themeId === 'material' ? 14 : themeId === 'liquid-glass' ? 7 : 0 }]}>
        {content}
      </View>
      {controls}
      <View pointerEvents="box-none" style={styles.composerLayer}>{composer}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  canvas: { flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden' },
  statusLayer: { ...StyleSheet.absoluteFill, zIndex: 1 },
  composerLayer: { ...StyleSheet.absoluteFill, zIndex: 2 },
})
