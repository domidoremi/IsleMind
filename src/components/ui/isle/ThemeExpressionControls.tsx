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

// Decorative marks are intentionally hidden from the accessibility tree. They
// communicate a theme's grammar, never product state or content.
const decorativeAccessibility = {
  accessible: false,
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants' as const,
  pointerEvents: 'none' as const,
}

export function ThemeButtonExpressionBody({ family, colors, icon, content, primary }: ButtonExpressionBodyProps) {
  if (family === 'minimal') {
    return (
      <View testID="theme-button-body-minimal" style={styles.row}>
        {icon ? <View style={styles.icon}>{icon}</View> : null}
        {content ? <View style={styles.label}>{content}</View> : null}
        {primary ? <View {...decorativeAccessibility} style={[styles.minimalRule, { backgroundColor: colors.ui.control.primaryForeground }]} /> : null}
      </View>
    )
  }

  if (family === 'monet') {
    return (
      <View testID="theme-button-body-monet" style={styles.row}>
        <View {...decorativeAccessibility} style={[styles.monetWash, { backgroundColor: colors.ui.icon.accentBackground }]} />
        <View {...decorativeAccessibility} style={[styles.monetEdge, { borderColor: colors.ui.control.focus }]} />
        {icon ? <View style={styles.icon}>{icon}</View> : null}
        {content ? <View style={styles.label}>{content}</View> : null}
      </View>
    )
  }

  if (family === 'material') {
    return (
      <View testID="theme-button-body-material" style={styles.row}>
        {primary ? <View {...decorativeAccessibility} style={[styles.materialStateLayer, { backgroundColor: colors.primary }]} /> : null}
        {icon ? <View style={styles.icon}>{icon}</View> : null}
        {content ? <View style={styles.label}>{content}</View> : null}
        {primary ? <View {...decorativeAccessibility} style={[styles.materialIndicator, { backgroundColor: colors.primary }]} /> : null}
      </View>
    )
  }

  return (
    <View testID="theme-button-body-liquid-glass" style={styles.row}>
      <View {...decorativeAccessibility} style={[styles.glassPlane, { borderColor: colors.ui.actionBar.itemBorder }]} />
      <View {...decorativeAccessibility} style={[styles.glassHighlight, { backgroundColor: colors.ui.semantic.content.inverse }]} />
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      {content ? <View style={styles.label}>{content}</View> : null}
    </View>
  )
}

export function ThemeInputExpressionBody({ family, colors, prefix, input, suffix, focused, multiline }: InputExpressionBodyProps) {
  const content = (
    <View style={[styles.inputRow, multiline ? styles.inputRowMultiline : null]}>
      {prefix}
      {input}
      {suffix}
    </View>
  )

  if (family === 'minimal') {
    return (
      <View testID="theme-input-body-minimal" style={styles.inputBody}>
        {content}
        <View
          {...decorativeAccessibility}
          style={[styles.minimalInputRule, { backgroundColor: focused ? colors.ui.input.focus : colors.ui.input.border }]}
        />
      </View>
    )
  }

  if (family === 'monet') {
    return (
      <View testID="theme-input-body-monet" style={styles.inputBody}>
        <View {...decorativeAccessibility} style={[styles.monetInputWash, { backgroundColor: colors.ui.icon.accentBackground, opacity: focused ? 0.16 : 0.08 }]} />
        <View {...decorativeAccessibility} style={[styles.monetInputEdge, { borderColor: colors.ui.control.focus, opacity: focused ? 0.5 : 0.24 }]} />
        {content}
      </View>
    )
  }

  if (family === 'material') {
    return (
      <View testID="theme-input-body-material" style={styles.inputBody}>
        {content}
        <View {...decorativeAccessibility} style={[styles.materialInputIndicator, { backgroundColor: colors.primary, opacity: focused ? 1 : 0.44 }]} />
      </View>
    )
  }

  return (
    <View testID="theme-input-body-liquid-glass" style={styles.inputBody}>
      <View {...decorativeAccessibility} style={[styles.glassInputPlane, { borderColor: colors.ui.actionBar.itemBorder }]} />
      <View {...decorativeAccessibility} style={[styles.glassInputHighlight, { backgroundColor: colors.ui.semantic.content.inverse, opacity: focused ? 0.34 : 0.18 }]} />
      {content}
    </View>
  )
}

export function ThemeCardExpressionLayers({ family, colors, interactive, titleCard }: CardExpressionLayersProps) {
  if (family === 'minimal') {
    return (
      <View
        {...decorativeAccessibility}
        testID="theme-card-layer-minimal"
        style={[titleCard ? styles.minimalCardRule : styles.minimalCardIndex, { backgroundColor: colors.ui.semantic.chrome.border }]}
      />
    )
  }

  if (family === 'monet') {
    return <View {...decorativeAccessibility} testID="theme-card-layer-monet" style={[styles.monetCardWash, { backgroundColor: colors.ui.icon.accentBackground }]} />
  }

  if (family === 'material') {
    return interactive
      ? <View {...decorativeAccessibility} testID="theme-card-layer-material" style={[styles.materialCardIndicator, { backgroundColor: colors.primary }]} />
      : <View {...decorativeAccessibility} testID="theme-card-layer-material" />
  }

  return <View {...decorativeAccessibility} testID="theme-card-layer-liquid-glass" style={[styles.glassCardPlane, { borderColor: colors.ui.actionBar.itemBorder }]} />
}

const styles = StyleSheet.create({
  row: { position: 'relative', minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  icon: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  label: { minWidth: 0, flexShrink: 1 },
  minimalRule: { position: 'absolute', left: 0, right: 0, bottom: -4, height: 1, opacity: 0.72 },
  monetWash: { position: 'absolute', top: -8, right: -12, width: 72, height: 30, borderRadius: 18, opacity: 0.12 },
  monetEdge: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: 12, borderBottomRightRadius: 14, opacity: 0.24 },
  materialStateLayer: { ...StyleSheet.absoluteFill, opacity: 0.06 },
  materialIndicator: { position: 'absolute', top: 4, bottom: 4, left: 0, width: 2, opacity: 0.72 },
  glassPlane: { ...StyleSheet.absoluteFill, borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, opacity: 0.42 },
  glassHighlight: { position: 'absolute', top: 0, left: 14, right: 14, height: 1, opacity: 0.24 },
  inputBody: { position: 'relative', flex: 1, alignSelf: 'stretch', minWidth: 0, justifyContent: 'center' },
  inputRow: { position: 'relative', flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  inputRowMultiline: { alignItems: 'flex-start' },
  minimalInputRule: { position: 'absolute', left: 0, right: 0, bottom: -1, height: 2 },
  monetInputWash: { position: 'absolute', top: 0, right: -8, width: 96, height: 44, borderRadius: 24 },
  monetInputEdge: { position: 'absolute', top: 2, right: 4, bottom: 2, left: 4, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderTopRightRadius: 20, borderBottomLeftRadius: 20 },
  materialInputIndicator: { position: 'absolute', left: 0, bottom: -1, width: 44, height: 2 },
  glassInputPlane: { ...StyleSheet.absoluteFill, borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, opacity: 0.42 },
  glassInputHighlight: { position: 'absolute', top: 0, left: 18, right: 18, height: 1 },
  minimalCardRule: { position: 'absolute', top: 0, left: 0, right: 0, height: StyleSheet.hairlineWidth },
  minimalCardIndex: { position: 'absolute', top: 10, bottom: 10, left: 0, width: StyleSheet.hairlineWidth },
  monetCardWash: { position: 'absolute', top: -26, right: -16, width: 108, height: 58, borderRadius: 40, opacity: 0.08 },
  materialCardIndicator: { position: 'absolute', left: 0, top: 12, bottom: 12, width: 3, opacity: 0.68 },
  glassCardPlane: { position: 'absolute', top: 2, right: 2, bottom: 2, left: 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, opacity: 0.36 },
})
