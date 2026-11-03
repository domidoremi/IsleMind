import { act, render } from '@testing-library/react-native'
import { AppState, type AppStateStatus } from 'react-native'

import { useMotionPreference } from '@/hooks/useMotionPreference'
import { getColors } from '@/theme/colors'
import { resolveBackgroundEnvironment } from '@/theme/backgroundEnvironment'
import { IsleBackground, type IsleBackgroundMode, type IsleBackgroundState } from './Background'

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

it.each([
  ['minimal', 'light'], ['minimal', 'dark'], ['material', 'light'], ['material', 'dark'],
] as const)('renders no %s/%s artwork or background work even with immersive preferences', async (family, mode) => {
  const lifecycle = jest.spyOn(AppState, 'addEventListener')
  const interval = jest.spyOn(globalThis, 'setInterval')
  const plainColors = getColors(mode, family)
  const plainEnvironment = resolveBackgroundEnvironment({
    family, mode, motion: 'immersive', intensity: 'high', variation: 'random',
  })
  const screen = await render(<IsleBackground colors={plainColors} environment={plainEnvironment} />)
  for (const background of ['default', 'plain', 'ambient', 'focus', 'surface', 'none'] satisfies IsleBackgroundMode[]) {
    for (const state of ['idle', 'active', 'input', 'modal', 'error'] satisfies IsleBackgroundState[]) {
      await screen.rerender(<IsleBackground colors={plainColors} environment={plainEnvironment} mode={background} state={state} />)
      expect(screen.container.queryAll((node) => node.type === 'View')).toHaveLength(0)
    }
  }
  expect(motion).not.toHaveBeenCalled()
  expect(lifecycle).not.toHaveBeenCalled()
  expect(interval).not.toHaveBeenCalled()
})

it.each(['none', 'zero-intensity'] as const)('%s does not instantiate an invisible scene or keep its timers running', async (disabled) => {
  const lifecycle = jest.spyOn(AppState, 'addEventListener')
  const interval = jest.spyOn(globalThis, 'setInterval')
  const screen = await render(<IsleBackground colors={colors} environment={{ ...environment, variation: 'random' }}
    mode={disabled === 'none' ? 'none' : 'default'} intensity={disabled === 'zero-intensity' ? 0 : 1} />)
  expect(screen.container.queryAll((node) => node.type === 'View')).toHaveLength(0)
  expect(motion).not.toHaveBeenCalled()
  expect(lifecycle).not.toHaveBeenCalled()
  expect(interval).not.toHaveBeenCalled()
})

it('disposes scene subscriptions and variation timers when decoration is disabled or changes to a plain family', async () => {
  const remove = jest.fn()
  const lifecycle = jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove })
  const interval = jest.spyOn(globalThis, 'setInterval')
  const clear = jest.spyOn(globalThis, 'clearInterval')
  const rotatingEnvironment = { ...environment, variation: 'random' as const }
  const screen = await render(<IsleBackground colors={colors} environment={rotatingEnvironment} />)
  expect(lifecycle).toHaveBeenCalledTimes(1)
  expect(interval).toHaveBeenCalledTimes(1)
  const firstTimer = interval.mock.results[0].value
  await screen.rerender(<IsleBackground colors={colors} environment={rotatingEnvironment} mode="none" />)
  expect(remove).toHaveBeenCalledTimes(1)
  expect(clear).toHaveBeenCalledWith(firstTimer)
  await screen.rerender(<IsleBackground colors={colors} environment={rotatingEnvironment} />)
  expect(lifecycle).toHaveBeenCalledTimes(2)
  expect(interval).toHaveBeenCalledTimes(2)
  const secondTimer = interval.mock.results[1].value
  await screen.rerender(<IsleBackground colors={getColors('dark', 'material')}
    environment={resolveBackgroundEnvironment({ family: 'material', mode: 'dark', variation: 'random' })} />)
  expect(remove).toHaveBeenCalledTimes(2)
  expect(clear).toHaveBeenCalledWith(secondTimer)
  expect(screen.container.queryAll((node) => node.type === 'View')).toHaveLength(0)
})

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
