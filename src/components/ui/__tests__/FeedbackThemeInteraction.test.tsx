import { useState, type ReactElement, type ReactNode } from 'react'
import { act, fireEvent, render } from '@testing-library/react-native'
import { StyleSheet, Text, TextInput } from 'react-native'
import { AppStatusSurface } from '../AppStatusSurface'
import { PageFeedbackBoundary, PageFeedbackIndicator, PageFeedbackRegion } from '../PageFeedback'
import { IsleDialogProvider, useIsleDialog, type IsleDialogApi } from '../isle/Dialog'
import { IslePressable } from '../isle/Pressable'
import { IsleThemeProvider } from '../isle/IsleThemeProvider'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'

let mockFamily: CanonicalThemeId = 'minimal'
let mockMode: 'light' | 'dark' = 'light'
let mockMotion = 'full'
let api: IsleDialogApi

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => {
  const colors = require('@/theme/colors').getColors(mockMode, mockFamily)
  return { colors, design: colors.design, canonicalThemeId: mockFamily, mode: mockMode,
    isDark: mockMode === 'dark', isLiquidGlass: mockFamily === 'liquid-glass' }
} }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => mockMotion }))
jest.mock('@/hooks/useTransparencyPreference', () => ({ useTransparencyPreference: () => true }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { createAnimatedComponent: (component: unknown) => component },
  useSharedValue: (value: number) => require('react').useRef({ value }).current,
  useAnimatedStyle: (worklet: () => unknown) => worklet(),
  withTiming: (value: number) => value,
  withSpring: (value: number) => value,
  cancelAnimation: jest.fn(),
  Easing: { out: () => undefined, inOut: () => undefined, bezier: () => undefined },
}))

function Capture() { api = useIsleDialog(); return null }
function Draft() {
  const [draft, setDraft] = useState('Unsent draft')
  return <TextInput testID="feedback-draft" value={draft} onChangeText={setDraft} selection={{ start: 3, end: 7 }} />
}
function Frame({ children }: { children: ReactNode }) {
  return <IsleThemeProvider>
    <IslePressable testID="theme-reference" accessibilityLabel="Reference"><Text>Reference</Text></IslePressable>
    <Draft />
    {children}
  </IsleThemeProvider>
}

type Screen = Awaited<ReturnType<typeof render>>
type Target = () => ReturnType<Screen['getByRole']>

async function verifyInteraction(screen: Screen, tree: () => ReactElement, target: Target) {
  const reference = () => screen.getByTestId('theme-reference')
  const compare = () => {
    const expected = StyleSheet.flatten(reference().props.style)
    expect(target()).toHaveStyle({ transform: expected.transform, opacity: expected.opacity })
  }
  for (const motion of ['full', 'reduced', 'none']) {
    mockMotion = motion
    await screen.rerender(tree())
    for (const gesture of ['hoverIn', 'focus', 'pressIn']) {
      await fireEvent(reference(), gesture)
      await fireEvent(target(), gesture)
      await screen.rerender(tree())
      compare()
    }
    const referenceStyle = StyleSheet.flatten(reference().props.style)
    if (motion === 'full') expect(referenceStyle.transform[0].scale).toBeLessThan(1)
    else expect(target()).toHaveStyle({ transform: [{ scale: 1 }] })
    if (motion === 'none') expect(target()).toHaveStyle({ opacity: 1 })
    for (const gesture of ['pressOut', 'blur', 'hoverOut']) {
      await fireEvent(reference(), gesture)
      await fireEvent(target(), gesture)
    }
    await screen.rerender(tree())
    compare()
    expect(target()).toHaveStyle({ transform: [{ scale: 1 }], opacity: 1 })
  }
}

async function retainDraft(screen: Screen, tree: () => ReactElement, check: () => void) {
  const draft = screen.getByTestId('feedback-draft')
  await fireEvent.changeText(draft, 'Keep this edited draft')
  mockMode = mockMode === 'light' ? 'dark' : 'light'
  await screen.rerender(tree())
  expect(screen.getByTestId('feedback-draft')).toBe(draft)
  expect(draft.props.value).toBe('Keep this edited draft')
  expect(draft.props.selection).toEqual({ start: 3, end: 7 })
  check()
}

beforeEach(() => { mockMotion = 'full' })
const appearances = CANONICAL_THEME_IDS.flatMap(family => (['light', 'dark'] as const).map(mode => ({ family, mode })))

it.each(appearances)('follows $family $mode interaction and motion in status actions, dismiss and navigation', async ({ family, mode }) => {
  mockFamily = family; mockMode = mode
  const action = jest.fn(), dismiss = jest.fn(), navigate = jest.fn()
  const tree = () => <Frame><AppStatusSurface title="Recovery" message="Check connection" actionLabel="Retry status"
    onAction={action} dismissLabel="Dismiss status" onDismiss={dismiss} onPress={navigate} /></Frame>
  const screen = await render(tree())
  const targets = [
    () => screen.getByRole('button', { name: 'Retry status' }),
    () => screen.getByRole('button', { name: 'Dismiss status' }),
    () => screen.getByRole('button', { name: 'Recovery. Check connection' }),
  ]
  for (const target of targets) await verifyInteraction(screen, tree, target)
  expect(action).not.toHaveBeenCalled(); expect(dismiss).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled()
  await retainDraft(screen, tree, () => expect(screen.getByText('Check connection')).toBeTruthy())
  for (const target of targets) await fireEvent.press(target())
  expect(action).toHaveBeenCalledTimes(1); expect(dismiss).toHaveBeenCalledTimes(1); expect(navigate).toHaveBeenCalledTimes(1)
  await screen.unmount()
})

it.each(appearances)('follows $family $mode interaction in queued page feedback without losing its action', async ({ family, mode }) => {
  mockFamily = family; mockMode = mode
  const action = jest.fn(), dismiss = jest.fn()
  const tree = () => <Frame><IsleDialogProvider><PageFeedbackBoundary scopeKey="page"><Capture />
    <PageFeedbackRegion />
  </PageFeedbackBoundary></IsleDialogProvider></Frame>
  const screen = await render(tree())
  await act(() => {
    api.toast({ title: 'Needs retry', tone: 'error', actionLabel: 'Retry page', onAction: action, onDismiss: dismiss })
    api.toast({ title: 'Second result', tone: 'warning' })
  })
  const retry = () => screen.getByRole('button', { name: 'Retry page' })
  const close = () => screen.getByRole('button', { name: 'common.close' })
  await verifyInteraction(screen, tree, retry)
  await verifyInteraction(screen, tree, close)
  await retainDraft(screen, tree, () => expect(screen.getByText('Needs retry')).toBeTruthy())
  expect(action).not.toHaveBeenCalled(); expect(dismiss).not.toHaveBeenCalled()
  await fireEvent.press(retry())
  expect(action).toHaveBeenCalledTimes(1); expect(dismiss).toHaveBeenCalledTimes(1)
  expect(screen.getByText('Second result')).toBeTruthy()
  await fireEvent.press(close())
  expect(screen.queryByTestId('page-action-feedback')).toBeNull()
  await screen.unmount()
})

it.each(appearances)('follows $family $mode interaction in the success indicator and disables it after dismissal', async ({ family, mode }) => {
  mockFamily = family; mockMode = mode
  const dismiss = jest.fn()
  const tree = () => <Frame><IsleDialogProvider><PageFeedbackBoundary><Capture /><PageFeedbackIndicator /></PageFeedbackBoundary></IsleDialogProvider></Frame>
  const screen = await render(tree())
  await act(() => api.toast({ title: 'Saved receipt', tone: 'success', durationMs: 0, onDismiss: dismiss }))
  const indicator = () => screen.getByRole('button', { name: 'Saved receipt' })
  await verifyInteraction(screen, tree, indicator)
  await retainDraft(screen, tree, () => expect(indicator()).not.toBeDisabled())
  await fireEvent.press(indicator())
  expect(dismiss).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('button', { name: 'Saved receipt' })).toBeNull()
  const idle = screen.getByTestId('page-feedback-indicator').props.children[0]
  expect(idle.props.disabled).toBe(true)
  expect(idle.props.accessible).toBe(false)
  await screen.unmount()
})

it.each(appearances)('follows $family $mode interaction in persistent banner actions and dismisses once', async ({ family, mode }) => {
  mockFamily = family; mockMode = mode
  const action = jest.fn(), dismiss = jest.fn()
  const tree = () => <Frame><IsleDialogProvider><Capture /></IsleDialogProvider></Frame>
  const screen = await render(tree())
  await act(() => api.banner({ id: 'retry', title: 'Banner needs retry', actionLabel: 'Retry banner', onAction: action, onDismiss: dismiss }))
  const retry = () => screen.getByRole('button', { name: 'Retry banner' })
  const close = () => screen.getByRole('button', { name: 'common.close' })
  await verifyInteraction(screen, tree, retry)
  await verifyInteraction(screen, tree, close)
  await retainDraft(screen, tree, () => expect(screen.getByText('Banner needs retry')).toBeTruthy())
  expect(action).not.toHaveBeenCalled(); expect(dismiss).not.toHaveBeenCalled()
  await fireEvent.press(retry())
  expect(action).toHaveBeenCalledTimes(1); expect(dismiss).not.toHaveBeenCalled()
  expect(screen.queryByText('Banner needs retry')).toBeNull()
  await act(() => api.banner({ title: 'Another banner', onDismiss: dismiss }))
  await fireEvent.press(close())
  expect(action).toHaveBeenCalledTimes(1); expect(dismiss).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('Another banner')).toBeNull()
  await screen.unmount()
})
