import { act, render } from '@testing-library/react-native'
import { AccessibilityInfo, Platform } from 'react-native'
import { FeedbackAnnouncement, FeedbackGlyph } from './FeedbackGlyph'
import { ActionFeedback } from './ActionFeedback'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'

let mockFamily: CanonicalThemeId = 'minimal'
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({
  colors: require('@/theme/colors').getColors('light', mockFamily), canonicalThemeId: mockFamily,
}) }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('@/components/ui/HighFrameSpinner', () => ({ HighFrameSpinner: () => null }))
jest.mock('moti', () => ({ MotiView: require('react-native').View }))
beforeEach(() => { jest.clearAllMocks(); jest.replaceProperty(Platform, 'OS', 'web') })
afterEach(() => jest.restoreAllMocks())

it.each(CANONICAL_THEME_IDS)('keeps one fixed status slot through every action phase in %s', async family => {
  mockFamily = family
  const view = await render(<FeedbackGlyph testID="status" />)
  const slot = view.getByTestId('status')
  for (const phase of ['idle', 'pending', 'success', 'error'] as const) {
    await view.rerender(<FeedbackGlyph testID="status" phase={phase} label={phase === 'success' ? 'Saved' : undefined} />)
    expect(view.getByTestId('status')).toBe(slot)
    expect(slot).toHaveStyle({ width: 18, height: 18 })
    expect(slot.props.accessibilityState.busy).toBe(phase === 'pending')
    expect(view.getByTestId('status-announcement')).toHaveStyle({ position: 'absolute', width: 1, height: 1 })
  }
})

it('announces repeated receipts on iOS without re-announcing ordinary rerenders', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios')
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions').mockImplementation(() => undefined)
  const view = await render(<FeedbackAnnouncement />)
  await view.rerender(<FeedbackAnnouncement message="Saved" receiptKey={1} />)
  await view.rerender(<FeedbackAnnouncement message="Saved" receiptKey={1} />)
  expect(announce).toHaveBeenCalledTimes(1)
  await view.rerender(<FeedbackAnnouncement message="Saved" receiptKey={2} />)
  expect(announce).toHaveBeenCalledTimes(2)
  expect(announce).toHaveBeenLastCalledWith('Saved', { queue: true })
})

it('does not insert an action-success row but keeps failure explanations visible', async () => {
  const view = await render(<ActionFeedback testID="copy" phase="idle" successLabel="Copied" errorLabel="Clipboard failed" />)
  const announcement = view.getByTestId('copy')
  await act(() => view.rerender(<ActionFeedback testID="copy" phase="success" successLabel="Copied" errorLabel="Clipboard failed" />))
  expect(view.getByTestId('copy')).toBe(announcement)
  expect(announcement).toHaveStyle({ position: 'absolute', width: 1, height: 1 })
  expect(announcement).toHaveTextContent('Copied')
  expect(view.queryByRole('alert')).toBeNull()
  await view.rerender(<ActionFeedback testID="copy" phase="error" successLabel="Copied" errorLabel="Clipboard failed" />)
  expect(view.getByRole('alert')).toHaveTextContent('Clipboard failed')
  expect(view.getByTestId('copy')).toHaveStyle({ paddingVertical: 6 })
})
