import { fireEvent, render } from '@testing-library/react-native'
import { Text } from 'react-native'
import { cancelAnimation, useSharedValue, withTiming } from 'react-native-reanimated'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { PressableScale } from '../PressableScale'

jest.mock('@/store/settingsStore', () => ({ useSettingsStore: () => false }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: jest.fn(() => 'full') }))
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn() }))
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { createAnimatedComponent: (component: unknown) => component },
  useSharedValue: jest.fn((value) => require('react').useRef({ value }).current),
  useAnimatedStyle: (worklet: () => unknown) => worklet(),
  withTiming: jest.fn((value: number) => value),
  withSpring: (value: number) => value,
  cancelAnimation: jest.fn(),
  Easing: { out: () => undefined, inOut: () => undefined, bezier: () => undefined },
}))

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(useMotionPreference).mockReturnValue('full')
})

it('executes the action immediately and cancels interrupted interaction state when disabled', async () => {
  const onPress = jest.fn()
  const tree = (disabled = false) => <PressableScale testID="action" disabled={disabled} interactionProfile="fluid" onPress={onPress}><Text>Save</Text></PressableScale>
  const screen = await render(tree())
  expect(useMotionPreference).toHaveBeenCalledWith(true)
  const progress = jest.mocked(useSharedValue).mock.results.slice(0, 3).map(result => result.value)
  await fireEvent(screen.getByTestId('action'), 'pressIn')
  await fireEvent(screen.getByTestId('action'), 'hoverIn')
  await fireEvent(screen.getByTestId('action'), 'focus')
  expect(progress.map(value => value.value)).toEqual([1, 1, 1])
  await fireEvent.press(screen.getByTestId('action'))
  expect(onPress).toHaveBeenCalledTimes(1)
  await screen.rerender(tree(true))
  expect(progress.map(value => value.value)).toEqual([0, 0, 0])
  expect(cancelAnimation).toHaveBeenCalledTimes(3)
  await fireEvent.press(screen.getByTestId('action'))
  expect(onPress).toHaveBeenCalledTimes(1)
})

it('resets a held press when the OS requests reduced motion', async () => {
  const screen = await render(<PressableScale testID="action" />)
  const progress = jest.mocked(useSharedValue).mock.results[0].value
  await fireEvent(screen.getByTestId('action'), 'pressIn')
  expect(progress.value).toBe(1)
  jest.mocked(useMotionPreference).mockReturnValue('reduced')
  await screen.rerender(<PressableScale testID="action" />)
  expect(progress.value).toBe(0)
  expect(screen.getByTestId('action')).toHaveStyle({ transform: [{ scale: 1 }] })
})

it.each([
  ['precision', 0.988, 72],
  ['organic', 0.992, 96],
] as const)('makes %s presses perceptible without changing layout dimensions', async (profile, scale, duration) => {
  const button = () => <PressableScale testID="action" interactionProfile={profile} style={{ minWidth: 44, minHeight: 44 }} />
  const screen = await render(button())
  await fireEvent(screen.getByTestId('action'), 'pressIn')
  await screen.rerender(button())
  expect(screen.getByTestId('action')).toHaveStyle({ minWidth: 44, minHeight: 44, transform: [{ scale }] })
  expect(withTiming).toHaveBeenCalledWith(1, expect.objectContaining({ duration }))
  await fireEvent(screen.getByTestId('action'), 'pressOut')
  await screen.rerender(button())
  expect(screen.getByTestId('action')).toHaveStyle({ transform: [{ scale: 1 }] })
})

it.each(['precision', 'organic'] as const)('keeps keyboard focus geometry steady in %s controls', async profile => {
  const button = () => <PressableScale testID="action" interactionProfile={profile} />
  const screen = await render(button())
  await fireEvent(screen.getByTestId('action'), 'focus')
  await screen.rerender(button())
  expect(screen.getByTestId('action')).toHaveStyle({ transform: [{ scale: 1 }] })
})
