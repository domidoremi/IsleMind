import type { ReactNode } from 'react'
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native'
import { MotiView } from 'moti'
import { Easing } from 'react-native-reanimated'

import type { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference, type MotionIntensity } from '@/hooks/useMotionPreference'
import type { CanonicalThemeId } from '@/types/settingsContracts'
import { resolveThemeExpression, type ThemeComponentId, type ThemeExpression } from '@/theme/themeExpression'
import type { ThemeSurfaceMaterialToken } from '@/theme/themeTokens'

type ThemeColors = ReturnType<typeof useAppTheme>['colors']
export type ThemeExpressionSurfaceKind = 'composer' | 'chrome' | 'message' | 'message-content' | 'markdown' | 'code-block'

export interface ThemeExpressionSurfaceProps {
  family: CanonicalThemeId
  colors: ThemeColors
  kind: ThemeExpressionSurfaceKind
  children: ReactNode
  horizontalPadding?: number
  isUser?: boolean
  selected?: boolean
  alertBorder?: string
  onLayout?: (event: LayoutChangeEvent) => void
  testID?: string
  /** Resolved motion preference; glass flowing light only runs at full motion. */
  motion?: MotionIntensity
}

const COMPONENT_BY_SURFACE: Record<ThemeExpressionSurfaceKind, ThemeComponentId> = {
  composer: 'composer',
  chrome: 'navigation',
  message: 'chatMessage',
  'message-content': 'aiResponse',
  markdown: 'markdown',
  'code-block': 'codeBlock',
}

function componentIdForSurface(props: ThemeExpressionSurfaceProps): ThemeComponentId {
  if (props.kind === 'message' && props.isUser) return 'userMessage'
  return COMPONENT_BY_SURFACE[props.kind]
}

type Renderer = (props: ThemeExpressionSurfaceProps, expression: ThemeExpression) => ReactNode

function rgbaColor(color: string, alpha: number): string {
  const clamped = Math.max(0, Math.min(1, alpha))
  const hex = color.trim().match(/^#([0-9a-f]{3,8})$/i)?.[1]
  if (hex) {
    const expanded = hex.length === 3
      ? hex.split('').map((part) => `${part}${part}`).join('')
      : hex.slice(0, 6)
    const channels = [0, 2, 4].map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16))
    if (channels.every(Number.isFinite)) return `rgba(${channels.join(', ')}, ${clamped})`
  }
  const rgb = color.match(/^rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)/i)
  if (rgb) return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${clamped})`
  return color
}

function surfaceMaterialFor(props: ThemeExpressionSurfaceProps): ThemeSurfaceMaterialToken {
  const surface = props.colors.design?.semantic.surface
  if (surface) {
    if (props.kind === 'chrome' || props.kind === 'composer') return surface.chrome
    if (props.kind === 'code-block') {
      return {
        ...surface.elevated,
        background: props.colors.ui.code.background,
        foreground: props.colors.ui.code.text,
        border: props.colors.ui.code.border,
      }
    }
    return surface.conversation
  }
  return {
    background: props.kind === 'chrome' || props.kind === 'composer'
      ? props.colors.ui.semantic.chrome.background
      : props.kind === 'code-block'
        ? props.colors.ui.semantic.surface.raised
        : 'transparent',
    foreground: props.colors.text,
    border: props.colors.ui.semantic.chrome.border,
    highlight: 'transparent',
    blurRadius: 0,
    saturation: 1,
    shadowColor: props.colors.shadowTint,
    shadowOpacity: 0,
    shadowBlur: 0,
    shadowOffsetY: 0,
    elevation: 0,
  }
}

/**
 * One renderer contract, four expression grammars. Business children and
 * accessibility state stay outside this layer; only the visual composition is
 * selected here.
 */
const RENDERERS: Record<CanonicalThemeId, Renderer> = {
  minimal: renderMinimal,
  monet: renderMonet,
  material: renderMaterial,
  'liquid-glass': renderLiquidGlass,
}

export function ThemeExpressionSurface(props: ThemeExpressionSurfaceProps) {
  const expression = resolveThemeExpression(props.family)
  const motion = useMotionPreference()
  const testID = props.testID ?? `theme-expression-${props.kind}-${props.family}`
  return RENDERERS[props.family]({ ...props, motion, testID, children: props.children }, expression)
}

function renderMinimal(props: ThemeExpressionSurfaceProps, expression: ThemeExpression) {
  const component = expression.components[componentIdForSurface(props)]
  const material = surfaceMaterialFor(props)
  const isMessage = props.kind === 'message'
  const isContent = props.kind === 'message-content'
  const isMarkdown = props.kind === 'markdown'
  const isCodeBlock = props.kind === 'code-block'
  const isChrome = props.kind === 'chrome'
  const userMessage = isMessage && props.isUser
  const contentBackground = isCodeBlock && props.isUser
      ? props.colors.ui.message.userActionBackground
      : userMessage
        ? props.colors.ui.message.userBackground
        : material.background
  const ownsMaterial = isChrome || props.kind === 'composer' || isCodeBlock || userMessage
  return (
    <View
      testID={props.testID}
      onLayout={props.onLayout}
      style={[
        styles.minimalBase,
        isMessage && props.isUser ? styles.minimalUserMessage : null,
        isMessage && !props.isUser ? styles.minimalAssistantMessage : null,
        isContent ? styles.minimalContent : null,
        isMarkdown ? styles.minimalMarkdown : null,
        isCodeBlock ? styles.minimalCodeBlock : null,
        isChrome ? styles.minimalChrome : null,
        props.kind === 'composer' ? styles.minimalComposer : null,
        {
          backgroundColor: contentBackground,
          borderColor: props.alertBorder ?? material.border,
          borderWidth: props.selected ? 2 : ownsMaterial && material.border !== 'transparent' ? StyleSheet.hairlineWidth : component.border === 'divider' && isCodeBlock ? StyleSheet.hairlineWidth : 0,
          shadowColor: material.shadowColor,
          shadowOpacity: ownsMaterial ? material.shadowOpacity : 0,
          shadowRadius: ownsMaterial ? material.shadowBlur : 0,
          shadowOffset: { width: 0, height: ownsMaterial ? material.shadowOffsetY : 0 },
          elevation: ownsMaterial ? material.elevation : 0,
        },
      ]}
    >
      {isMessage && props.isUser ? (
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.minimalMessageIndex, { backgroundColor: props.colors.ui.control.primaryBackground }]} />
      ) : null}
      {props.children}
    </View>
  )
}

function renderMonet(props: ThemeExpressionSurfaceProps, expression: ThemeExpression) {
  const component = expression.components[componentIdForSurface(props)]
  const material = surfaceMaterialFor(props)
  const isMessage = props.kind === 'message'
  const isContent = props.kind === 'message-content'
  const isMarkdown = props.kind === 'markdown'
  const isCodeBlock = props.kind === 'code-block'
  const isChrome = props.kind === 'chrome'
  const isNestedRichContent = props.kind === 'code-block'
  const isAssistantMessage = isMessage && !props.isUser
  const ownsMaterial = isChrome || props.kind === 'composer' || isCodeBlock || (isMessage && props.isUser)
  const contentFrame = (
    <View style={[
      styles.monetContentFrame,
      props.kind === 'composer' ? styles.monetComposerFrame : null,
      isMessage && !props.isUser ? styles.monetAssistantContentFrame : null,
      isMessage && props.isUser ? styles.monetUserContentFrame : null,
    ]}>
      {props.children}
    </View>
  )
  return (
    <View
      testID={props.testID}
      onLayout={props.onLayout}
      style={[
        styles.monetBase,
        isContent ? styles.monetContent : null,
        isMarkdown ? styles.monetMarkdown : null,
        isCodeBlock ? styles.monetCodeBlock : null,
        isChrome ? styles.monetChrome : null,
        isMessage && props.isUser ? styles.monetUserMessage : null,
        isMessage && !props.isUser ? styles.monetAssistantMessage : null,
        props.kind === 'composer' ? styles.monetComposer : null,
        {
          backgroundColor: isContent || isMarkdown || isAssistantMessage
            ? 'transparent'
            : isMessage && props.isUser
              ? rgbaColor(props.colors.ui.message.userBackground, 0.9)
              : isNestedRichContent && props.isUser
                ? props.colors.ui.message.userActionBackground
                : material.background,
          borderColor: props.alertBorder ?? material.border,
          borderWidth: isContent || isMarkdown || isAssistantMessage ? 0 : props.selected ? 2 : ownsMaterial && material.border !== 'transparent' ? StyleSheet.hairlineWidth : component.border === 'none' ? 0 : StyleSheet.hairlineWidth,
          shadowColor: material.shadowColor,
          shadowOpacity: ownsMaterial ? material.shadowOpacity : 0,
          shadowRadius: ownsMaterial ? material.shadowBlur : 0,
          shadowOffset: { width: 0, height: ownsMaterial ? material.shadowOffsetY : 0 },
          elevation: ownsMaterial ? material.elevation : 0,
        },
      ]}
    >
      {isMessage && props.isUser ? (
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.monetPaperWash, { backgroundColor: props.colors.ui.icon.accentBackground }]} />
      ) : null}
      {isMessage && props.isUser ? (
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.monetPaperWashSecondary, { backgroundColor: props.colors.ui.semantic.surface.muted }]} />
      ) : null}
      {isMessage ? (
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.monetMessageBrush, props.isUser ? styles.monetMessageBrushUser : styles.monetMessageBrushAssistant, { backgroundColor: props.isUser ? props.colors.accent : props.colors.primary }]} />
      ) : null}
      {contentFrame}
    </View>
  )
}

function renderMaterial(props: ThemeExpressionSurfaceProps, expression: ThemeExpression) {
  const component = expression.components[componentIdForSurface(props)]
  const material = surfaceMaterialFor(props)
  const isMessage = props.kind === 'message'
  const isContent = props.kind === 'message-content'
  const isMarkdown = props.kind === 'markdown'
  const isCodeBlock = props.kind === 'code-block'
  const isChrome = props.kind === 'chrome'
  const isNestedRichContent = props.kind === 'code-block'
  const ownsMaterial = isChrome || props.kind === 'composer' || isCodeBlock || (isMessage && props.isUser)
  return (
    <View
      testID={props.testID}
      onLayout={props.onLayout}
      style={[
        styles.materialBase,
        isContent ? styles.materialContent : null,
        isMarkdown ? styles.materialMarkdown : null,
        isCodeBlock ? styles.materialCodeBlock : null,
        isChrome ? styles.materialChrome : null,
        isMessage && props.isUser ? styles.materialUserMessage : null,
        isMessage && !props.isUser ? styles.materialAssistantMessage : null,
        props.kind === 'composer' ? styles.materialComposer : null,
        {
          backgroundColor: isContent || isMarkdown
            ? 'transparent'
            : isMessage && props.isUser
              ? props.colors.ui.message.userBackground
              : isNestedRichContent && props.isUser
                ? props.colors.ui.message.userActionBackground
                : isMessage
                  ? 'transparent'
                  : material.background,
          borderColor: props.alertBorder ?? material.border,
          borderWidth: isContent || isMarkdown || isMessage && !props.isUser ? 0 : props.selected ? 2 : ownsMaterial && material.border !== 'transparent' ? StyleSheet.hairlineWidth : component.border === 'none' ? 0 : StyleSheet.hairlineWidth,
          shadowColor: material.shadowColor,
          shadowOpacity: ownsMaterial ? material.shadowOpacity : 0,
          shadowRadius: ownsMaterial ? material.shadowBlur : 0,
          shadowOffset: { width: 0, height: ownsMaterial ? material.shadowOffsetY : 0 },
          elevation: ownsMaterial ? material.elevation : 0,
        },
      ]}
    >
      <View style={[
        styles.materialContentFrame,
        props.kind === 'composer' ? styles.materialComposerFrame : null,
        isMessage && props.isUser ? styles.materialUserContentFrame : null,
        isMessage && !props.isUser ? styles.materialAssistantContentFrame : null,
      ]}>
        {props.children}
      </View>
    </View>
  )
}

function renderLiquidGlass(props: ThemeExpressionSurfaceProps, _expression: ThemeExpression) {
  const material = surfaceMaterialFor(props)
  const isMessage = props.kind === 'message'
  const isContent = props.kind === 'message-content'
  const isMarkdown = props.kind === 'markdown'
  const isCodeBlock = props.kind === 'code-block'
  const isNestedRichContent = props.kind === 'code-block'
  // Only top-level chrome is a live lens. Rich reading surfaces stay opaque,
  // and message bodies remain on the ambient conversation plane.
  const glassLens = props.kind === 'chrome' || props.kind === 'composer'
  const userSurface = rgbaColor(props.colors.ui.message.userBackground, 0.74)
  // Flowing light drifts only on the single chrome/composer lenses; code
  // blocks keep a static band so long lists never animate per block.
  const flowingLight = (props.kind === 'chrome' || props.kind === 'composer') && props.motion === 'full'
  const refractionBand = flowingLight ? (
    <MotiView
      accessible={false}
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      from={{ translateX: -8 }}
      animate={{ translateX: 8 }}
      transition={{ type: 'timing', duration: 6400, easing: Easing.inOut(Easing.quad), loop: true }}
      style={[styles.glassRefractionBand, { backgroundColor: material.highlight }]}
    />
  ) : (
    <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.glassRefractionBand, { backgroundColor: material.highlight }]} />
  )
  return (
    <View
      testID={props.testID}
      onLayout={props.onLayout}
      style={[
        styles.glassBase,
        isContent ? styles.glassContent : null,
        isMarkdown ? styles.glassMarkdown : null,
        isCodeBlock ? styles.glassCodeBlock : null,
        props.kind === 'chrome' ? styles.glassChrome : null,
        isMessage && props.isUser ? styles.glassUserMessage : null,
        isMessage && !props.isUser ? styles.glassAssistantMessage : null,
        props.kind === 'composer' ? styles.glassComposer : null,
        {
          backgroundColor: isContent || isMarkdown ? 'transparent' : isMessage && props.isUser ? userSurface : isNestedRichContent && props.isUser ? rgbaColor(props.colors.ui.message.userActionBackground, 0.74) : material.background,
          borderColor: props.alertBorder ?? material.border,
          borderWidth: isContent || isMarkdown || isMessage && !props.isUser ? 0 : props.selected ? 2 : material.border !== 'transparent' ? StyleSheet.hairlineWidth : 0,
          shadowColor: material.shadowColor,
          shadowOpacity: glassLens || isCodeBlock || isMessage && props.isUser ? material.shadowOpacity : 0,
          shadowRadius: glassLens || isCodeBlock || isMessage && props.isUser ? material.shadowBlur : 0,
          shadowOffset: { width: 0, height: glassLens || isCodeBlock || isMessage && props.isUser ? material.shadowOffsetY : 0 },
          elevation: glassLens || isCodeBlock ? material.elevation : 0,
        },
      ]}
    >
      {glassLens ? refractionBand : null}
      {glassLens ? <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.glassSpecularLine, { backgroundColor: material.highlight }]} /> : null}
      <View style={[
        styles.glassContentFrame,
        props.kind === 'composer' ? styles.glassComposerFrame : null,
        isMessage && props.isUser ? styles.glassUserContentFrame : null,
        isMessage && !props.isUser ? styles.glassAssistantContentFrame : null,
      ]}>
        {props.children}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  minimalBase: { minHeight: 44, minWidth: 0, maxWidth: '100%', justifyContent: 'center', position: 'relative' },
  minimalUserMessage: { alignSelf: 'flex-end', maxWidth: '76%', paddingHorizontal: 4, paddingVertical: 8, borderRadius: 0 },
  minimalAssistantMessage: { width: '100%', paddingVertical: 8, paddingLeft: 2, paddingRight: 2 },
  minimalContent: { width: '100%', minWidth: 0, maxWidth: '100%', gap: 5, minHeight: 0, overflow: 'hidden' },
  minimalMarkdown: { width: '100%', minWidth: 0, maxWidth: '100%', minHeight: 0, justifyContent: 'flex-start', overflow: 'hidden' },
  minimalCodeBlock: { width: '100%', minHeight: 0, borderRadius: 4, padding: 0 },
  minimalChrome: { minHeight: 50, paddingHorizontal: 0, paddingVertical: 0, borderRadius: 6, overflow: 'hidden' },
  minimalComposer: { paddingHorizontal: 8, paddingVertical: 7, borderRadius: 6, overflow: 'hidden' },
  minimalMessageIndex: { position: 'absolute', top: 0, right: 0, width: 24, height: 2 },
  monetBase: { minHeight: 48, minWidth: 0, maxWidth: '100%', justifyContent: 'center', overflow: 'hidden', borderTopLeftRadius: 16, borderTopRightRadius: 9, borderBottomRightRadius: 18, borderBottomLeftRadius: 11, paddingHorizontal: 11, paddingVertical: 8 },
  monetChrome: { minHeight: 50, paddingHorizontal: 0, paddingVertical: 0, borderRadius: 14 },
  monetComposer: { marginHorizontal: 0, paddingHorizontal: 8, paddingVertical: 7, borderRadius: 14 },
  monetUserMessage: { alignSelf: 'flex-end', maxWidth: '84%', marginRight: 4, borderTopLeftRadius: 22, borderTopRightRadius: 10, borderBottomRightRadius: 9, borderBottomLeftRadius: 16 },
  // Assistant replies stay on the shared reading column: transparent flow plus
  // one identity accent instead of an inset card per message.
  monetAssistantMessage: { width: '100%', alignSelf: 'flex-start', marginTop: 2, marginBottom: 2, paddingHorizontal: 0, paddingTop: 8, paddingBottom: 4 },
  monetContent: { width: '100%', minWidth: 0, maxWidth: '100%', gap: 8, minHeight: 0, paddingHorizontal: 0, paddingVertical: 0, borderRadius: 0, overflow: 'hidden' },
  monetMarkdown: { width: '100%', minWidth: 0, maxWidth: '100%', minHeight: 0, justifyContent: 'flex-start', borderRadius: 0, paddingHorizontal: 0, paddingVertical: 0, overflow: 'hidden' },
  monetCodeBlock: { width: '100%', minHeight: 0, borderTopLeftRadius: 9, borderTopRightRadius: 7, borderBottomRightRadius: 15, borderBottomLeftRadius: 8, padding: 0 },
  monetAssistantFlow: { width: '100%', alignItems: 'stretch' },
  monetContentFrame: { position: 'relative', zIndex: 1 },
  // User bubbles keep a small left inset so rounded-corner clipping never
  // touches the first text line; assistant content owns the full column.
  monetUserContentFrame: { minWidth: 0, paddingLeft: 3, paddingRight: 2 },
  monetAssistantContentFrame: { paddingHorizontal: 0 },
  monetComposerFrame: { paddingTop: 0 },
  monetPaperWash: { position: 'absolute', top: -24, right: -22, width: 124, height: 76, borderBottomLeftRadius: 66, opacity: 0.2 },
  monetPaperWashSecondary: { position: 'absolute', right: -18, bottom: 4, width: 116, height: 28, borderRadius: 7, opacity: 0.13, transform: [{ rotate: '-7deg' }] },
  monetMessageBrush: { position: 'absolute', opacity: 0.4 },
  monetMessageBrushUser: { right: 8, bottom: 4, width: 34, height: 3, borderRadius: 2 },
  monetMessageBrushAssistant: { top: 6, left: 5, width: 18, height: 3, borderRadius: 2 },
  monetComposerPigmentRow: { position: 'absolute', top: 5, right: 18, left: 18, height: 3, flexDirection: 'row', gap: 5, opacity: 0.55 },
  monetComposerPigmentLong: { flex: 1, borderRadius: 2 },
  monetComposerPigmentShort: { width: 30, borderRadius: 2 },
  materialBase: { minHeight: 48, minWidth: 0, maxWidth: '100%', justifyContent: 'center', overflow: 'hidden', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  materialChrome: { minHeight: 50, borderRadius: 12, paddingHorizontal: 0, paddingVertical: 0 },
  materialComposer: { marginHorizontal: 0, paddingHorizontal: 8, paddingVertical: 7, borderRadius: 12 },
  materialUserMessage: { alignSelf: 'flex-end', maxWidth: '78%', marginRight: 4, borderTopLeftRadius: 20, borderTopRightRadius: 5, borderBottomRightRadius: 20, borderBottomLeftRadius: 20, paddingHorizontal: 15, paddingVertical: 10 },
  // Assistant replies share the reading column with a single tonal wash; no
  // per-message card, no inset margins, no decorative indicator rail.
  materialAssistantMessage: { width: '100%', alignSelf: 'flex-start', marginTop: 2, marginBottom: 2, borderRadius: 12, paddingHorizontal: 0, paddingTop: 9, paddingBottom: 4, backgroundColor: 'transparent' },
  materialContent: { width: '100%', minWidth: 0, maxWidth: '100%', gap: 6, minHeight: 0, paddingHorizontal: 0, paddingVertical: 0, borderRadius: 0, overflow: 'hidden' },
  materialMarkdown: { width: '100%', minWidth: 0, maxWidth: '100%', minHeight: 0, justifyContent: 'flex-start', borderRadius: 0, paddingHorizontal: 0, paddingVertical: 0, overflow: 'hidden' },
  materialCodeBlock: { width: '100%', minHeight: 0, borderRadius: 12, padding: 0 },
  materialStateLayer: { ...StyleSheet.absoluteFill, opacity: 0.04 },
  materialTopEdge: { position: 'absolute', top: 0, right: 18, left: 18, height: StyleSheet.hairlineWidth, opacity: 0.18 },
  materialComposerRail: { position: 'absolute', top: 8, bottom: 8, left: 0, width: 3, borderRadius: 2, opacity: 0.78 },
  materialCodeGutter: { position: 'absolute', top: 0, bottom: 0, left: 0, width: 28, borderRightWidth: StyleSheet.hairlineWidth, opacity: 0.72 },
  materialContentFrame: { position: 'relative', zIndex: 1 },
  materialComposerFrame: { paddingTop: 0 },
  materialUserContentFrame: { minWidth: 0, paddingLeft: 3, paddingRight: 2 },
  materialAssistantContentFrame: { paddingHorizontal: 0 },
  materialCodeContentFrame: { paddingLeft: 30 },
  glassBase: { minHeight: 50, minWidth: 0, maxWidth: '100%', justifyContent: 'center', overflow: 'hidden', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, position: 'relative' },
  glassChrome: { minHeight: 50, paddingHorizontal: 0, paddingVertical: 0, borderRadius: 16 },
  glassComposer: { marginHorizontal: 0, paddingHorizontal: 8, paddingVertical: 7, borderRadius: 16 },
  glassUserMessage: { alignSelf: 'flex-end', maxWidth: '80%', marginRight: 4, marginVertical: 4, borderRadius: 20 },
  glassAssistantMessage: { width: '100%', alignSelf: 'flex-start', marginTop: 2, marginBottom: 2, borderRadius: 14, paddingHorizontal: 0, paddingTop: 8, paddingBottom: 4, backgroundColor: 'transparent' },
  glassContent: { width: '100%', minWidth: 0, maxWidth: '100%', gap: 8, minHeight: 0, paddingHorizontal: 0, paddingVertical: 0, borderRadius: 0, overflow: 'hidden' },
  glassMarkdown: { width: '100%', minWidth: 0, maxWidth: '100%', minHeight: 0, justifyContent: 'flex-start', borderRadius: 0, paddingHorizontal: 0, paddingVertical: 0, overflow: 'hidden' },
  glassCodeBlock: { width: '100%', minHeight: 0, borderRadius: 14, padding: 0 },
  glassInnerPlane: { position: 'absolute', top: 2, right: 2, bottom: 2, left: 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, opacity: 0.28 },
  glassReadingPlane: { top: 3, right: 3, bottom: 3, left: 3, opacity: 0.36 },
  glassReadingBacking: { position: 'absolute', top: 4, right: 4, bottom: 4, left: 4, borderRadius: 12, opacity: 0.38 },
  glassSpecularLine: { position: 'absolute', top: 2, right: 18, left: 18, height: StyleSheet.hairlineWidth, opacity: 0.48 },
  glassRefractionBand: { position: 'absolute', top: -22, right: -36, width: '72%', height: 34, opacity: 0.12, transform: [{ rotate: '-14deg' }] },
  glassLowerShade: { position: 'absolute', right: -20, bottom: -24, left: -20, height: 44, opacity: 0.035, transform: [{ rotate: '-4deg' }] },
  glassContentFrame: { position: 'relative', zIndex: 1 },
  glassComposerFrame: { paddingHorizontal: 0, paddingVertical: 0 },
  glassUserContentFrame: { minWidth: 0, paddingLeft: 3, paddingRight: 2 },
  glassAssistantContentFrame: { paddingHorizontal: 0 },
})
