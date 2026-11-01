import { useEffect, useState, type ReactNode } from 'react'
import { act, fireEvent, render } from '@testing-library/react-native'
import { AccessibilityInfo, Platform, Pressable, Text, TextInput } from 'react-native'
import { PageFeedbackBoundary, PageFeedbackIndicator, PageFeedbackRegion } from './PageFeedback'
import { IsleDialogContext } from './isle/isleDialogContext'
import { useIsleDialog, type IsleDialogApi } from './isle/Dialog'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'

let mockFamily: CanonicalThemeId = 'minimal'
let mockMode = 'light'
const mockTimeout = jest.fn()
const globalApi: IsleDialogApi = {
  toast: jest.fn(), notice: jest.fn(), confirm: jest.fn().mockResolvedValue(false),
  banner: jest.fn().mockReturnValue('banner'), dismissBanner: jest.fn(),
  hasPendingDialogs: jest.fn().mockReturnValue(false), subscribeDialogs: jest.fn().mockReturnValue(() => undefined),
}
let local: IsleDialogApi
const unmounted = jest.fn()

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => {
  const colors = require('@/theme/colors').getColors(mockMode, mockFamily)
  return { colors, design: colors.design, canonicalThemeId: mockFamily, mode: mockMode }
} }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('./appFeedbackTimeout', () => ({ resolveAppFeedbackTimeout: (...args: unknown[]) => mockTimeout(...args) }))

function Content({ onMount, action }: { onMount?: () => void; action?: ReactNode }) {
  local = useIsleDialog()
  const [draft, setDraft] = useState('initial')
  useEffect(() => { onMount?.(); return () => { unmounted() } }, [])
  return <>
    <PageFeedbackIndicator action={action} />
    <TextInput testID="draft" value={draft} onChangeText={setDraft} />
    <Pressable testID="report" onPress={() => local.toast({ title: 'Saved', tone: 'success' })}><Text>Report</Text></Pressable>
    <PageFeedbackRegion />
  </>
}
function tree(scopeKey = 'page', onMount?: () => void, action?: ReactNode) {
  return <IsleDialogContext.Provider value={globalApi}><PageFeedbackBoundary scopeKey={scopeKey}>
    <Content onMount={onMount} action={action} />
  </PageFeedbackBoundary></IsleDialogContext.Provider>
}
beforeEach(() => {
  jest.clearAllMocks()
  mockFamily = 'minimal'; mockMode = 'light'
  mockTimeout.mockResolvedValue(3200)
})
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks() })

it('keeps a header action usable in the same slot while still announcing a successful receipt', async () => {
  jest.replaceProperty(Platform, 'OS', 'android')
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined)
  const undo = jest.fn()
  const action = <Pressable accessibilityRole="button" accessibilityLabel="Undo" onPress={undo}><Text>Undo</Text></Pressable>
  const view = await render(tree('page', undefined, action))
  const input = view.getByTestId('draft')
  await fireEvent.press(view.getByTestId('report'))
  expect(view.getByTestId('page-feedback-indicator')).toHaveStyle({ width: 44, height: 44 })
  expect(view.queryByTestId('page-action-feedback')).toBeNull()
  expect(announce).toHaveBeenCalledWith('Saved')
  await fireEvent.press(view.getByRole('button', { name: 'Undo' }))
  expect(undo).toHaveBeenCalledTimes(1)
  expect(view.getByTestId('draft')).toBe(input)
  await view.unmount()
})

it('routes routine receipts into the page and keeps every safety method on the original provider', async () => {
  const view = await render(tree())
  await fireEvent.press(view.getByTestId('report'))
  expect(view.getByRole('button', { name: 'Saved' })).toBeTruthy()
  expect(view.queryByTestId('page-action-feedback')).toBeNull()
  expect(view.getByTestId('page-feedback-indicator')).toHaveStyle({ width: 44, height: 44 })
  expect(globalApi.toast).not.toHaveBeenCalled()
  expect(view.queryByTestId('app-toast-motion')).toBeNull()
  const signal = new AbortController().signal
  expect(local.confirm).toBe(globalApi.confirm)
  await local.confirm({ title: 'Allow once', signal })
  expect(globalApi.confirm).toHaveBeenCalledWith({ title: 'Allow once', signal })
  expect(local.notice).toBe(globalApi.notice)
  expect(local.banner).toBe(globalApi.banner)
  expect(local.subscribeDialogs).toBe(globalApi.subscribeDialogs)
  await view.unmount()
})

it('does not erase a receipt published by a child on its first mount', async () => {
  const view = await render(tree('page', () => local.toast({ title: 'Load failed', tone: 'error' })))
  expect(view.getByText('Load failed')).toBeTruthy()
  await view.unmount()
})

it('keeps drafts and receipts mounted across all families and both modes', async () => {
  const view = await render(tree())
  const field = view.getByTestId('draft')
  await fireEvent.changeText(field, 'retain me')
  await act(() => local.toast({ title: 'Retry needed', tone: 'error' }))
  for (const family of CANONICAL_THEME_IDS) for (const mode of ['dark', 'light']) {
    mockFamily = family; mockMode = mode
    await view.rerender(tree())
    expect(view.getByTestId('draft')).toBe(field)
    expect(view.getByTestId('draft').props.value).toBe('retain me')
    expect(view.getByText('Retry needed')).toBeTruthy()
    expect(unmounted).not.toHaveBeenCalled()
  }
  await view.unmount()
  expect(unmounted).toHaveBeenCalledTimes(1)
})

it('rejects late callbacks after changing scopes, including returning to the same route', async () => {
  const view = await render(tree('first'))
  const old = local
  await act(() => old.toast({ title: 'Old result', tone: 'error' }))
  await view.rerender(tree('second'))
  expect(view.queryByText('Old result')).toBeNull()
  await act(() => old.toast({ title: 'Late failure', tone: 'error' }))
  await view.rerender(tree('first'))
  await act(() => old.toast({ title: 'Late failure', tone: 'error' }))
  expect(view.queryByText('Late failure')).toBeNull()
  await act(() => local.toast({ title: 'Current result', tone: 'error' }))
  expect(view.getByText('Current result')).toBeTruthy()
  await view.unmount()
})

it('queues concurrent results without replacing a persistent failure with a success', async () => {
  const view = await render(tree())
  await act(() => {
    local.toast({ title: 'Write failed', tone: 'error' })
    local.toast({ title: 'Other action saved', tone: 'success' })
  })
  expect(view.getByText('Write failed')).toBeTruthy()
  expect(view.queryByText('Other action saved')).toBeNull()
  expect(view.getByText('dialog.pendingFeedback')).toBeTruthy()
  await fireEvent.press(view.getByRole('button', { name: 'common.close' }))
  expect(view.getByRole('button', { name: 'Other action saved' })).toBeTruthy()
  expect(view.queryByTestId('page-action-feedback')).toBeNull()
  await view.unmount()
})

it('honors accessible success duration but never expires warnings or actionable receipts', async () => {
  jest.useFakeTimers()
  mockTimeout.mockResolvedValue(6400)
  const view = await render(tree())
  await act(() => local.toast({ title: 'Saved', tone: 'success' }))
  await act(() => jest.advanceTimersByTime(6399))
  expect(view.getByRole('button', { name: 'Saved' })).toBeTruthy()
  await act(() => jest.advanceTimersByTime(1))
  expect(view.queryByRole('button', { name: 'Saved' })).toBeNull()
  expect(view.getByTestId('page-feedback-indicator')).toHaveStyle({ width: 44, height: 44 })
  await act(() => local.toast({ title: 'Connection warning', tone: 'warning' }))
  await act(() => jest.advanceTimersByTime(20_000))
  expect(view.getByText('Connection warning')).toBeTruthy()
  await fireEvent.press(view.getByRole('button', { name: 'common.close' }))
  await act(() => local.toast({ title: 'Deleted', tone: 'success', actionLabel: 'Undo', onAction: jest.fn() }))
  await act(() => jest.advanceTimersByTime(20_000))
  expect(view.getByText('Deleted')).toBeTruthy()
  await view.unmount()
})

it('runs an action once and preserves a new result it publishes', async () => {
  const view = await render(tree())
  const action = jest.fn(() => local.toast({ title: 'Restored', tone: 'success' }))
  const dismiss = jest.fn()
  await act(() => local.toast({ title: 'Deleted', actionLabel: 'Undo', onAction: action, onDismiss: dismiss }))
  await fireEvent.press(view.getByRole('button', { name: 'Undo' }))
  expect(action).toHaveBeenCalledTimes(1)
  expect(dismiss).toHaveBeenCalledTimes(1)
  expect(view.getByRole('button', { name: 'Restored' })).toBeTruthy()
  expect(view.queryByTestId('page-action-feedback')).toBeNull()
  await view.unmount()
  const stale = local
  await act(() => stale.toast({ title: 'After unmount', tone: 'error' }))
  expect(globalApi.toast).not.toHaveBeenCalled()
})

it('ignores a delayed accessibility timeout after the user dismisses that result', async () => {
  jest.useFakeTimers()
  let finish!: (value: number) => void
  mockTimeout.mockImplementationOnce(() => new Promise<number>(resolve => { finish = resolve }))
  const view = await render(tree())
  await act(() => local.toast({ title: 'Saved', tone: 'success' }))
  await fireEvent.press(view.getByRole('button', { name: 'Saved' }))
  await act(() => local.toast({ title: 'New failure', tone: 'error' }))
  await act(() => finish(1))
  await act(() => jest.advanceTimersByTime(10_000))
  expect(view.getByText('New failure')).toBeTruthy()
  await view.unmount()
})
