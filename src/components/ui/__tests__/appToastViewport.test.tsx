import { act, fireEvent, render } from '@testing-library/react-native'
import { AccessibilityInfo, Pressable, StyleSheet } from 'react-native'
import type { ReactNode } from 'react'

import type { AppFeedbackOptions } from '../appFeedbackState'
import { IsleDialogProvider, useIsleDialog } from '../isle/Dialog'
import { IsleThemeProvider } from '../isle/IsleThemeProvider'

let mockTheme = 'minimal'
let mockMotion = 'full'
const mockInsets = { top: 24, right: 0, bottom: 30, left: 0 }

jest.mock('@/hooks/useAppTheme', () => ({
  useAppTheme: () => {
    const colors = require('@/theme/colors').getColors('light', mockTheme)
    return { colors, design: colors.design, canonicalThemeId: mockTheme, isLiquidGlass: mockTheme === 'liquid-glass' }
  },
}))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => mockMotion }))
jest.mock('@/hooks/useTransparencyPreference', () => ({ useTransparencyPreference: () => false }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => mockInsets }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))

beforeEach(() => { mockTheme = 'minimal'; mockMotion = 'full' })

function Trigger({ label = 'Report feedback', options }: { label?: string; options: AppFeedbackOptions }) {
  const dialog = useIsleDialog()
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => dialog.toast(options)} />
}

function Host({ children }: { children: ReactNode }) {
  return <IsleThemeProvider><IsleDialogProvider>{children}</IsleDialogProvider></IsleThemeProvider>
}

it.each(['animal-island-ui', 'minimal', 'monet', 'material', 'liquid-glass'])(
  '%s keeps legacy bottom feedback at the top without intercepting the rest of the screen',
  async theme => {
    mockTheme = theme
    const underlyingAction = jest.fn()
    const screen = await render(<Host>
      <Trigger options={{ title: 'Saved', position: 'bottom', bottomOffset: 400, topOffset: 0, durationMs: 0 }} />
      <Pressable accessibilityRole="button" accessibilityLabel="Continue editing" onPress={underlyingAction} />
    </Host>)
    await fireEvent.press(screen.getByRole('button', { name: 'Report feedback' }))

    const viewport = screen.getByTestId('app-toast-viewport')
    expect(viewport).toHaveStyle({ position: 'absolute', top: 42 })
    expect(StyleSheet.flatten(viewport.props.style).bottom).toBeUndefined()
    expect(viewport.props.pointerEvents).toBe('box-none')
    expect(screen.getAllByTestId(`theme-toast-${theme}`)).toHaveLength(1)
    await fireEvent.press(screen.getByRole('button', { name: 'Continue editing' }))
    expect(underlyingAction).toHaveBeenCalledTimes(1)
    await screen.unmount()
  },
)

it.each(['animal-island-ui', 'minimal', 'monet', 'material', 'liquid-glass'].flatMap(theme =>
  ['full', 'reduced', 'none'].map(motion => [theme, motion] as const),
))('%s uses opacity-only feedback with %s motion', async (theme, motion) => {
  mockTheme = theme
  mockMotion = motion
  const screen = await render(<Host><Trigger options={{ title: 'Copied', durationMs: 0 }} /></Host>)
  await fireEvent.press(screen.getByRole('button', { name: 'Report feedback' }))

  const entrance = screen.getByTestId('app-toast-motion')
  for (const frame of [entrance.props.from, entrance.props.animate, entrance.props.exit]) {
    expect(Object.keys(frame)).toEqual(['opacity'])
  }
  expect(entrance.props.animate).toEqual({ opacity: 1 })
  expect(entrance.props.transition.duration).toBeLessThanOrEqual(160)
  if (motion === 'none') {
    expect(entrance.props.from).toEqual({ opacity: 1 })
    expect(entrance.props.transition.duration).toBe(1)
  }
  await screen.unmount()
})

it('shows only the active feedback and retains queued messages until dismissal', async () => {
  const firstDismissed = jest.fn()
  const screen = await render(<Host>
    <Trigger label="First feedback" options={{ title: 'Saved', durationMs: 0, onDismiss: firstDismissed }} />
    <Trigger label="Second feedback" options={{ title: 'Copied', durationMs: 0 }} />
    <Trigger label="Third feedback" options={{ title: 'Exported', durationMs: 0 }} />
  </Host>)
  for (const name of ['First feedback', 'Second feedback', 'Third feedback']) {
    await fireEvent.press(screen.getByRole('button', { name }))
  }

  expect(screen.getByText('Saved')).toBeTruthy()
  expect(screen.queryByText('Copied')).toBeNull()
  expect(screen.queryByText('Exported')).toBeNull()
  expect(screen.getAllByTestId('theme-toast-minimal')).toHaveLength(1)
  await fireEvent.press(screen.getByRole('button', { name: 'common.close' }))
  expect(firstDismissed).toHaveBeenCalledTimes(1)
  expect(screen.getByText('Copied')).toBeTruthy()
  expect(screen.queryByText('Exported')).toBeNull()
  await fireEvent.press(screen.getByRole('button', { name: 'common.close' }))
  expect(screen.getByText('Exported')).toBeTruthy()
  await screen.unmount()
})

it('preserves error announcements and action callbacks in the top feedback', async () => {
  const retry = jest.fn()
  const dismissed = jest.fn()
  const screen = await render(<Host><Trigger options={{
    title: 'Export failed', message: 'Clipboard unavailable', tone: 'danger',
    actionLabel: 'Retry export', onAction: retry, onDismiss: dismissed, durationMs: 0,
  }} /></Host>)
  await fireEvent.press(screen.getByRole('button', { name: 'Report feedback' }))
  expect(screen.getByRole('alert').props.accessibilityLiveRegion).toBe('assertive')
  await fireEvent.press(screen.getByRole('button', { name: 'Retry export' }))
  expect(retry).toHaveBeenCalledTimes(1)
  expect(dismissed).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('Export failed')).toBeNull()
  await screen.unmount()
})

it('honors a larger caller top inset while keeping a single viewport', async () => {
  const screen = await render(<Host><Trigger options={{ title: 'Saved', topOffset: 80, durationMs: 0 }} /></Host>)
  await fireEvent.press(screen.getByRole('button', { name: 'Report feedback' }))
  expect(screen.getByTestId('app-toast-viewport')).toHaveStyle({ top: 80 })
  await screen.unmount()
})

it('retains the platform-recommended reading time before showing the next feedback', async () => {
  jest.useFakeTimers()
  const recommendedTimeout = jest.spyOn(AccessibilityInfo, 'getRecommendedTimeoutMillis').mockResolvedValue(3200)
  try {
    const screen = await render(<Host>
      <Trigger label="First feedback" options={{ title: 'Saved', durationMs: 1200 }} />
      <Trigger label="Second feedback" options={{ title: 'Copied', durationMs: 0 }} />
    </Host>)
    await fireEvent.press(screen.getByRole('button', { name: 'First feedback' }))
    await fireEvent.press(screen.getByRole('button', { name: 'Second feedback' }))
    expect(recommendedTimeout).toHaveBeenCalledWith(1200)
    await act(() => { jest.advanceTimersByTime(3199) })
    expect(screen.getByText('Saved')).toBeTruthy()
    expect(screen.queryByText('Copied')).toBeNull()
    await act(() => { jest.advanceTimersByTime(1) })
    expect(screen.queryByText('Saved')).toBeNull()
    expect(screen.getByText('Copied')).toBeTruthy()
    await screen.unmount()
  } finally {
    recommendedTimeout.mockRestore()
    jest.useRealTimers()
  }
})
