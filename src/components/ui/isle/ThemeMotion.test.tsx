import { render } from '@testing-library/react-native'
import { useEffect } from 'react'
import { Text } from 'react-native'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { THEME_MOTION_DURATIONS } from '@/theme/themeTokens'
import { IsleMotionFrame } from './ThemeMotion'

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ canonicalThemeId: 'material' }) }))
jest.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: jest.fn((followSystem) => followSystem ? 'full' : 'reduced'),
}))
jest.mock('./GlassSurface', () => ({ GlassSurfaceActivity: ({ children }: { children: React.ReactNode }) => children }))
jest.mock('moti', () => ({ MotiView: require('react-native').View }))

it('uses the system motion preference for page transitions in non-glass themes too', async () => {
  const screen = await render(<IsleMotionFrame role="page" direction="forward" testID="page" />)
  expect(useMotionPreference).toHaveBeenLastCalledWith(true)
  expect(screen.getByTestId('page').props.transition.duration).toBe(THEME_MOTION_DURATIONS.material.page)
  expect(screen.getByTestId('page').props.from.translateX).toBe(10)
})

it('keeps the conservative preference for non-navigation decoration', async () => {
  const screen = await render(<IsleMotionFrame role="scenic" testID="decoration" />)
  expect(useMotionPreference).toHaveBeenLastCalledWith(false)
  expect(screen.getByTestId('decoration').props.from.translateX).toBe(0)
})

it('keeps critical content visible and preserves mounted children/configuration on updates', async () => {
  const mounted = jest.fn()
  function Child({ text }: { text: string }) {
    useEffect(() => { mounted() }, [])
    return <Text>{text}</Text>
  }
  const tree = (text: string) => <IsleMotionFrame role="page" testID="page"><Child text={text} /></IsleMotionFrame>
  const screen = await render(tree('first'))
  const { from, animate, transition } = screen.getByTestId('page').props
  expect(from.opacity).toBeGreaterThanOrEqual(0.65)
  await screen.rerender(tree('stream update'))
  expect(screen.getByText('stream update')).toBeTruthy()
  expect(screen.getByTestId('page').props.from).toBe(from)
  expect(screen.getByTestId('page').props.animate).toBe(animate)
  expect(screen.getByTestId('page').props.transition).toBe(transition)
  expect(mounted).toHaveBeenCalledTimes(1)
})

it('interpolates layout only for an explicitly opted-in disclosure', async () => {
  const screen = await render(<IsleMotionFrame role="section" layout enter={false} testID="disclosure" />)
  expect(screen.getByTestId('disclosure').props.layout).toBeDefined()
  expect(screen.getByTestId('disclosure').props.from).toBeUndefined()
  const transition = screen.getByTestId('disclosure').props.layout
  await screen.rerender(<IsleMotionFrame role="section" layout enter={false} testID="disclosure"><Text>Expanded</Text></IsleMotionFrame>)
  expect(screen.getByTestId('disclosure').props.layout).toBe(transition)
})

it.each(['reduced', 'none'] as const)('does not interpolate disclosure layout with %s motion', async motion => {
  const screen = await render(<IsleMotionFrame role="section" layout motion={motion} testID="disclosure" />)
  expect(screen.getByTestId('disclosure').props.layout).toBeUndefined()
  if (motion === 'none') {
    expect(screen.getByTestId('disclosure').props.from).toBeUndefined()
    expect(screen.getByTestId('disclosure').props.transition.duration).toBe(0)
  } else {
    expect(screen.getByTestId('disclosure').props.from.translateX).toBe(0)
    expect(screen.getByTestId('disclosure').props.from.translateY).toBe(0)
    expect(screen.getByTestId('disclosure').props.from.scale).toBe(1)
  }
})

it('does not add layout animation to reading or streamed content', async () => {
  const screen = await render(<IsleMotionFrame role="section" testID="reading"><Text>Original text</Text></IsleMotionFrame>)
  expect(screen.getByTestId('reading').props.layout).toBeUndefined()
  await screen.rerender(<IsleMotionFrame role="section" testID="reading"><Text>More streamed text</Text></IsleMotionFrame>)
  expect(screen.getByTestId('reading').props.layout).toBeUndefined()
})
