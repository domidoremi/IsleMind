import type { ReactNode } from 'react'
import { PressableScale } from '../PressableScale'

const { renderToStaticMarkup }: { renderToStaticMarkup: (node: ReactNode) => string } = require('react-dom/server')

jest.mock('react-native', () => require('react-native-web'))
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: () => false }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn() }))
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { createAnimatedComponent: (component: unknown) => component },
  useSharedValue: (value: number) => require('react').useRef({ value }).current,
  useAnimatedStyle: (worklet: () => unknown) => worklet(),
  cancelAnimation: jest.fn(),
}))

it('exposes native accessibility states in the actual Web markup', () => {
  const html = renderToStaticMarkup(<PressableScale accessibilityRole="checkbox" accessibilityState={{ checked: 'mixed', expanded: true, selected: false, busy: true }}>Options</PressableScale>)
  expect(html).toContain('role="checkbox"')
  expect(html).toContain('aria-checked="mixed"')
  expect(html).toContain('aria-expanded="true"')
  expect(html).toContain('aria-selected="false"')
  expect(html).toContain('aria-busy="true"')
})

it('preserves explicit ARIA overrides and leaves unspecified states absent', () => {
  const html = renderToStaticMarkup(<PressableScale accessibilityState={{ expanded: true, busy: true }} aria-expanded={false} aria-busy={false}>Options</PressableScale>)
  expect(html).toContain('aria-expanded="false"')
  expect(html).toContain('aria-busy="false"')
  expect(html).not.toContain('aria-checked=')
  expect(html).not.toContain('aria-selected=')
})
