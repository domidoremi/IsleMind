import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'

import type { useAppTheme } from '@/hooks/useAppTheme'
import type { CanonicalThemeId } from '@/types/settingsContracts'

type ThemeColors = ReturnType<typeof useAppTheme>['colors']

interface ButtonExpressionBodyProps {
  family: CanonicalThemeId
  colors: ThemeColors
  icon?: ReactNode
  content?: ReactNode
  primary: boolean
}

interface InputExpressionBodyProps {
  family: CanonicalThemeId
  colors: ThemeColors
  prefix?: ReactNode
  input: ReactNode
  suffix?: ReactNode
  focused: boolean
  multiline: boolean
}

interface CardExpressionLayersProps {
  family: CanonicalThemeId
  colors: ThemeColors
  interactive: boolean
  titleCard: boolean
}

const decorativeAccessibility = {
  accessible: false,
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants' as const,
  pointerEvents: 'none' as const,
}

export function ThemeButtonExpressionBody({
  family,
  colors,
  icon,
  content,
  primary,
}: ButtonExpressionBodyProps) {
  if (family === 'minimal') {
    return (
      <View testID="theme-button-body-minimal" style={styles.minimalButtonBody}>
        {icon ? <View style={styles.minimalButtonIcon}>{icon}</View> : null}
        {content ? <View style={styles.minimalButtonLabel}>{content}</View> : null}
        {primary ? (
          <>
            <View {...decorativeAccessibility} style={[styles.minimalButtonRule, { borderBottomColor: colors.ui.control.primaryForeground }]} />
            <View {...decorativeAccessibility} style={[styles.minimalButtonIndex, { borderLeftColor: colors.ui.control.primaryForeground }]} />
          </>
        ) : null}
      </View>
    )
  }

  if (family === 'monet') {
    return (
      <View testID="theme-button-body-monet" style={styles.monetButtonBody}>
        <View {...decorativeAccessibility} style={[styles.monetButtonLightPool, { backgroundColor: colors.ui.icon.accentBackground }]} />
        <View {...decorativeAccessibility} style={[styles.monetButtonLightBand, { backgroundColor: colors.ui.control.focus }]} />
        <View {...decorativeAccessibility} style={[styles.monetButtonContour, { borderColor: colors.ui.control.focus }]} />
        <View style={styles.monetButtonContent}>
          <View {...decorativeAccessibility} style={styles.monetBrushMark}>
            <View style={[styles.monetBrushArcWide, { borderColor: colors.ui.control.focus }]} />
            <View style={[styles.monetBrushArcShort, { borderColor: colors.ui.control.focus }]} />
          </View>
          {icon ? <View style={styles.monetButtonIcon}>{icon}</View> : null}
          {content ? <View style={styles.monetButtonLabel}>{content}</View> : null}
        </View>
      </View>
    )
  }

  if (family === 'material') {
    return (
      <View testID="theme-button-body-material" style={styles.materialButtonBody}>
        <View {...decorativeAccessibility} style={[StyleSheet.absoluteFill, { backgroundColor: colors.primary, opacity: primary ? 0.08 : 0.04 }]} />
        {icon ? (
          <View
            style={[
              styles.materialButtonIconSlot,
              {
                backgroundColor: colors.ui.actionBar.itemBackground,
                borderRightColor: colors.ui.semantic.chrome.border,
              },
            ]}
          >
            {icon}
          </View>
        ) : null}
        {content ? <View style={styles.materialButtonLabelSlot}>{content}</View> : null}
        <View {...decorativeAccessibility} style={[styles.materialButtonStateEdge, { borderLeftColor: colors.primary }]} />
      </View>
    )
  }

  return (
    <View testID="theme-button-body-liquid-glass" style={styles.glassButtonBody}>
      <View {...decorativeAccessibility} style={[styles.glassButtonInnerPlane, { borderColor: colors.ui.actionBar.itemBorder }]} />
      <View {...decorativeAccessibility} style={[styles.glassButtonHighlight, { backgroundColor: colors.ui.semantic.content.inverse }]} />
      <View {...decorativeAccessibility} style={[styles.glassButtonDepthShade, { borderBottomColor: colors.ui.semantic.chrome.border }]} />
      <View style={styles.glassButtonContentPlane}>
        {icon ? <View style={styles.glassButtonIcon}>{icon}</View> : null}
        {content ? <View style={styles.glassButtonLabel}>{content}</View> : null}
      </View>
    </View>
  )
}

export function ThemeInputExpressionBody({
  family,
  colors,
  prefix,
  input,
  suffix,
  focused,
  multiline,
}: InputExpressionBodyProps) {
  const content = (
    <View style={[styles.inputContentRow, multiline ? styles.inputContentRowMultiline : null]}>
      {prefix}
      {input}
      {suffix}
    </View>
  )

  if (family === 'minimal') {
    return (
      <View testID="theme-input-body-minimal" style={styles.inputBody}>
        <View style={styles.minimalInputContentFrame}>{content}</View>
        <View
          {...decorativeAccessibility}
          style={[
            styles.minimalInputRule,
            {
              borderBottomColor: focused ? colors.ui.input.focus : colors.ui.input.border,
              borderBottomWidth: focused ? 2 : StyleSheet.hairlineWidth,
            },
          ]}
        />
        {focused ? <View {...decorativeAccessibility} style={[styles.minimalInputFocusIndex, { borderLeftColor: colors.ui.input.focus }]} /> : null}
      </View>
    )
  }

  if (family === 'monet') {
    return (
      <View testID="theme-input-body-monet" style={styles.inputBody}>
        <View {...decorativeAccessibility} style={[styles.monetInputLightPool, { backgroundColor: colors.ui.icon.accentBackground, opacity: focused ? 0.18 : 0.1 }]} />
        <View {...decorativeAccessibility} style={[styles.monetInputLightBand, { backgroundColor: colors.ui.control.focus, opacity: focused ? 0.28 : 0.14 }]} />
        <View {...decorativeAccessibility} style={[styles.monetInputUpperContour, { borderColor: colors.ui.control.focus, opacity: focused ? 0.48 : 0.28 }]} />
        <View {...decorativeAccessibility} style={[styles.monetInputLowerContour, { borderColor: colors.ui.semantic.chrome.border, opacity: focused ? 0.4 : 0.22 }]} />
        <View style={styles.monetInputContentFrame}>{content}</View>
      </View>
    )
  }

  if (family === 'material') {
    return (
      <View testID="theme-input-body-material" style={styles.inputBody}>
        <View {...decorativeAccessibility} style={[StyleSheet.absoluteFill, { backgroundColor: colors.primary, opacity: focused ? 0.08 : 0.035 }]} />
        <View {...decorativeAccessibility} style={[styles.materialInputLeadingRail, { borderRightColor: colors.ui.semantic.chrome.border }]} />
        <View {...decorativeAccessibility} style={[styles.materialInputIndicator, { borderBottomColor: colors.primary, opacity: focused ? 0.96 : 0.48 }]} />
        <View style={styles.materialInputContentFrame}>{content}</View>
      </View>
    )
  }

  return (
    <View testID="theme-input-body-liquid-glass" style={styles.inputBody}>
      <View {...decorativeAccessibility} style={[styles.glassInputInnerPlane, { borderColor: colors.ui.actionBar.itemBorder }]} />
      <View {...decorativeAccessibility} style={[styles.glassInputHighlight, { backgroundColor: colors.ui.semantic.content.inverse, opacity: focused ? 0.38 : 0.22 }]} />
      <View {...decorativeAccessibility} style={[styles.glassInputDepthShade, { borderBottomColor: colors.ui.semantic.chrome.border }]} />
      <View style={styles.glassInputContentFrame}>{content}</View>
    </View>
  )
}

export function ThemeCardExpressionLayers({
  family,
  colors,
  interactive,
  titleCard,
}: CardExpressionLayersProps) {
  if (family === 'minimal') {
    return (
      <>
        <View {...decorativeAccessibility} testID="theme-card-layer-minimal" style={[titleCard ? styles.minimalCardTopRule : styles.minimalCardIndex, { backgroundColor: colors.ui.semantic.chrome.border }]} />
        {interactive ? <View {...decorativeAccessibility} style={[styles.minimalCardInteractionMark, { backgroundColor: colors.ui.control.primaryBackground }]} /> : null}
      </>
    )
  }

  if (family === 'monet') {
    return (
      <>
        <View {...decorativeAccessibility} testID="theme-card-layer-monet" style={[styles.monetCardLightPool, { backgroundColor: colors.ui.icon.accentBackground }]} />
        <View {...decorativeAccessibility} style={[styles.monetCardLightBand, { backgroundColor: colors.ui.control.focus }]} />
      </>
    )
  }

  if (family === 'material') {
    return (
      <>
        <View {...decorativeAccessibility} testID="theme-card-layer-material" style={[StyleSheet.absoluteFill, { backgroundColor: colors.primary, opacity: interactive ? 0.055 : 0.025 }]} />
        <View {...decorativeAccessibility} style={[styles.materialCardIndicator, { backgroundColor: colors.primary }]} />
      </>
    )
  }

  return (
    <>
      <View {...decorativeAccessibility} testID="theme-card-layer-liquid-glass" style={[styles.glassCardInnerPlane, { borderColor: colors.ui.actionBar.itemBorder }]} />
      <View {...decorativeAccessibility} style={[styles.glassCardHighlight, { backgroundColor: colors.ui.semantic.content.inverse }]} />
      <View {...decorativeAccessibility} style={[styles.glassCardDepthShade, { backgroundColor: colors.ui.semantic.chrome.border }]} />
    </>
  )
}

const styles = StyleSheet.create({
  minimalButtonBody: { position: 'relative', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, minWidth: 0 },
  minimalButtonIcon: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  minimalButtonLabel: { minWidth: 0, flexShrink: 1 },
  minimalButtonRule: { position: 'absolute', left: 0, right: 0, bottom: -5, height: 1, borderBottomWidth: 1, opacity: 0.72 },
  minimalButtonIndex: { position: 'absolute', left: 0, bottom: -5, height: 7, borderLeftWidth: 2, opacity: 0.86 },
  monetButtonBody: { position: 'relative', minWidth: 0, justifyContent: 'center' },
  monetButtonLightPool: { position: 'absolute', width: 70, height: 30, borderRadius: 24, top: -9, right: -10, opacity: 0.12 },
  monetButtonLightBand: { position: 'absolute', top: -4, left: 12, right: 12, height: 1, opacity: 0.2 },
  monetButtonContour: { position: 'absolute', top: -5, right: -3, bottom: -5, left: 4, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: 18, borderBottomRightRadius: 22, opacity: 0.32, transform: [{ rotate: '-1deg' }] },
  monetButtonContent: { position: 'relative', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, minWidth: 0, paddingHorizontal: 2 },
  monetBrushMark: { width: 12, height: 15, flexShrink: 0, position: 'relative' },
  monetBrushArcWide: { position: 'absolute', width: 11, height: 7, left: 0, top: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, opacity: 0.52, transform: [{ rotate: '-12deg' }] },
  monetBrushArcShort: { position: 'absolute', width: 8, height: 6, right: 0, bottom: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: 7, opacity: 0.36, transform: [{ rotate: '10deg' }] },
  monetButtonIcon: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  monetButtonLabel: { minWidth: 0, flexShrink: 1 },
  materialButtonBody: { position: 'relative', minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, overflow: 'hidden' },
  materialButtonIconSlot: { width: 30, height: 24, paddingRight: 6, borderRightWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  materialButtonLabelSlot: { minWidth: 0, flexShrink: 1, paddingVertical: 1 },
  materialButtonStateEdge: { position: 'absolute', left: 0, top: 4, bottom: 4, width: 2, borderLeftWidth: 2, opacity: 0.78 },
  glassButtonBody: { position: 'relative', minWidth: 0, justifyContent: 'center' },
  glassButtonInnerPlane: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, opacity: 0.5 },
  glassButtonHighlight: { position: 'absolute', top: 0, left: 12, right: 12, height: 1, opacity: 0.28 },
  glassButtonDepthShade: { position: 'absolute', left: 10, right: 10, bottom: 0, height: 2, borderBottomWidth: 2, borderRadius: 2, opacity: 0.14 },
  glassButtonContentPlane: { position: 'relative', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, minWidth: 0, paddingHorizontal: 2, paddingVertical: 1 },
  glassButtonIcon: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  glassButtonLabel: { minWidth: 0, flexShrink: 1 },
  inputBody: { position: 'relative', flex: 1, alignSelf: 'stretch', minWidth: 0, justifyContent: 'center' },
  inputContentRow: { position: 'relative', flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  inputContentRowMultiline: { alignItems: 'flex-start' },
  minimalInputContentFrame: { position: 'relative', flex: 1, minWidth: 0, paddingHorizontal: 1 },
  minimalInputRule: { position: 'absolute', left: 0, right: 0, bottom: -1, height: 2 },
  minimalInputFocusIndex: { position: 'absolute', left: 0, bottom: -1, height: 11, borderLeftWidth: 2, opacity: 0.9 },
  monetInputLightPool: { position: 'absolute', width: 94, height: 46, borderRadius: 34, top: -12, right: -15, opacity: 0.55 },
  monetInputLightBand: { position: 'absolute', top: -1, left: 14, right: 14, height: 2, opacity: 0.5 },
  monetInputUpperContour: { position: 'absolute', top: 3, left: 7, right: 20, height: 18, borderTopWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, borderTopRightRadius: 22, transform: [{ rotate: '-0.6deg' }] },
  monetInputLowerContour: { position: 'absolute', left: 20, right: 6, bottom: 3, height: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderLeftWidth: StyleSheet.hairlineWidth, borderBottomLeftRadius: 22, transform: [{ rotate: '0.6deg' }] },
  monetInputContentFrame: { position: 'relative', flex: 1, minWidth: 0, paddingHorizontal: 6 },
  materialInputLeadingRail: { position: 'absolute', left: 0, top: 6, bottom: 6, width: 10, borderRightWidth: StyleSheet.hairlineWidth, opacity: 0.72 },
  materialInputIndicator: { position: 'absolute', left: 10, bottom: -1, width: 42, height: 2, borderBottomWidth: 2 },
  materialInputContentFrame: { position: 'relative', flex: 1, minWidth: 0, paddingLeft: 14 },
  glassInputInnerPlane: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, opacity: 0.5 },
  glassInputHighlight: { position: 'absolute', top: 0, left: 18, right: 18, height: 1, opacity: 0.24 },
  glassInputDepthShade: { position: 'absolute', left: 16, right: 16, bottom: 0, height: 2, borderBottomWidth: 2, borderRadius: 2, opacity: 0.14 },
  glassInputContentFrame: { position: 'relative', flex: 1, minWidth: 0, paddingHorizontal: 3, paddingVertical: 1 },
  minimalCardTopRule: { position: 'absolute', top: 0, left: 0, right: 0, height: StyleSheet.hairlineWidth },
  minimalCardIndex: { position: 'absolute', top: 10, bottom: 10, left: 0, width: StyleSheet.hairlineWidth },
  minimalCardInteractionMark: { position: 'absolute', left: 0, top: 10, width: 2, height: 16, opacity: 0.72 },
  monetCardLightPool: { position: 'absolute', width: 124, height: 76, borderRadius: 62, top: -36, right: -22, opacity: 0.1 },
  monetCardLightBand: { position: 'absolute', top: 0, left: 22, right: 22, height: 2, opacity: 0.12 },
  materialCardIndicator: { position: 'absolute', left: 0, top: 12, bottom: 12, width: 3, opacity: 0.68 },
  glassCardInnerPlane: { position: 'absolute', top: 3, right: 3, bottom: 3, left: 3, borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, opacity: 0.46 },
  glassCardHighlight: { position: 'absolute', top: 0, left: 18, right: 18, height: 1, opacity: 0.26 },
  glassCardDepthShade: { position: 'absolute', left: 16, right: 16, bottom: 1, height: 2, borderRadius: 2, opacity: 0.1 },
})
