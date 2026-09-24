import { render } from '@testing-library/react-native'
import { StatusBar, StyleSheet, Text } from 'react-native'

import { useAppTheme } from '@/hooks/useAppTheme'
import { getColors } from '@/theme/colors'
import { resolveBackgroundEnvironment } from '@/theme/backgroundEnvironment'
import type { CanonicalThemeId } from '@/types/settingsContracts'
import { resolveBackgroundCanvas, type IsleBackgroundMode } from './Background'
import { IsleScreen } from './Screen'

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: jest.fn() }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('@/hooks/useTransparencyPreference', () => ({ useTransparencyPreference: () => false }))
jest.mock('moti', () => ({ MotiView: require('react-native').View }))
jest.mock('expo-blur', () => ({ BlurView: require('react-native').View, BlurTargetView: require('react-native').View }))
jest.mock('./Background', () => ({
  ...jest.requireActual('./Background'),
  IsleBackground: jest.fn((props) => require('react').createElement(require('react-native').View, {
    ...props, testID: 'screen-backdrop', style: require('react-native').StyleSheet.absoluteFill,
  })),
}))

beforeEach(() => {
  jest.spyOn(StatusBar, 'pushStackEntry')
  jest.spyOn(StatusBar, 'replaceStackEntry')
})
afterEach(() => jest.restoreAllMocks())

function setTheme(family: CanonicalThemeId, mode: 'light' | 'dark') {
  const colors = getColors(mode, family)
  jest.mocked(useAppTheme).mockReturnValue({
    colors, isDark: mode === 'dark', isLiquidGlass: family === 'liquid-glass',
    backgroundEnvironment: resolveBackgroundEnvironment({ family, mode, variation: 'fixed' }),
  } as ReturnType<typeof useAppTheme>)
  return colors
}

const families: CanonicalThemeId[] = ['minimal', 'monet', 'material', 'liquid-glass', 'animal-island-ui']

describe.each(families)('%s screen immersion', (family) => {
  it.each(['light', 'dark'] as const)('keeps the %s background outside the safe area while protecting content', async (mode) => {
    const colors = setTheme(family, mode)
    const view = await render(<IsleScreen><Text>Content</Text></IsleScreen>)
    const safeArea = view.container.queryAll((node) => node.props.edges !== undefined)[0]
    expect(safeArea).toBeDefined()
    expect(safeArea.queryAll((node) => node.props.testID === 'screen-backdrop')).toHaveLength(0)
    expect(StyleSheet.flatten(safeArea.props.style)).toMatchObject({ flex: 1, backgroundColor: 'transparent' })
    expect(safeArea.props.edges).toEqual({ top: 'additive', bottom: 'additive', left: 'additive', right: 'additive' })
    expect(safeArea.queryAll((node) => node.props.children === 'Content')).toHaveLength(1)
    expect(StatusBar.pushStackEntry).toHaveBeenLastCalledWith(expect.objectContaining({
      barStyle: mode === 'dark' ? 'light-content' : 'dark-content',
      backgroundColor: 'transparent', translucent: true,
    }))
    const backdrop = view.getByTestId('screen-backdrop')
    expect(backdrop.props.colors).toBe(colors)
    const backgroundLayer = family === 'liquid-glass' ? backdrop.parent! : backdrop
    expect(backgroundLayer.parent).toBe(safeArea.parent)
    const layers = safeArea.parent!.children
    expect(layers.indexOf(backgroundLayer)).toBeLessThan(layers.indexOf(safeArea))
    if (family === 'liquid-glass') {
      const target = backdrop.parent!
      expect(target.queryAll((node) => node.props.edges !== undefined)).toHaveLength(0)
      expect(StyleSheet.flatten(target.props.style)).toMatchObject({ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 })
    }
  })
})

it.each(['default', 'focus', 'surface', 'none'] as IsleBackgroundMode[])('preserves caller layout and the %s canvas without putting it inside the insets', async (background) => {
  const colors = setTheme('monet', 'light')
  const edges = ['left', 'right', 'bottom'] as const
  const view = await render(<IsleScreen background={background} padded={false} edges={edges} style={{ paddingTop: 7 }}>
    <Text>Chat manages its own top inset</Text>
  </IsleScreen>)
  const safeArea = view.container.queryAll((node) => node.props.edges !== undefined)[0]
  expect(safeArea.props.edges).toEqual({ top: 'off', bottom: 'additive', left: 'additive', right: 'additive' })
  expect(view.getByTestId('screen-backdrop').props.mode).toBe(background)
  const containers = view.container.queryAll((node) => node.type === 'View').map((node) => StyleSheet.flatten(node.props.style))
  expect(containers).toContainEqual(expect.objectContaining({ flex: 1, backgroundColor: resolveBackgroundCanvas(colors, background) }))
  expect(containers).toContainEqual(expect.objectContaining({ paddingHorizontal: 0, paddingTop: 7 }))
})

it('updates icon contrast without restoring an opaque strip when switching theme modes', async () => {
  setTheme('liquid-glass', 'dark')
  const view = await render(<IsleScreen><Text>Settings</Text></IsleScreen>)
  setTheme('animal-island-ui', 'light')
  await view.rerender(<IsleScreen><Text>Settings</Text></IsleScreen>)
  expect(StatusBar.replaceStackEntry).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ barStyle: 'dark-content', backgroundColor: 'transparent', translucent: true }))
})
