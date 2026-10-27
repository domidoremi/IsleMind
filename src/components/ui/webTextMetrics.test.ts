import { Platform, StyleSheet, type TextStyle } from 'react-native'
import { resolveWebTextMetricsStyle } from './webTextMetrics'

function onPlatform(os: 'web' | 'ios' | 'android', operation: () => void) {
  const descriptor = Object.getOwnPropertyDescriptor(Platform, 'OS')!
  Object.defineProperty(Platform, 'OS', { configurable: true, value: os })
  try { operation() }
  finally { Object.defineProperty(Platform, 'OS', descriptor) }
}

it.each(['ios', 'android'] as const)('does not rewrite numeric metrics on %s', os => {
  onPlatform(os, () => {
    const style = { fontSize: 12, lineHeight: 16 }
    expect(resolveWebTextMetricsStyle(style)).toBeUndefined()
    expect(style).toEqual({ fontSize: 12, lineHeight: 16 })
  })
})

it.each([
  [12, 16, '1.5'],
  [14, 20, '1.5'],
  [20, 36, '1.8'],
  [17, 26, String(26 / 17)],
] as const)('keeps %s/%s typography relative to the computed web font', (fontSize, lineHeight, expected) => {
  onPlatform('web', () => {
    expect(resolveWebTextMetricsStyle({ fontSize, lineHeight })?.lineHeight).toBe(expected)
  })
})

it('uses registered and final array styles without mutating their inputs', () => {
  onPlatform('web', () => {
    const registered = StyleSheet.create({ text: { fontSize: 10, lineHeight: 14, color: '#123456' } })
    const override = { fontSize: 20, lineHeight: 34 }
    expect(resolveWebTextMetricsStyle([false, registered.text, override, null])?.lineHeight).toBe('1.7')
    expect(override).toEqual({ fontSize: 20, lineHeight: 34 })
    expect(StyleSheet.flatten(registered.text)).toEqual({ fontSize: 10, lineHeight: 14, color: '#123456' })
  })
})

it('uses browser font metrics when font size is inherited rather than guessing a base', () => {
  onPlatform('web', () => {
    expect(resolveWebTextMetricsStyle({ lineHeight: 20 })?.lineHeight).toBe('normal')
    expect(resolveWebTextMetricsStyle(undefined)).toBeUndefined()
  })
})

it('keeps explicit CSS line heights instead of converting them twice', () => {
  onPlatform('web', () => {
    const style = { fontSize: 20, lineHeight: '1.8em' } as unknown as TextStyle
    expect(resolveWebTextMetricsStyle(style)).toBeUndefined()
    expect(style.lineHeight).toBe('1.8em')
  })
})

it('does not reinterpret absolute glyph-positioning geometry as body typography', () => {
  onPlatform('web', () => {
    const style: TextStyle = { position: 'absolute', top: 0, bottom: 0, fontSize: 10, lineHeight: 28 }
    expect(resolveWebTextMetricsStyle(style)).toBeUndefined()
    expect(style.lineHeight).toBe(28)
  })
})

it('does not manufacture CSS from invalid numeric or absent metrics', () => {
  onPlatform('web', () => {
    for (const style of [
      { fontSize: 12, lineHeight: Number.NaN },
      { fontSize: 12, lineHeight: -1 },
      { fontSize: Number.POSITIVE_INFINITY, lineHeight: 20 },
      { fontSize: 0, lineHeight: 20 },
      { fontSize: 12 },
    ]) expect(resolveWebTextMetricsStyle(style)).toBeUndefined()
  })
})

it('passes a unitless ratio through the installed RN Web compiler instead of a fixed pixel or em length', () => {
  onPlatform('web', () => {
    const compile = jest.requireActual<(style: TextStyle) => Record<string, unknown>>(
      'react-native-web/dist/cjs/exports/StyleSheet/compiler/createReactDOMStyle',
    )
    const style = { fontSize: 12, lineHeight: 16 }
    expect(compile(style).lineHeight).toBe('16px')
    expect(compile({ ...style, ...resolveWebTextMetricsStyle(style) }).lineHeight).toBe('1.5')
  })
})
