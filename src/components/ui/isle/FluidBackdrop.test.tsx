import { render } from '@testing-library/react-native'
import { Platform, StyleSheet } from 'react-native'
import { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'

import { getColors } from '@/theme/colors'
import { resolveBackgroundEnvironment } from '@/theme/backgroundEnvironment'
import { FluidBackdrop, resolveFluidArtworkScale } from './FluidBackdrop'

// These assertions exercise the retained SVG fallback, not native GPU mocks.
jest.mock('./LiquidGlassCanvas', () => ({ liquidCanvasAvailable: false, LiquidGlassCanvas: () => null }))
jest.mock('@/hooks/useTransparencyPreference', () => ({ useTransparencyPreference: () => false }))

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: require('react-native').View },
  useSharedValue: jest.fn((value: number) => require('react').useRef({ value }).current),
  useAnimatedStyle: jest.fn((factory: () => object) => factory()),
  Easing: { linear: (value: number) => value },
  withTiming: jest.fn((value: number) => value),
  withRepeat: jest.fn((value: number) => value),
  cancelAnimation: jest.fn(),
}))

const colors = getColors('light', 'liquid-glass')
const environment = resolveBackgroundEnvironment({ family: 'liquid-glass', mode: 'light' })
const props = { colors, environment, seed: environment.seed, opacity: 1 }

beforeEach(() => jest.clearAllMocks())

it('bounds the environment to three layers and one cancellable animation clock', async () => {
  const screen = await render(<FluidBackdrop {...props} animated />)
  for (const layer of ['near', 'far', 'caustic']) expect(screen.getByTestId(`liquid-flow-${layer}`)).toBeTruthy()
  expect(withRepeat).toHaveBeenCalledTimes(1)
  expect(withTiming).toHaveBeenCalledWith(1, expect.objectContaining({ duration: environment.cycleMs }))
  await screen.rerender(<FluidBackdrop {...props} animated={false} />)
  expect(cancelAnimation).toHaveBeenCalledTimes(1)
  expect(withRepeat).toHaveBeenCalledTimes(1)
  await screen.rerender(<FluidBackdrop {...props} animated />)
  expect(withRepeat).toHaveBeenCalledTimes(2)
  // The resumed clock continues its phase instead of assigning zero.
  expect(withTiming).toHaveBeenLastCalledWith(2, expect.any(Object))
  await screen.unmount()
  expect(cancelAnimation).toHaveBeenCalledTimes(3)
})

it('does not schedule loops for a static environment', async () => {
  await render(<FluidBackdrop {...props} environment={{ ...environment, amplitude: 0 }} animated />)
  expect(withRepeat).not.toHaveBeenCalled()
})

it.each(['android', 'ios', 'web'] as const)('keeps the same artwork bounds with platform-specific raster sizing (%s)', async (platform) => {
  const platformMock = jest.replaceProperty(Platform, 'OS', platform)
  try {
    const screen = await render(<FluidBackdrop {...props} animated />)
    const artwork = ['near', 'far', 'caustic'].map((layer) => screen.getByTestId(`liquid-flow-${layer}-raster`))
    for (const node of artwork) {
      const style = StyleSheet.flatten(node.props.style)
      expect(style.width).toBe(style.height)
      const size = parseFloat(style.width) / 100
      if (platform === 'android') {
        expect(size).toBeLessThan(1)
        expect(style.transformOrigin).toBe('top left')
        expect(size * style.transform[0].scale).toBeCloseTo(1)
      } else {
        expect(size).toBe(1)
        expect(style.transform).toBeUndefined()
      }
    }
    await screen.rerender(<FluidBackdrop {...props} animated={false} />)
    expect(screen.getByTestId('liquid-flow-near-raster').props.style).toEqual(artwork[0].props.style)
  } finally {
    platformMock.restore()
  }
})

it('caps Android soft-artwork raster edges in physical pixels without upsampling small canvases', () => {
  for (const [width, height, density] of [[800, 1400, 3], [1400, 800, 3], [1600, 2560, 2]]) {
    const scale = resolveFluidArtworkScale('android', width, height, density)
    expect(Math.max(width, height) * density * scale).toBeCloseTo(1024)
  }
  expect(resolveFluidArtworkScale('android', 200, 300, 2)).toBe(1)
  expect(resolveFluidArtworkScale('ios', 800, 1400, 3)).toBe(1)
  expect(resolveFluidArtworkScale('web', 800, 1400, 3)).toBe(1)
})

it.each([90, 120, 144])('updates every light layer on each %i Hz display tick without a frame-rate cap', async (refreshRate) => {
  await render(<FluidBackdrop {...props} animated />)
  const clock = jest.mocked(useSharedValue).mock.results[0].value
  const styles = jest.mocked(useAnimatedStyle).mock.calls.map(([factory]) => factory)
  expect(styles).toHaveLength(3)
  const samples = Array.from({ length: refreshRate }, (_, frame) => {
    clock.value = frame / (refreshRate * environment.cycleMs / 1000)
    return styles.map((factory) => JSON.stringify(factory()))
  })
  for (let layer = 0; layer < styles.length; layer += 1) {
    expect(new Set(samples.map((sample) => sample[layer])).size).toBe(refreshRate)
  }
})
