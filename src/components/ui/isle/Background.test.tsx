import { act, render } from '@testing-library/react-native'
import { AppState, type AppStateStatus } from 'react-native'

import { useMotionPreference } from '@/hooks/useMotionPreference'
import { getColors } from '@/theme/colors'
import { resolveBackgroundEnvironment } from '@/theme/backgroundEnvironment'
import { IsleBackground } from './Background'

jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: jest.fn(() => 'full') }))
jest.mock('moti', () => ({ MotiView: require('react-native').View }))
jest.mock('./FluidBackdrop', () => ({
  FluidBackdrop: (props: object) => require('react').createElement(require('react-native').View, { ...props, testID: 'flow-props' }),
}))

const colors = getColors('dark', 'liquid-glass')
const environment = resolveBackgroundEnvironment({ family: 'liquid-glass', mode: 'dark', variation: 'fixed' })
const motion = jest.mocked(useMotionPreference)

beforeEach(() => {
  motion.mockReturnValue('full')
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true })
})
afterEach(() => jest.restoreAllMocks())

it('keeps flowing light while typing but freezes it for reduced motion and static mode', async () => {
  const screen = await render(<IsleBackground colors={colors} environment={environment} state="input" />)
  const flow = () => screen.getByTestId('flow-props', { includeHiddenElements: true })
  expect(motion).toHaveBeenCalledWith(true)
  expect(flow().props.animated).toBe(true)
  expect(flow().props.seed).toBe(environment.seed)
  motion.mockReturnValue('reduced')
  await screen.rerender(<IsleBackground colors={colors} environment={environment} />)
  expect(flow().props.animated).toBe(false)
  motion.mockReturnValue('full')
  await screen.rerender(<IsleBackground colors={colors} environment={{ ...environment, motion: 'static' }} />)
  expect(flow().props.animated).toBe(false)
  await screen.rerender(<IsleBackground colors={colors} environment={environment} mode="none" />)
  expect(screen.queryByTestId('flow-props', { includeHiddenElements: true })).toBeNull()
})

it('suspends background work offscreen and resumes through the shared lifecycle gate', async () => {
  let appStateChanged: (state: AppStateStatus) => void = () => undefined
  const remove = jest.fn()
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateChanged = listener
    return { remove }
  })
  const screen = await render(<IsleBackground colors={colors} environment={environment} />)
  const animated = () => screen.getByTestId('flow-props', { includeHiddenElements: true }).props.animated
  expect(animated()).toBe(true)
  await act(() => appStateChanged('background'))
  expect(animated()).toBe(false)
  await act(() => appStateChanged('active'))
  expect(animated()).toBe(true)
  await screen.unmount()
  expect(remove).toHaveBeenCalledTimes(1)
})
