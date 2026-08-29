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

function renderMinimal(props: ThemeExpressionSurfaceProps, expression: ThemeExpression) {
  const component = expression.components[componentIdForSurface(props)]
  const isMessage = props.kind === 'message'
  const isContent = props.kind === 'message-content'
  const isMarkdown = props.kind === 'markdown'
  const isCodeBlock = props.kind === 'code-block'
  const isChrome = props.kind === 'chrome'
  const horizontalPadding = props.horizontalPadding ?? 0
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
        props.kind === 'composer' ? { marginHorizontal: -horizontalPadding, paddingHorizontal: horizontalPadding } : null,
        {
          backgroundColor: isContent || isMarkdown ? 'transparent' : isMessage && props.isUser ? props.colors.ui.message.userBackground : isCodeBlock && props.isUser ? props.colors.ui.message.userActionBackground : isChrome ? props.colors.ui.semantic.surface.base : 'transparent',
          borderColor: props.alertBorder ?? props.colors.ui.semantic.chrome.border,
          borderWidth: isContent || isMarkdown ? 0 : props.selected ? 2 : component.border === 'divider' ? StyleSheet.hairlineWidth : 0,
        },
      ]}
    >
      {props.kind === 'composer' ? (
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.minimalComposerRule, { backgroundColor: props.colors.ui.semantic.chrome.border }]} />
      ) : null}
      {isMessage && props.isUser ? (
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.minimalMessageIndex, { backgroundColor: props.colors.ui.control.primaryBackground }]} />
      ) : null}
      {props.children}
    </View>
  )
}

function renderMonet(props: ThemeExpressionSurfaceProps, expression: ThemeExpression) {
  const component = expression.components[componentIdForSurface(props)]
  const isMessage = props.kind === 'message'
  const isContent = props.kind === 'message-content'
  const isMarkdown = props.kind === 'markdown'
  const isCodeBlock = props.kind === 'code-block'
  const isNestedRichContent = props.kind === 'code-block'
  const assistantMessage = isMessage && !props.isUser
  const contentFrame = (
    <View style={[
      styles.monetContentFrame,
      props.kind === 'composer' ? styles.monetComposerFrame : null,
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
        isMessage && props.isUser ? styles.monetUserMessage : null,
        isMessage && !props.isUser ? styles.monetAssistantMessage : null,
        props.kind === 'composer' ? styles.monetComposer : null,
        {
          backgroundColor: isContent || isMarkdown ? 'transparent' : isMessage && props.isUser ? props.colors.ui.message.userBackground : isNestedRichContent && props.isUser ? props.colors.ui.message.userActionBackground : props.colors.ui.semantic.surface.base,
          borderColor: props.alertBorder ?? props.colors.ui.semantic.chrome.border,
          borderWidth: isContent || isMarkdown ? 0 : props.selected ? 2 : component.border === 'none' ? 0 : 1,
          shadowOpacity: 0,
          elevation: 0,
        },
      ]}
    >
      {assistantMessage ? (
        <View style={styles.monetAssistantFlow}>{contentFrame}</View>
      ) : contentFrame}
    </View>
  )
}

function renderMaterial(props: ThemeExpressionSurfaceProps, expression: ThemeExpression) {
  const component = expression.components[componentIdForSurface(props)]
  const isMessage = props.kind === 'message'
  const isContent = props.kind === 'message-content'
  const isMarkdown = props.kind === 'markdown'
  const isCodeBlock = props.kind === 'code-block'
  const isNestedRichContent = props.kind === 'code-block'
  return (
    <View
      testID={props.testID}
      onLayout={props.onLayout}
      style={[
        styles.materialBase,
        isContent ? styles.materialContent : null,
        isMarkdown ? styles.materialMarkdown : null,
        isCodeBlock ? styles.materialCodeBlock : null,
        isMessage && props.isUser ? styles.materialUserMessage : null,
        isMessage && !props.isUser ? styles.materialAssistantMessage : null,
        props.kind === 'composer' ? styles.materialComposer : null,
        {
          backgroundColor: isContent || isMarkdown ? 'transparent' : isMessage && props.isUser ? props.colors.ui.message.userBackground : isNestedRichContent && props.isUser ? props.colors.ui.message.userActionBackground : props.colors.ui.semantic.surface.raised,
          borderColor: props.alertBorder ?? props.colors.ui.semantic.chrome.border,
          borderWidth: isContent || isMarkdown ? 0 : props.selected ? 2 : component.border === 'none' ? 0 : 1,
          shadowColor: props.colors.shadowTint,
          shadowOpacity: component.elevation === 'tonal' ? 0.12 : 0,
          shadowRadius: component.elevation === 'tonal' ? 6 : 0,
          shadowOffset: { width: 0, height: component.elevation === 'tonal' ? 2 : 0 },
          elevation: component.elevation === 'tonal' ? 1 : 0,
        },
      ]}
    >
      {props.kind === 'chrome' || props.kind === 'composer' ? <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.materialStateLayer, { backgroundColor: props.colors.primary }]} /> : null}
      {props.kind === 'composer' ? (
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.materialComposerHandle, { backgroundColor: props.colors.textTertiary }]} />
      ) : null}
      {isMessage && !props.isUser ? (
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.materialMessageIndicator, { backgroundColor: props.colors.primary }]} />
      ) : null}
      <View style={[
        styles.materialContentFrame,
        props.kind === 'composer' ? styles.materialComposerFrame : null,
        isMessage && !props.isUser ? styles.materialAssistantContentFrame : null,
      ]}>
        {props.children}
      </View>
    </View>
  )
}

function renderLiquidGlass(props: ThemeExpressionSurfaceProps, expression: ThemeExpression) {
  const component = expression.components[componentIdForSurface(props)]
  const isMessage = props.kind === 'message'
  const isContent = props.kind === 'message-content'
  const isMarkdown = props.kind === 'markdown'
  const isCodeBlock = props.kind === 'code-block'
  const isNestedRichContent = props.kind === 'code-block'
  const glassLens = props.kind === 'chrome' || props.kind === 'composer'
  const glassStyle = Platform.OS === 'web' && glassLens
    ? ({ backdropFilter: 'blur(12px) saturate(1.08)' } as unknown as ViewStyle)
    : null
  return (
    <View
      testID={props.testID}
      onLayout={props.onLayout}
      style={[
        styles.glassBase,
        glassStyle,
        isContent ? styles.glassContent : null,
        isMarkdown ? styles.glassMarkdown : null,
        isCodeBlock ? styles.glassCodeBlock : null,
        isMessage && props.isUser ? styles.glassUserMessage : null,
        isMessage && !props.isUser ? styles.glassAssistantMessage : null,
        props.kind === 'composer' ? styles.glassComposer : null,
        {
          backgroundColor: isContent || isMarkdown ? 'transparent' : isMessage && props.isUser ? props.colors.ui.message.userBackground : isNestedRichContent && props.isUser ? props.colors.ui.message.userActionBackground : glassLens ? props.colors.ui.semantic.surface.overlay : props.colors.ui.semantic.surface.base,
          borderColor: props.alertBorder ?? props.colors.ui.semantic.chrome.border,
          borderWidth: isContent || isMarkdown ? 0 : props.selected ? 2 : glassLens || (isMessage && props.isUser) ? 1 : 0,
          shadowColor: glassLens ? props.colors.shadowTint : undefined,
          shadowOpacity: glassLens ? 0.08 : 0,
          shadowRadius: glassLens ? 12 : 0,
          shadowOffset: { width: 0, height: glassLens ? 4 : 0 },
          elevation: glassLens ? 2 : 0,
        },
      ]}
    >
      {glassLens ? <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.glassInnerPlane, { borderColor: props.colors.ui.actionBar.itemBorder }]} /> : null}
      <View style={[
        styles.glassContentFrame,
        props.kind === 'composer' ? styles.glassComposerFrame : null,
        isMessage && props.isUser ? styles.glassUserContentFrame : null,
      ]}>
        {props.children}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  minimalBase: { minHeight: 44, minWidth: 0, maxWidth: '100%', justifyContent: 'center', position: 'relative' },
  minimalUserMessage: { alignSelf: 'flex-end', maxWidth: '92%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 4 },
  minimalAssistantMessage: { width: '100%', paddingVertical: 6 },
  minimalContent: { width: '100%', minWidth: 0, maxWidth: '100%', gap: 5, minHeight: 0, overflow: 'hidden' },
  minimalMarkdown: { width: '100%', minWidth: 0, maxWidth: '100%', minHeight: 0, justifyContent: 'flex-start', overflow: 'hidden' },
  minimalCodeBlock: { width: '100%', minHeight: 0, borderRadius: 2, padding: 0 },
  minimalComposerRule: { position: 'absolute', top: 0, left: 0, right: 0, height: StyleSheet.hairlineWidth },
  minimalMessageIndex: { position: 'absolute', top: 7, bottom: 7, left: 0, width: 2 },
  monetBase: { minHeight: 48, minWidth: 0, maxWidth: '100%', justifyContent: 'center', overflow: 'hidden', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  monetComposer: { marginHorizontal: 4, padding: 9 },
  monetUserMessage: { alignSelf: 'flex-end', maxWidth: '90%', borderTopLeftRadius: 22, borderBottomRightRadius: 10 },
  monetAssistantMessage: { width: '100%', marginVertical: 4, borderTopLeftRadius: 10, borderBottomRightRadius: 16 },
  monetContent: { width: '100%', minWidth: 0, maxWidth: '100%', gap: 8, minHeight: 0, paddingHorizontal: 0, paddingVertical: 0, borderRadius: 0, overflow: 'hidden' },
  monetMarkdown: { width: '100%', minWidth: 0, maxWidth: '100%', minHeight: 0, justifyContent: 'flex-start', borderRadius: 0, paddingHorizontal: 0, paddingVertical: 0, overflow: 'hidden' },
  monetCodeBlock: { width: '100%', minHeight: 0, borderTopLeftRadius: 9, borderBottomRightRadius: 19, padding: 3 },
  monetAssistantFlow: { width: '100%', alignItems: 'stretch', paddingVertical: 4 },
  monetContentFrame: { position: 'relative', zIndex: 1 },
  monetComposerFrame: { paddingTop: 2 },
  monetUserContentFrame: { minWidth: 0 },
  materialBase: { minHeight: 48, minWidth: 0, maxWidth: '100%', justifyContent: 'center', overflow: 'hidden', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  materialComposer: { marginHorizontal: 0, padding: 7 },
  materialUserMessage: { alignSelf: 'flex-end', maxWidth: '86%', borderRadius: 18, paddingHorizontal: 16, paddingVertical: 10 },
  materialAssistantMessage: { width: '100%', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12 },
  materialContent: { width: '100%', minWidth: 0, maxWidth: '100%', gap: 6, minHeight: 0, paddingHorizontal: 0, paddingVertical: 0, borderRadius: 0, overflow: 'hidden' },
  materialMarkdown: { width: '100%', minWidth: 0, maxWidth: '100%', minHeight: 0, justifyContent: 'flex-start', borderRadius: 0, paddingHorizontal: 0, paddingVertical: 0, overflow: 'hidden' },
  materialCodeBlock: { width: '100%', minHeight: 0, borderRadius: 12, padding: 2 },
  materialStateLayer: { ...StyleSheet.absoluteFill, opacity: 0.04 },
  materialComposerHandle: { position: 'absolute', top: 5, alignSelf: 'center', width: 32, height: 3, borderRadius: 2, opacity: 0.48 },
  materialMessageIndicator: { position: 'absolute', top: 10, bottom: 10, left: 0, width: 3, opacity: 0.72 },
  materialContentFrame: { position: 'relative', zIndex: 1 },
  materialComposerFrame: { paddingTop: 4 },
  materialAssistantContentFrame: { paddingLeft: 2 },
  glassBase: { minHeight: 50, minWidth: 0, maxWidth: '100%', justifyContent: 'center', overflow: 'hidden', borderRadius: 18, paddingHorizontal: 13, paddingVertical: 9 },
  glassComposer: { marginHorizontal: 6, padding: 8 },
  glassUserMessage: { alignSelf: 'flex-end', maxWidth: '90%', borderRadius: 24 },
  glassAssistantMessage: { width: '100%', borderRadius: 18 },
  glassContent: { width: '100%', minWidth: 0, maxWidth: '100%', gap: 8, minHeight: 0, paddingHorizontal: 0, paddingVertical: 0, borderRadius: 0, overflow: 'hidden' },
  glassMarkdown: { width: '100%', minWidth: 0, maxWidth: '100%', minHeight: 0, justifyContent: 'flex-start', borderRadius: 0, paddingHorizontal: 0, paddingVertical: 0, overflow: 'hidden' },
  glassCodeBlock: { width: '100%', minHeight: 0, borderRadius: 20, padding: 3 },
  glassInnerPlane: { position: 'absolute', top: 2, right: 2, bottom: 2, left: 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, opacity: 0.34 },
  glassContentFrame: { position: 'relative', zIndex: 1 },
  glassComposerFrame: { paddingHorizontal: 2, paddingVertical: 2 },
  glassUserContentFrame: { minWidth: 0 },
})
