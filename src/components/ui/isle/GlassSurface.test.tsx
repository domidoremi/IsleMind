import { fireEvent, render } from '@testing-library/react-native'
import { Platform, StyleSheet, Text, View } from 'react-native'

import { useTransparencyPreference } from '@/hooks/useTransparencyPreference'
import { getColors } from '@/theme/colors'

jest.mock('@/hooks/useTransparencyPreference', () => ({ useTransparencyPreference: jest.fn(() => false) }))
jest.mock('expo-blur', () => {
  const React = require('react')
  const { View } = require('react-native')
  return {
    BlurView: View,
    // Model native attachment; the test does not pretend to exercise a GPU blur.
    BlurTargetView: React.forwardRef((props: object, ref: (target: object | null) => void) => {
      React.useEffect(() => { ref({}); return () => ref(null) }, [ref])
      return React.createElement(View, props)
    }),
  }
})

Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true })
Object.defineProperty(Platform, 'Version', { value: 31, configurable: true })
const { GlassBackdropProvider, GlassBackdropTarget, GlassSurface, GlassSurfaceActivity, resolveGlassCapability } = require('./GlassSurface') as typeof import('./GlassSurface')
const colors = getColors('dark', 'liquid-glass')
const transparency = jest.mocked(useTransparencyPreference)

beforeEach(() => transparency.mockReturnValue(false))

it.each([
  ['android', 30, false, false],
  ['android', 31, true, true],
  ['android', '31', true, true],
  ['android', 'unknown', false, false],
  ['ios', 18, true, false],
  ['web', undefined, true, false],
  ['unknown', undefined, false, false],
] as const)('bounds blur capability on %s / %s', (platform, version, realtime, targeted) => {
  expect(resolveGlassCapability(platform, version)).toMatchObject({
    realtimeBlurSupported: realtime,
    targetedBackdropSupported: targeted,
    maxLayersPerRegion: realtime ? 1 : 0,
  })
})

it('uses a solid material until an Android environmental target is attached', async () => {
  const screen = await render(
    <GlassBackdropProvider><GlassSurface colors={colors}><Text>Header</Text></GlassSurface></GlassBackdropProvider>,
  )
  expect(screen.queryByTestId('glass-backdrop-blur', { includeHiddenElements: true })).toBeNull()
  expect(StyleSheet.flatten(screen.getByTestId('glass-tint', { includeHiddenElements: true }).props.style).backgroundColor)
    .toBe(colors.design!.semantic.color.surface)
})

it('owns one clipped material with a matching radius and no Android elevation', async () => {
  const screen = await render(
    <GlassBackdropProvider>
      <GlassBackdropTarget><View /></GlassBackdropTarget>
      <GlassSurface colors={colors} borderRadius={28} testID="lens" style={{ padding: 8, elevation: 5, backgroundColor: 'red' }}>
        <Text>Readable content</Text>
      </GlassSurface>
    </GlassBackdropProvider>,
  )
  const material = screen.getByTestId('glass-material', { includeHiddenElements: true })
  const blur = screen.getByTestId('glass-backdrop-blur', { includeHiddenElements: true })
  expect(screen.getAllByTestId('glass-material', { includeHiddenElements: true })).toHaveLength(1)
  expect(StyleSheet.flatten(material.props.style)).toMatchObject({ borderRadius: 28, overflow: 'hidden' })
  expect(StyleSheet.flatten(blur.props.style)).toMatchObject({ borderRadius: 28, overflow: 'hidden' })
  expect(blur.props.blurMethod).toBe('dimezisBlurViewSdk31Plus')
  expect(blur.props.blurTarget.current).not.toBeNull()
  expect(StyleSheet.flatten(screen.getByTestId('lens').props.style)).toMatchObject({
    backgroundColor: 'transparent', elevation: 0, shadowOpacity: 0, padding: 8,
    overflow: 'hidden', borderCurve: 'circular',
    boxShadow: '0 5px 18px rgba(0, 5, 15, 0.22)',
  })
  expect(material.props.pointerEvents).toBe('none')
  expect(screen.getByText('Readable content')).toBeTruthy()
})

it('uses the caller radius for both the material and content clip and retains press handling', async () => {
  const onPress = jest.fn()
  const screen = await render(<GlassSurface interactive colors={colors} onPress={onPress} accessibilityRole="button"
    accessibilityLabel="Card" style={{ borderRadius: 12, overflow: 'visible', padding: 6, position: 'absolute' }}>
    <View style={{ backgroundColor: 'red', height: 80 }} />
  </GlassSurface>)
  expect(screen.getByRole('button', { name: 'Card' })).toHaveStyle({ borderRadius: 12, overflow: 'hidden', position: 'absolute' })
  expect(screen.getByTestId('glass-material', { includeHiddenElements: true })).toHaveStyle({ borderRadius: 12, overflow: 'hidden' })
  await fireEvent.press(screen.getByRole('button', { name: 'Card' }))
  expect(onPress).toHaveBeenCalledTimes(1)
})

it('never samples a target descendant or adds a second blur inside a glass surface', async () => {
  const screen = await render(
    <GlassBackdropProvider>
      <GlassBackdropTarget><GlassSurface colors={colors}><Text>Inside target</Text></GlassSurface></GlassBackdropTarget>
      <GlassSurface colors={colors}>
        <GlassSurface colors={colors} testID="nested"><Text>Nested content</Text></GlassSurface>
      </GlassSurface>
    </GlassBackdropProvider>,
  )
  expect(screen.getAllByTestId('glass-backdrop-blur', { includeHiddenElements: true })).toHaveLength(1)
  expect(screen.getByTestId('nested')).toHaveStyle({ boxShadow: 'none', elevation: 0, shadowOpacity: 0 })
})

it('preserves content when transparency is reduced or the screen disables glass', async () => {
  const content = (enabled = true) => (
    <GlassBackdropProvider enabled={enabled}>
      <GlassBackdropTarget><View /></GlassBackdropTarget>
      <GlassSurface colors={colors}><Text>Persistent content</Text></GlassSurface>
    </GlassBackdropProvider>
  )
  const screen = await render(content())
  const text = screen.getByText('Persistent content')
  transparency.mockReturnValue(true)
  await screen.rerender(content())
  expect(screen.queryByTestId('glass-backdrop-blur', { includeHiddenElements: true })).toBeNull()
  expect(screen.getByText('Persistent content')).toBe(text)
  transparency.mockReturnValue(false)
  await screen.rerender(content(false))
  expect(screen.queryByTestId('glass-backdrop-blur', { includeHiddenElements: true })).toBeNull()
  expect(screen.getByText('Persistent content')).toBe(text)
})

it('suspends hidden-page blur without remounting retained content', async () => {
  const content = (active: boolean) => (
    <GlassBackdropProvider>
      <GlassBackdropTarget><View /></GlassBackdropTarget>
      <GlassSurfaceActivity active={active}>
        <GlassSurface colors={colors}><Text>Retained draft</Text></GlassSurface>
      </GlassSurfaceActivity>
    </GlassBackdropProvider>
  )
  const screen = await render(content(true))
  const text = screen.getByText('Retained draft')
  expect(screen.getAllByTestId('glass-backdrop-blur', { includeHiddenElements: true })).toHaveLength(1)
  await screen.rerender(content(false))
  expect(screen.queryByTestId('glass-backdrop-blur', { includeHiddenElements: true })).toBeNull()
  expect(screen.getByText('Retained draft')).toBe(text)
  await screen.rerender(content(true))
  expect(screen.getAllByTestId('glass-backdrop-blur', { includeHiddenElements: true })).toHaveLength(1)
  expect(screen.getByText('Retained draft')).toBe(text)
})

it('puts keyboard focus on the outer curved rim without adding an inner fill', async () => {
  const screen = await render(<GlassSurface colors={colors} focused><Text>Draft</Text></GlassSurface>)
  await fireEvent(screen.getByTestId('glass-optics', { includeHiddenElements: true }), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 64 } },
  })
  const rim = screen.getByTestId('glass-rim', { includeHiddenElements: true })
  expect(rim.props.rx).toBe(28)
  // react-native-svg lowers fill="none" to the native null paint.
  expect(rim.props.fill).toBeNull()
  expect(rim.props.strokeWidth).toBe(3)
  expect(screen.getAllByTestId('glass-material', { includeHiddenElements: true })).toHaveLength(1)
})

it('updates native SVG geometry when a focused composer expands without remounting its content', async () => {
  const screen = await render(<GlassSurface colors={colors} focused><Text>Persistent draft</Text></GlassSurface>)
  const text = screen.getByText('Persistent draft')
  const optics = screen.getByTestId('glass-optics', { includeHiddenElements: true })
  for (const [width, height] of [[320, 64], [390, 64], [390, 240], [320, 64]]) {
    await fireEvent(optics, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width, height } } })
    expect(screen.getByTestId('glass-rim', { includeHiddenElements: true }).props).toMatchObject({ width, height, rx: 28 })
    expect(screen.getByText('Persistent draft')).toBe(text)
  }
})
