import { render } from '@testing-library/react-native'
import { Dimensions, StyleSheet } from 'react-native'
import { getColors } from '@/theme/colors'
import { ModelMenu } from './FloatingComposerSurfaces'
import { resolveModelMenuPlacement } from './floatingComposerGeometry'

let mockInsets = { top: 0, right: 0, bottom: 0, left: 0 }
const mockWindow = { width: 872.7272727272727, height: 392.72727272727275, scale: 2.75, fontScale: 1 }

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => mockInsets }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: { strong: 2 } }))
jest.mock('@/components/ui/ProviderBrandIcon', () => ({ ProviderBrandIcon: () => null }))
jest.mock('@/components/ui/HighFrameSpinner', () => ({ HighFrameSpinner: () => null }))
jest.mock('@/components/ui/AppModal', () => ({
  Modal: ({ children }: { children: unknown }) => require('react').createElement(require('react-native').View, null, children),
}))
jest.mock('@/components/ui/isle', () => ({ IslePressable: require('react-native').Pressable }))
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { createAnimatedComponent: (component: unknown) => component },
  useSharedValue: (value: number) => require('react').useRef({ value }).current,
  useAnimatedStyle: (worklet: () => unknown) => worklet(),
  withTiming: (value: number) => value,
  cancelAnimation: jest.fn(),
  runOnJS: (callback: unknown) => callback,
  interpolateColor: () => '',
  Easing: { out: () => undefined, inOut: () => undefined },
}))

beforeEach(() => {
  mockInsets = { top: 0, right: 0, bottom: 0, left: 0 }
})

it('keeps the focused landscape composer menu inside the left cutout inset', () => {
  const placement = resolveModelMenuPlacement({
    anchor: { x: 49.81817626953125, y: 313.0909118652344, width: 44, height: 44 },
    windowWidth: mockWindow.width, windowHeight: mockWindow.height, estimatedMenuHeight: 380,
    safeAreaInsets: { top: 90 / 2.75, left: 90 / 2.75 },
  })
  expect(placement.left).toBeGreaterThanOrEqual(90 / 2.75 + 12)
  expect(placement.width).toBe(272)
  const top = placement.top ?? mockWindow.height - placement.bottom! - placement.maxHeight
  expect(top).toBeGreaterThanOrEqual(90 / 2.75 + 12 - 0.00001)
})

it('keeps the menu inside a right cutout after the opposite landscape rotation', () => {
  const placement = resolveModelMenuPlacement({
    anchor: { x: 800, y: 310, width: 44, height: 44 },
    windowWidth: 873, windowHeight: 393, estimatedMenuHeight: 380,
    safeAreaInsets: { right: 33 },
  })
  expect(placement.left + placement.width).toBeLessThanOrEqual(873 - 33 - 12)
})

it('reserves the bottom system area when a menu opens below its anchor', () => {
  const placement = resolveModelMenuPlacement({
    anchor: { x: 100, y: 40, width: 44, height: 44 },
    windowWidth: 393, windowHeight: 600, estimatedMenuHeight: 380,
    safeAreaInsets: { top: 30, bottom: 48 },
  })
  expect(placement.openAbove).toBe(false)
  expect(placement.top! + placement.maxHeight).toBeLessThanOrEqual(600 - 48 - 12)
})

it('shrinks within a narrow safe region and centers an unanchored menu there', () => {
  const placement = resolveModelMenuPlacement({
    anchor: null, windowWidth: 240, windowHeight: 500, estimatedMenuHeight: 380,
    safeAreaInsets: { left: 33, right: 20, top: 30, bottom: 20 },
  })
  expect(placement.left).toBeGreaterThanOrEqual(33 + 12)
  expect(placement.left + placement.width).toBeLessThanOrEqual(240 - 20 - 12)
  expect(placement.width).toBeGreaterThan(0)
  expect(placement.top).toBeGreaterThanOrEqual(30 + 12)
})

it('preserves normal viewport placement when safe insets are omitted or zero', () => {
  const input = { anchor: { x: 24, y: 580, width: 44, height: 44 }, windowWidth: 393, windowHeight: 852, estimatedMenuHeight: 320 }
  expect(resolveModelMenuPlacement(input)).toEqual({ left: 12, width: 272, maxHeight: 558, openAbove: true, bottom: 282 })
  expect(resolveModelMenuPlacement({ ...input, safeAreaInsets: {} })).toEqual(resolveModelMenuPlacement(input))
})

it('updates the rendered menu when safe insets change without a window resize', async () => {
  const dimensions = jest.spyOn(Dimensions, 'get').mockReturnValue(mockWindow)
  const props = {
    visible: true, anchor: { x: 50, y: 313, width: 44, height: 44 }, items: [],
    colors: getColors('light', 'minimal'), isDark: false, motion: 'reduced' as const,
    onSelect: jest.fn(() => true), onOpenConfiguration: jest.fn(), onClose: jest.fn(),
  }
  try {
    const screen = await render(<ModelMenu {...props} />)
    expect(StyleSheet.flatten(screen.getByTestId('model-menu').props.style).left).toBe(12)
    mockInsets = { top: 33, right: 0, bottom: 24, left: 33 }
    await screen.rerender(<ModelMenu {...props} />)
    const style = StyleSheet.flatten(screen.getByTestId('model-menu').props.style)
    expect(style.left).toBeGreaterThanOrEqual(45)
    expect(mockWindow.height - style.bottom - style.maxHeight).toBeGreaterThanOrEqual(45 - 0.00001)
  } finally {
    dimensions.mockRestore()
  }
})
