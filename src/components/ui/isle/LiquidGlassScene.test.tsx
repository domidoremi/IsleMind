import { act, render } from '@testing-library/react-native'
import { View } from 'react-native'
import { NavigationContext } from 'expo-router/react-navigation'
import { useTransparencyPreference } from '@/hooks/useTransparencyPreference'
import { useDisplayRefreshRate } from '@/hooks/useDisplayRefreshRate'
import { getColors } from '@/theme/colors'
import { resolveBackgroundEnvironment } from '@/theme/backgroundEnvironment'
import { LiquidGlassScene } from './LiquidGlassScene'

jest.mock('@/hooks/useTransparencyPreference', () => ({ useTransparencyPreference: jest.fn(() => false) }))
jest.mock('@/hooks/useDisplayRefreshRate', () => ({ useDisplayRefreshRate: jest.fn() }))
jest.mock('./LiquidGlassCanvas', () => ({
  liquidCanvasAvailable: true,
  LiquidGlassCanvas: (props: object) => require('react').createElement(require('react-native').View, { ...props, testID: 'gpu-props' }),
}))

const environment = resolveBackgroundEnvironment({ family: 'liquid-glass', mode: 'light' })
const props = { colors: getColors('light', 'liquid-glass'), environment, seed: 119, opacity: 1, animated: true }
const fallback = (animated: boolean) => <View testID="fallback" accessibilityState={{ busy: animated }} />
beforeEach(() => jest.mocked(useTransparencyPreference).mockReturnValue(false))

it('keeps a fallback until the first frame, then restores it if the GPU fails', async () => {
  const screen = await render(<LiquidGlassScene {...props}>{fallback}</LiquidGlassScene>)
  expect(screen.getByTestId('fallback')).toBeTruthy()
  await act(() => screen.getByTestId('gpu-props').props.onReady())
  expect(screen.queryByTestId('fallback')).toBeNull()
  expect(screen.getByTestId('gpu-props').props.style.opacity).toBe(1)
  await act(() => screen.getByTestId('gpu-props').props.onError())
  expect(screen.queryByTestId('gpu-props')).toBeNull()
  expect(screen.getByTestId('fallback')).toBeTruthy()
})

it('renders a still material with reduced motion and releases the GPU for reduced transparency', async () => {
  const screen = await render(<LiquidGlassScene {...props} animated={false}>{fallback}</LiquidGlassScene>)
  expect(screen.getByTestId('gpu-props').props.animated).toBe(false)
  expect(useDisplayRefreshRate).toHaveBeenLastCalledWith(false)
  await screen.rerender(<LiquidGlassScene {...props} environment={{ ...environment, amplitude: 0 }}>{fallback}</LiquidGlassScene>)
  expect(screen.getByTestId('gpu-props').props.animated).toBe(false)
  jest.mocked(useTransparencyPreference).mockReturnValue(true)
  await screen.rerender(<LiquidGlassScene {...props}>{fallback}</LiquidGlassScene>)
  expect(screen.queryByTestId('gpu-props')).toBeNull()
  expect(screen.getByTestId('fallback').props.accessibilityState.busy).toBe(false)
  expect(useDisplayRefreshRate).toHaveBeenLastCalledWith(false)
})

it('owns a context only while the route is focused, awaiting a new frame on return', async () => {
  const listeners: Record<string, () => void> = {}
  const remove = jest.fn()
  const navigation = { isFocused: () => true, addListener: (event: string, callback: () => void) => { listeners[event] = callback; return remove } }
  const screen = await render(<NavigationContext.Provider value={navigation as never}>
    <LiquidGlassScene {...props}>{fallback}</LiquidGlassScene>
  </NavigationContext.Provider>)
  await act(() => screen.getByTestId('gpu-props').props.onReady())
  expect(useDisplayRefreshRate).toHaveBeenLastCalledWith(true)
  await act(() => listeners.blur())
  expect(useDisplayRefreshRate).toHaveBeenLastCalledWith(false)
  expect(screen.queryByTestId('gpu-props')).toBeNull()
  expect(screen.getByTestId('fallback').props.accessibilityState.busy).toBe(false)
  await act(() => listeners.focus())
  expect(useDisplayRefreshRate).toHaveBeenLastCalledWith(true)
  expect(screen.getByTestId('gpu-props').props.style.opacity).toBe(0)
  expect(screen.getByTestId('fallback')).toBeTruthy()
  await screen.unmount()
  expect(remove).toHaveBeenCalledTimes(2)
})
