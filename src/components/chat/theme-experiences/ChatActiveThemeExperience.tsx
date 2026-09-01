import type { ReactNode } from 'react'
import { View } from 'react-native'

import type { useAppTheme } from '@/hooks/useAppTheme'
import type { CanonicalThemeId } from '@/types/settingsContracts'
import { GlassBackdropProvider, GlassBackdropTarget } from '../glass'

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
      <View style={styles.contentFirst}>{chrome}{status}{messageList}</View>
      {controls}
      {composer}
    </View>
  )
}

function MonetActiveExperience({ colors, chrome, status, messageList, controls, composer }: ChatActiveThemeExperienceProps) {
  return (
    <View testID="chat-active-experience-monet" style={styles.root}>
      <View style={styles.monetCanvas}>
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.monetCloud, { backgroundColor: colors.primary }]} />
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.monetCloudSecondary, { backgroundColor: colors.primary }]} />
        <View style={styles.monetChromeDrift}>{chrome}</View>
        <View style={styles.monetStatusDrift}>{status}</View>
        <View style={styles.monetMessageArea}>
          <View style={styles.monetMessageAreaCompact}>
            <View style={styles.monetMessageColumn}>{messageList}</View>
          </View>
        </View>
      </View>
      {controls}
      <View style={styles.monetComposerDock}>{composer}</View>
    </View>
  )
}

function MaterialActiveExperience({ colors, chrome, status, messageList, controls, composer }: ChatActiveThemeExperienceProps) {
  return (
    <View testID="chat-active-experience-material" style={styles.root}>
      <View style={styles.materialTopAppBar}>{chrome}</View>
      <View style={styles.materialStatusBand}>{status}</View>
      <View style={styles.materialCanvas}>
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.materialWorkspaceRail, { backgroundColor: colors.ui.actionBar.itemBorder }]} />
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.materialRailMarker, { backgroundColor: colors.primary }]} />
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.materialRailMarkerShort, { backgroundColor: colors.primary }]} />
        <View style={styles.materialMessageColumn}>{messageList}</View>
      </View>
      {controls}
      <View style={styles.materialComposerDock}>{composer}</View>
    </View>
  )
}

function LiquidGlassActiveExperience({ colors, chrome, status, messageList, controls, composer }: ChatActiveThemeExperienceProps) {
  return (
    <GlassBackdropProvider>
      <View testID="chat-active-experience-liquid-glass" style={styles.root}>
        <View style={styles.glassChromeLayer}>{chrome}</View>
        <View style={styles.glassStatusLayer}>{status}</View>
        <View style={styles.glassCanvas}>
          <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.glassReadingAperture, { borderColor: colors.ui.actionBar.itemBorder }]} />
          <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.glassReadingHighlight, { backgroundColor: colors.ui.control.primaryForeground }]} />
          <GlassBackdropTarget style={styles.glassMessageColumnWrap}>
            <View style={styles.glassMessageColumn}>{messageList}</View>
          </GlassBackdropTarget>
        </View>
        {controls}
        <View style={styles.glassComposerLayer}>{composer}</View>
      </View>
    </GlassBackdropProvider>
  )
}

const styles = {
  root: { flex: 1 } as const,
  contentFirst: { flex: 1 } as const,
  // Keep these wrappers for layout ownership, but let message/chrome
  // primitives carry the visual surface instead of painting another card.
  monetCanvas: { flex: 1, position: 'relative', overflow: 'hidden' } as const,
  monetChromeDrift: { zIndex: 2 } as const,
  // Background scenery sits behind the message flow and stays weak enough to
  // never compete with content opacity or fill the gutters beside the text.
  monetCloud: { position: 'absolute', top: -8, right: -30, width: 190, height: 94, borderBottomLeftRadius: 94, opacity: 0.07 } as const,
  monetCloudSecondary: { position: 'absolute', bottom: 18, left: -42, width: 150, height: 82, borderTopRightRadius: 82, opacity: 0.05 } as const,
  monetCanvasPlane: { display: 'none' } as const,
  // One shared reading column: the ambient canvas no longer borrows list width.
  monetMessageArea: { flex: 1 } as const,
  // Keep the FlashList constrained to the viewport. Without an explicit
  // flexing/min-height contract this wrapper grows to the full transcript
  // height and removes the scroll viewport in React Native Web.
  monetMessageAreaCompact: { flex: 1, minHeight: 0 } as const,
  monetMessageColumn: { flex: 1, minWidth: 0 } as const,
  monetMessageColumnCompact: {} as const,
  monetStatusDrift: {} as const,
  monetComposerDock: {} as const,
  materialTopAppBar: { zIndex: 2, paddingBottom: 2 } as const,
  materialStatusBand: { paddingHorizontal: 4 } as const,
  materialCanvas: { flex: 1, position: 'relative', overflow: 'hidden' } as const,
  materialWorkspaceRail: { display: 'none' } as const,
  materialRailMarker: {} as const,
  materialRailMarkerShort: {} as const,
  // Assistant content owns the full list width; the rail markers carried no
  // navigation semantics and only narrowed the reading column.
  materialMessageColumn: { flex: 1, minWidth: 0 } as const,
  materialComposerDock: {} as const,
  glassChromeLayer: { zIndex: 2 } as const,
  glassStatusLayer: { zIndex: 1, paddingHorizontal: 4 } as const,
  glassCanvas: { flex: 1, position: 'relative' } as const,
  glassMessageColumnWrap: { flex: 1 } as const,
  glassMessageColumn: { flex: 1, minWidth: 0, marginHorizontal: 4 } as const,
  glassReadingAperture: { display: 'none' } as const,
  glassReadingHighlight: { display: 'none' } as const,
  glassComposerLayer: { zIndex: 2 } as const,
}
