import type { ReactNode } from 'react'
import { Platform, StyleSheet, View, type LayoutChangeEvent, type ViewStyle } from 'react-native'

import type { useAppTheme } from '@/hooks/useAppTheme'
import type { CanonicalThemeId } from '@/types/settingsContracts'
import { resolveThemeExpression, type ThemeComponentId, type ThemeExpression } from '@/theme/themeExpression'

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
}

/**
 * Surface roles, not one box per component.
 *
 * Chat Home paints exactly three regions: the application chrome band, the
 * conversation canvas, and the composer dock. Assistant turns live inside the
 * canvas and paint nothing. Only user turns and genuinely nested rich content
 * own a surface. Families differ by how those regions are rendered, never by
 * adding another card per component.
 */
export type ThemeSurfaceRole = 'chrome' | 'composer' | 'assistant' | 'user' | 'flow' | 'block'

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

export function resolveThemeSurfaceRole(props: Pick<ThemeExpressionSurfaceProps, 'kind' | 'isUser'>): ThemeSurfaceRole {
  if (props.kind === 'chrome') return 'chrome'
  if (props.kind === 'composer') return 'composer'
  if (props.kind === 'code-block') return 'block'
  if (props.kind === 'message') return props.isUser ? 'user' : 'assistant'
  return 'flow'
}

type Renderer = (props: ThemeExpressionSurfaceProps, expression: ThemeExpression) => ReactNode

type WebLayerStyle = ViewStyle & {
  backdropFilter?: string
  WebkitBackdropFilter?: string
  isolation?: 'auto' | 'isolate'
}

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

/**
 * The Liquid Glass token contract allows one blurred layer per region
 * (`blur.maxLayersPerRegion`). Chrome and the composer dock are the two
 * regions that spend it; conversation content stays clear so long responses
 * remain readable instead of turning into stacked frosted cards.
 */
function chromeBlurStyle(enabled: boolean, radius: number): WebLayerStyle | null {
  if (!enabled || Platform.OS !== 'web') return null
  return {
    backdropFilter: `blur(${radius}px) saturate(1.18)`,
    WebkitBackdropFilter: `blur(${radius}px) saturate(1.18)`,
    isolation: 'isolate',
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
  const testID = props.testID ?? `theme-expression-${props.kind}-${props.family}`
  return RENDERERS[props.family]({ ...props, testID, children: props.children }, expression)
}

/**
 * Content flow carries no surface in any family: the message column already is
 * the surface. Padding, background, and border stay at zero so a long response
 * reads as one column instead of a document card.
 */
function renderFlow(props: ThemeExpressionSurfaceProps, gap: number) {
  return (
    <View
      testID={props.testID}
      onLayout={props.onLayout}
      style={[
        styles.flow,
        props.kind === 'markdown' ? styles.flowMarkdown : { gap },
      ]}
    >
      {props.children}
    </View>
  )
}

function renderMinimal(props: ThemeExpressionSurfaceProps, expression: ThemeExpression) {
  const role = resolveThemeSurfaceRole(props)
  if (role === 'flow') return renderFlow(props, 5)
  const component = expression.components[componentIdForSurface(props)]
  const horizontalPadding = props.horizontalPadding ?? 0
  const rule = props.alertBorder ?? props.colors.ui.semantic.chrome.border
  return (
    <View
      testID={props.testID}
      onLayout={props.onLayout}
      style={[
        styles.base,
        role === 'chrome' ? styles.minimalChrome : null,
        role === 'composer' ? [styles.minimalComposer, { marginHorizontal: -horizontalPadding, paddingHorizontal: horizontalPadding }] : null,
        role === 'assistant' ? styles.minimalAssistant : null,
        role === 'user' ? styles.minimalUser : null,
        role === 'block' ? styles.minimalBlock : null,
        {
          backgroundColor: role === 'chrome' || role === 'composer'
            ? props.colors.ui.semantic.surface.canvas
            : role === 'block' && props.isUser
              ? props.colors.ui.message.userActionBackground
              : 'transparent',
          borderColor: rule,
          borderWidth: props.selected ? 2 : role === 'block' && component.border === 'divider' ? StyleSheet.hairlineWidth : 0,
        },
      ]}
    >
      {role === 'chrome' ? (
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.edgeRuleBottom, { backgroundColor: rule, height: props.alertBorder ? 2 : StyleSheet.hairlineWidth }]} />
      ) : null}
      {role === 'composer' ? (
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.edgeRuleTop, { backgroundColor: rule }]} />
      ) : null}
      {role === 'user' ? (
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.minimalUserIndex, { backgroundColor: props.colors.ui.control.primaryBackground }]} />
      ) : null}
      {props.children}
    </View>
  )
}

function renderMonet(props: ThemeExpressionSurfaceProps, expression: ThemeExpression) {
  const role = resolveThemeSurfaceRole(props)
  if (role === 'flow') return renderFlow(props, 8)
  const component = expression.components[componentIdForSurface(props)]
  const horizontalPadding = props.horizontalPadding ?? 0
  const rule = props.alertBorder ?? props.colors.ui.semantic.chrome.border
  const painted = role === 'chrome' || role === 'composer'
  return (
    <View
      testID={props.testID}
      onLayout={props.onLayout}
      style={[
        styles.base,
        role === 'chrome' ? styles.monetChrome : null,
        role === 'composer' ? [styles.monetComposer, { marginHorizontal: -horizontalPadding, paddingHorizontal: horizontalPadding }] : null,
        role === 'assistant' ? styles.monetAssistant : null,
        role === 'user' ? styles.monetUser : null,
        role === 'block' ? styles.monetBlock : null,
        {
          backgroundColor: painted
            ? props.colors.ui.semantic.surface.base
            : role === 'user'
              ? rgbaColor(props.colors.ui.message.userBackground, 0.9)
              : role === 'block'
                ? props.isUser ? props.colors.ui.message.userActionBackground : props.colors.ui.semantic.surface.base
                : 'transparent',
          borderColor: rule,
          borderWidth: props.selected ? 2 : role === 'user' || role === 'block' ? StyleSheet.hairlineWidth : 0,
          shadowOpacity: 0,
          elevation: 0,
        },
      ]}
    >
      {painted ? (
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.monetWash, { backgroundColor: props.colors.ui.icon.accentBackground }]} />
      ) : null}
      {role === 'chrome' ? (
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.edgeRuleBottom, { backgroundColor: rule, height: props.alertBorder ? 2 : StyleSheet.hairlineWidth }]} />
      ) : null}
      {role === 'composer' ? (
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={styles.monetPigmentRow}>
          <View style={[styles.monetPigmentLong, { backgroundColor: props.colors.primary }]} />
          <View style={[styles.monetPigmentShort, { backgroundColor: props.colors.accent }]} />
        </View>
      ) : null}
      {role === 'assistant' ? (
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.monetAssistantBrush, { backgroundColor: props.colors.primary }]} />
      ) : null}
      {role === 'user' && component.border === 'edge-highlight' ? (
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.monetUserBrush, { backgroundColor: props.colors.accent }]} />
      ) : null}
      {props.children}
    </View>
  )
}

/**
 * Material 3 hierarchy comes from tonal relationship, component role, and
 * spacing. The chrome band and the composer dock are surface containers; the
 * conversation canvas is the base surface; assistant turns carry no container
 * at all and use the active indicator plus type roles instead.
 */
function renderMaterial(props: ThemeExpressionSurfaceProps, expression: ThemeExpression) {
  const role = resolveThemeSurfaceRole(props)
  if (role === 'flow') return renderFlow(props, 6)
  const component = expression.components[componentIdForSurface(props)]
  const horizontalPadding = props.horizontalPadding ?? 0
  const container = props.colors.design?.semantic.color.surfaceContainer ?? props.colors.ui.semantic.surface.raised
  const outline = props.alertBorder ?? props.colors.ui.semantic.chrome.border
  return (
    <View
      testID={props.testID}
      onLayout={props.onLayout}
      style={[
        styles.base,
        role === 'chrome' ? styles.materialChrome : null,
        role === 'composer' ? [styles.materialComposer, { marginHorizontal: -horizontalPadding, paddingHorizontal: horizontalPadding }] : null,
        role === 'assistant' ? styles.materialAssistant : null,
        role === 'user' ? styles.materialUser : null,
        role === 'block' ? styles.materialBlock : null,
        {
          backgroundColor: role === 'chrome' || role === 'composer'
            ? container
            : role === 'user'
              ? props.colors.ui.message.userBackground
              : role === 'block'
                ? props.isUser ? props.colors.ui.message.userActionBackground : props.colors.ui.semantic.surface.muted
                : 'transparent',
          borderColor: outline,
          borderWidth: props.selected ? 2 : role === 'block' && component.border === 'outline' ? 1 : 0,
          shadowOpacity: 0,
          elevation: 0,
        },
      ]}
    >
      {role === 'chrome' && props.alertBorder ? (
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.edgeRuleBottom, { backgroundColor: props.alertBorder, height: 2 }]} />
      ) : null}
      {role === 'assistant' ? (
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.materialIndicator, { backgroundColor: props.colors.primary }]} />
      ) : null}
      <View style={styles.contentFrame}>{props.children}</View>
    </View>
  )
}

/**
 * Liquid Glass depth is material layering, not tinted boxes:
 *
 *   environment  ->  glass chrome  ->  clear conversation  ->  glass composer
 *
 * Only chrome and the composer dock spend the single blurred layer the token
 * contract allows per region. Assistant content stays clear so long responses
 * never become stacked frosted cards; the user capsule and code lens are the
 * only foreground glass in the canvas.
 */
function renderLiquidGlass(props: ThemeExpressionSurfaceProps, expression: ThemeExpression) {
  const role = resolveThemeSurfaceRole(props)
  if (role === 'flow') return renderFlow(props, 8)
  const component = expression.components[componentIdForSurface(props)]
  const horizontalPadding = props.horizontalPadding ?? 0
  const edge = props.alertBorder ?? props.colors.ui.actionBar.itemBorder
  const chromeRegion = role === 'chrome' || role === 'composer'
  const blurRadius = props.colors.design?.semantic.blur.radius ?? 12
  const specular = props.colors.ui.control.primaryForeground
  return (
    <View
      testID={props.testID}
      onLayout={props.onLayout}
      style={[
        styles.base,
        chromeBlurStyle(chromeRegion, blurRadius),
        role === 'chrome' ? styles.glassChrome : null,
        role === 'composer' ? [styles.glassComposer, { marginHorizontal: -horizontalPadding, paddingHorizontal: horizontalPadding }] : null,
        role === 'assistant' ? styles.glassAssistant : null,
        role === 'user' ? styles.glassUser : null,
        role === 'block' ? styles.glassBlock : null,
        {
          backgroundColor: chromeRegion
            ? rgbaColor(props.colors.ui.semantic.surface.overlay, 0.72)
            : role === 'user'
              ? rgbaColor(props.colors.ui.message.userBackground, 0.78)
              : role === 'block'
                ? rgbaColor(props.isUser ? props.colors.ui.message.userActionBackground : props.colors.ui.semantic.surface.overlay, 0.82)
                : 'transparent',
          borderColor: edge,
          borderWidth: props.selected ? 2 : role === 'user' || role === 'block' ? StyleSheet.hairlineWidth : 0,
          shadowColor: role === 'user' ? props.colors.shadowTint : undefined,
          shadowOpacity: role === 'user' ? 0.05 : 0,
          shadowRadius: role === 'user' ? 6 : 0,
          shadowOffset: { width: 0, height: role === 'user' ? 2 : 0 },
          elevation: 0,
        },
      ]}
    >
      {role === 'chrome' ? (
        <>
          <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.glassSpecular, { backgroundColor: specular }]} />
          <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.edgeRuleBottom, { backgroundColor: edge, height: props.alertBorder ? 2 : StyleSheet.hairlineWidth }]} />
        </>
      ) : null}
      {role === 'composer' ? (
        <>
          <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.edgeRuleTop, { backgroundColor: edge }]} />
          <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.glassSpecular, { backgroundColor: specular }]} />
        </>
      ) : null}
      {(role === 'user' || role === 'block') && component.border === 'edge-highlight' ? (
        <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.glassLensSpecular, { backgroundColor: specular }]} />
      ) : null}
      <View style={styles.contentFrame}>{props.children}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  base: { minWidth: 0, maxWidth: '100%', justifyContent: 'center', position: 'relative' },
  contentFrame: { position: 'relative', zIndex: 1 },
  flow: {
    width: '100%',
    minWidth: 0,
    maxWidth: '100%',
    minHeight: 0,
    backgroundColor: 'transparent',
    borderWidth: 0,
    paddingHorizontal: 0,
    paddingVertical: 0,
    overflow: 'hidden',
  },
  flowMarkdown: { justifyContent: 'flex-start' },
  edgeRuleTop: { position: 'absolute', top: 0, right: 0, left: 0, height: StyleSheet.hairlineWidth },
  edgeRuleBottom: { position: 'absolute', right: 0, bottom: 0, left: 0 },

  minimalChrome: { minHeight: 44, paddingHorizontal: 0, paddingVertical: 0 },
  minimalComposer: { paddingTop: 8, paddingBottom: 4 },
  minimalAssistant: { width: '100%', justifyContent: 'flex-start', paddingVertical: 6 },
  minimalUser: { alignSelf: 'flex-end', maxWidth: '94%', paddingVertical: 6, paddingHorizontal: 0, borderRadius: 0 },
  minimalBlock: { width: '100%', minHeight: 0, borderRadius: 2, padding: 0 },
  minimalUserIndex: { position: 'absolute', top: 0, right: 0, width: 24, height: 2 },

  monetChrome: { minHeight: 48, paddingHorizontal: 0, paddingVertical: 0, overflow: 'hidden' },
  monetComposer: { paddingTop: 12, paddingBottom: 6, overflow: 'hidden' },
  monetAssistant: { width: '100%', justifyContent: 'flex-start', paddingLeft: 12, paddingVertical: 8 },
  monetUser: { alignSelf: 'flex-end', maxWidth: '94%', paddingHorizontal: 12, paddingVertical: 8, overflow: 'hidden', borderTopLeftRadius: 18, borderTopRightRadius: 8, borderBottomRightRadius: 8, borderBottomLeftRadius: 16 },
  monetBlock: { width: '100%', minHeight: 0, padding: 3, borderTopLeftRadius: 9, borderTopRightRadius: 16, borderBottomRightRadius: 16, borderBottomLeftRadius: 9 },
  monetWash: { position: 'absolute', top: -22, right: -20, width: 120, height: 70, borderBottomLeftRadius: 64, opacity: 0.18 },
  monetPigmentRow: { position: 'absolute', top: 5, right: 18, left: 18, height: 3, flexDirection: 'row', gap: 5, opacity: 0.5 },
  monetPigmentLong: { flex: 1, borderRadius: 2 },
  monetPigmentShort: { width: 30, borderRadius: 2 },
  monetAssistantBrush: { position: 'absolute', top: 10, bottom: 10, left: 2, width: 3, borderRadius: 2, opacity: 0.42 },
  monetUserBrush: { position: 'absolute', right: 10, bottom: 3, width: 30, height: 2, borderRadius: 1, opacity: 0.44 },

  materialChrome: { minHeight: 56, paddingHorizontal: 0, paddingVertical: 0 },
  materialComposer: { paddingTop: 8, paddingBottom: 6 },
  materialAssistant: { width: '100%', justifyContent: 'flex-start', paddingLeft: 12, paddingVertical: 10 },
  materialUser: { alignSelf: 'flex-end', maxWidth: '94%', paddingHorizontal: 16, paddingVertical: 10, borderTopLeftRadius: 20, borderTopRightRadius: 4, borderBottomRightRadius: 20, borderBottomLeftRadius: 20 },
  materialBlock: { width: '100%', minHeight: 0, borderRadius: 12, padding: 2, overflow: 'hidden' },
  materialIndicator: { position: 'absolute', top: 12, bottom: 12, left: 0, width: 3, borderRadius: 2, opacity: 0.5 },

  glassChrome: { minHeight: 48, paddingHorizontal: 0, paddingVertical: 0, overflow: 'hidden' },
  glassComposer: { paddingTop: 8, paddingBottom: 6, overflow: 'hidden' },
  glassAssistant: { width: '100%', justifyContent: 'flex-start', paddingLeft: 12, paddingVertical: 8 },
  glassUser: { alignSelf: 'flex-end', maxWidth: '94%', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, overflow: 'hidden' },
  glassBlock: { width: '100%', minHeight: 0, borderRadius: 16, padding: 3, overflow: 'hidden' },
  glassSpecular: { position: 'absolute', top: 0, right: 24, left: 24, height: StyleSheet.hairlineWidth, opacity: 0.4 },
  glassLensSpecular: { position: 'absolute', top: 1, right: 14, left: 14, height: StyleSheet.hairlineWidth, opacity: 0.36 },
})
