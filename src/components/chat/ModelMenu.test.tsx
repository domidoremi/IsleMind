import { act, fireEvent, render } from '@testing-library/react-native'
import { Platform, StyleSheet } from 'react-native'
import { cancelAnimation } from 'react-native-reanimated'
import { getColors } from '@/theme/colors'
import { ModelMenu, type ModelMenuItem } from './FloatingComposerSurfaces'

const mockCompletions: Array<(finished: boolean) => void> = []
let mockAnimatedProgress: number | undefined

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
jest.mock('@/components/ui/AppIcon', () => ({
  AppIcon: () => null,
  appIconStroke: { strong: 2, bold: 2 },
}))
jest.mock('@/components/ui/ProviderBrandIcon', () => ({
  ProviderBrandIcon: () => null,
}))
jest.mock('@/components/ui/HighFrameSpinner', () => ({
  HighFrameSpinner: () => null,
}))
jest.mock('@/components/ui/AppModal', () => ({
  Modal: ({ visible, children, onRequestClose }: { visible: boolean; children: unknown; onRequestClose: () => void }) => visible
    ? require('react').createElement(require('react-native').View, { testID: 'model-menu-modal', onRequestClose }, children)
    : null,
}))
jest.mock('@/components/ui/isle', () => ({
  IslePressable: require('react-native').Pressable,
}))
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { createAnimatedComponent: (component: unknown) => component },
  useSharedValue: (value: number) => require('react').useRef({ value }).current,
  useAnimatedStyle: (worklet: () => unknown) => worklet(),
  withTiming: (value: number, _config: unknown, completion?: (finished: boolean) => void) => {
    if (completion) mockCompletions.push(completion)
    return mockAnimatedProgress ?? value
  },
  cancelAnimation: jest.fn(),
  runOnJS: (callback: unknown) => callback,
  interpolateColor: () => '',
  Easing: { out: () => undefined, inOut: () => undefined },
}))

const items: ModelMenuItem[] = [
  { id: 'one:model-a', providerId: 'one', providerLabel: 'Connection A', model: 'model-a', modelLabel: 'Model A', brand: 'generic' },
  { id: 'two:model-b', providerId: 'two', providerLabel: 'Connection B', model: 'model-b', modelLabel: 'Model B', brand: 'generic' },
]

const baseProps = {
  visible: true,
  anchor: { x: 24, y: 580, width: 44, height: 44 },
  items,
  selectedId: items[0].id,
  colors: getColors('light', 'minimal'),
  isDark: false,
  motion: 'full' as const,
  onSelect: jest.fn(() => true),
  onOpenConfiguration: jest.fn(),
  onClose: jest.fn(),
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCompletions.length = 0
  mockAnimatedProgress = undefined
  baseProps.onSelect.mockReturnValue(true)
})

it.each(['minimal', 'monet', 'material', 'liquid-glass', 'animal-island-ui'] as const)(
  '%s uses a theme divider instead of a default black header border',
  async family => {
    const colors = getColors('light', family)
    const screen = await render(<ModelMenu {...baseProps} colors={colors} />)
    expect(screen.getByTestId('model-menu-header')).toHaveStyle({
      borderBottomColor: colors.ui.section.divider,
    })
  },
)

it.each([false, 'throw'] as const)('retains the menu after rejected selection (%s)', async outcome => {
  const onSelect = jest.fn(() => {
    if (outcome === 'throw') throw new Error('selection failed')
    return false
  })
  const screen = await render(<ModelMenu {...baseProps} onSelect={onSelect} />)
  await fireEvent.press(screen.getByLabelText('Connection B \u00b7 Model B'))
  expect(onSelect).toHaveBeenCalledWith(items[1])
  expect(baseProps.onClose).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('chat.modelSwitchBlocked')
  expect(screen.getByTestId('model-menu')).toBeTruthy()
})

it('dismisses only after a successful selection and clears a previous rejection', async () => {
  const onSelect = jest.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
  const screen = await render(<ModelMenu {...baseProps} onSelect={onSelect} />)
  await fireEvent.press(screen.getByLabelText('Connection B \u00b7 Model B'))
  expect(baseProps.onClose).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByLabelText('Connection B \u00b7 Model B'))
  expect(baseProps.onClose).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('alert')).toBeNull()
})

it('exposes disabled model choices while keeping configuration and dismissal available', async () => {
  const screen = await render(
    <ModelMenu {...baseProps} selectionDisabled selectionDisabledLabel="chat.generating" />,
  )
  expect(screen.getByText('chat.generating')).toBeTruthy()
  expect(screen.getByLabelText('Connection B \u00b7 Model B')).toBeDisabled()
  await fireEvent.press(screen.getByLabelText('Connection B \u00b7 Model B'))
  expect(baseProps.onSelect).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByLabelText('chat.aiConfiguration'))
  expect(baseProps.onOpenConfiguration).toHaveBeenCalledTimes(1)
  expect(baseProps.onClose).toHaveBeenCalledTimes(1)
})

it('does not accept extra selections during its exit animation', async () => {
  const screen = await render(<ModelMenu {...baseProps} />)
  await screen.rerender(<ModelMenu {...baseProps} visible={false} />)
  expect(screen.getByTestId('model-menu').props.pointerEvents).toBe('none')
  await fireEvent.press(screen.getByLabelText('Connection B \u00b7 Model B'))
  expect(baseProps.onSelect).not.toHaveBeenCalled()
  await act(() => mockCompletions.at(-1)?.(true))
  expect(screen.queryByTestId('model-menu')).toBeNull()
})

it.each(['reduced', 'none'] as const)('uses no geometric menu motion with %s motion', async motion => {
  mockAnimatedProgress = 0.5
  const screen = await render(<ModelMenu {...baseProps} motion={motion} />)
  const style = StyleSheet.flatten(screen.getByTestId('model-menu').props.style)
  expect(style.transform).toEqual([{ translateY: 0 }])
})

it.each([
  [580, 3],
  [100, -3],
])('reveals from the anchor at y=%s and fades the scrim in the same frame', async (y, translateY) => {
  mockAnimatedProgress = 0.5
  const screen = await render(<ModelMenu {...baseProps} visible={false} anchor={{ ...baseProps.anchor, y }} />)
  await screen.rerender(<ModelMenu {...baseProps} anchor={{ ...baseProps.anchor, y }} />)
  expect(screen.getByTestId('model-menu')).toHaveStyle({ opacity: 0.5, transform: [{ translateY }] })
  expect(screen.getByTestId('model-menu-backdrop')).toHaveStyle({ opacity: 0.09 })
})

it('resets an old selection failure when the menu is reopened', async () => {
  const screen = await render(<ModelMenu {...baseProps} onSelect={() => false} />)
  await fireEvent.press(screen.getByLabelText('Connection B \u00b7 Model B'))
  expect(screen.getByRole('alert')).toBeTruthy()
  await screen.rerender(<ModelMenu {...baseProps} visible={false} />)
  await act(() => mockCompletions.at(-1)?.(true))
  await screen.rerender(<ModelMenu {...baseProps} />)
  expect(screen.queryByRole('alert')).toBeNull()
})

it('fences duplicate selections as soon as a successful dismissal is requested', async () => {
  const screen = await render(<ModelMenu {...baseProps} />)
  await fireEvent.press(screen.getByLabelText('Connection B \u00b7 Model B'))
  await fireEvent.press(screen.getByLabelText('Connection B \u00b7 Model B'))
  expect(baseProps.onSelect).toHaveBeenCalledTimes(1)
  expect(baseProps.onClose).toHaveBeenCalledTimes(1)
})

it.each(['nativeBack', 'outside', 'closeButton'] as const)('dismisses through %s using the same close fence', async route => {
  const screen = await render(<ModelMenu {...baseProps} />)
  if (route === 'nativeBack') await fireEvent(screen.getByTestId('model-menu-modal'), 'requestClose')
  if (route === 'outside') await fireEvent.press(screen.getByTestId('model-menu-dismiss'))
  if (route === 'closeButton') await fireEvent.press(screen.getByLabelText('dialog.closeLayer'))
  await fireEvent.press(screen.getByLabelText('dialog.closeLayer'))
  expect(baseProps.onClose).toHaveBeenCalledTimes(1)
})

it('cancels outstanding animation when unmounted', async () => {
  const screen = await render(<ModelMenu {...baseProps} />)
  await screen.unmount()
  expect(cancelAnimation).toHaveBeenCalledTimes(1)
})

it('handles Escape and removes the browser listener on unmount', async () => {
  const originalPlatform = Platform.OS
  const originalWindow = globalThis.window
  const addEventListener = jest.fn()
  const removeEventListener = jest.fn()
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { addEventListener, removeEventListener } })
  try {
    const screen = await render(<ModelMenu {...baseProps} />)
    const listener = addEventListener.mock.calls.find(([event]) => event === 'keydown')?.[1]
    expect(listener).toBeDefined()
    await act(() => listener({ key: 'Escape' }))
    expect(baseProps.onClose).toHaveBeenCalledTimes(1)
    await screen.unmount()
    expect(removeEventListener).toHaveBeenCalledWith('keydown', listener)
  } finally {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform })
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
  }
})
