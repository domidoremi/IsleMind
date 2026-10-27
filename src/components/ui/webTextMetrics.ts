import { Platform, StyleSheet, type StyleProp, type TextStyle } from 'react-native'

export function resolveWebTextMetricsStyle(style: StyleProp<TextStyle>): TextStyle | undefined {
  if (Platform.OS !== 'web') return undefined
  const typography = StyleSheet.flatten(style)
  const lineHeight = typography?.lineHeight
  if (!typography || typography.position === 'absolute' ||
      typeof lineHeight !== 'number' || !Number.isFinite(lineHeight) || lineHeight <= 0) return undefined
  const fontSize = typography.fontSize
  if (typeof fontSize === 'number' && (!Number.isFinite(fontSize) || fontSize <= 0)) return undefined
  // RN Web numbers become pixels; em lengths resolve before minimum-font enlargement.
  const relativeLineHeight = typeof fontSize === 'number'
    ? String(Math.max(1.5, lineHeight / fontSize))
    : 'normal'
  return { lineHeight: relativeLineHeight } as unknown as TextStyle
}
