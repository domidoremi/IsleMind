import { act, fireEvent, render } from '@testing-library/react-native'
import * as Clipboard from 'expo-clipboard'
import { useIsleDialog } from '@/components/ui/isle'
import { Composer } from './Composer'
import { MessageContent } from './MessageContent'

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/hooks/useAppTheme', () => ({
  useAppTheme: () => ({ colors: jest.requireActual('@/theme/colors').getColors('light', 'minimal'), canonicalThemeId: 'minimal' }),
}))
jest.mock('@/components/ui/isle', () => ({
  IslePressable: require('react-native').Pressable,
  ISLE_MIN_TOUCH_TARGET: 44,
  useIsleDialog: jest.fn(),
}))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))
jest.mock('@/components/ui/ProviderBrandIcon', () => ({ ProviderBrandIcon: () => null }))
jest.mock('@/components/ui/HighFrameSpinner', () => ({ HighFrameSpinner: () => null }))
jest.mock('@/components/ui/isle/ThemeExpressionSurface', () => ({ ThemeExpressionSurface: require('react-native').View }))
jest.mock('./theme-surfaces/ChatThemeSurfaces', () => ({
  MessageContentThemeSurface: require('react-native').View,
  ChatComposerThemeSurface: require('react-native').View,
}))
jest.mock('@/services/attachment', () => ({ pickDocument: jest.fn(), pickImage: jest.fn(), takePhoto: jest.fn() }))
jest.mock('./useComposerVoiceInput', () => ({ useComposerVoiceInput: () => ({ state: { phase: 'idle' } }) }))

const toast = jest.fn()
const cases = ['success', 'false', 'rejection', 'throw'] as const
function clipboardOutcome(outcome: typeof cases[number]) {
  const write = jest.mocked(Clipboard.setStringAsync)
  if (outcome === 'throw') write.mockImplementationOnce(() => { throw new Error('Clipboard unavailable') })
  else if (outcome === 'rejection') write.mockRejectedValueOnce(new Error('Clipboard unavailable'))
  else write.mockResolvedValueOnce(outcome === 'success')
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(Clipboard.setStringAsync).mockReset()
  jest.useFakeTimers()
  jest.mocked(useIsleDialog).mockReturnValue({ toast } as unknown as ReturnType<typeof useIsleDialog>)
})
afterEach(async () => {
  await act(async () => jest.runOnlyPendingTimers())
  jest.useRealTimers()
})

it.each(cases)('rich code copy reports %s instead of assuming a resolved promise means success', async (outcome) => {
  clipboardOutcome(outcome)
  const view = await render(<MessageContent content={'```js\nconst answer = 42\n```'} />)
  await fireEvent.press(view.getByRole('button', { name: 'common.copy' }))
  const label = outcome === 'success' ? 'common.copied' : 'common.copyFailed'
  expect(view.getByRole('button', { name: label })).toBeTruthy()
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith('const answer = 42\n')
  await act(async () => jest.advanceTimersByTime(1300))
  expect(view.getByRole('button', { name: 'common.copy' })).toBeTruthy()
})

it('keeps a failed rich-block action available for an immediate successful retry', async () => {
  jest.mocked(Clipboard.setStringAsync).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  const view = await render(<MessageContent content={'```js\nconst answer = 42\n```'} />)
  await fireEvent.press(view.getByRole('button', { name: 'common.copy' }))
  await fireEvent.press(view.getByRole('button', { name: 'common.copyFailed' }))
  expect(view.getByRole('button', { name: 'common.copied' })).toBeTruthy()
  expect(jest.mocked(Clipboard.setStringAsync).mock.calls).toEqual([['const answer = 42\n'], ['const answer = 42\n']])
})

it.each(cases)('draft copy reports %s and preserves the full editable draft', async (outcome) => {
  clipboardOutcome(outcome)
  const draft = Array.from({ length: 10 }, (_, index) => `line ${index}`).join('\n')
  const view = await render(<Composer initialDraft={draft} initialDraftKey="clipboard-test"
    viewportHeight={800} horizontalPadding={12} safeAreaTop={0} safeAreaBottom={0}
    keyboardLift={0} motion="none" onSend={jest.fn()} />)
  await fireEvent(view.getByLabelText('chat.inputAccessibility'), 'contentSizeChange', {
    nativeEvent: { contentSize: { width: 320, height: 240 } },
  })
  await fireEvent.press(view.getByRole('button', { name: 'chat.composerExpandDraft' }))
  await fireEvent.press(view.getByRole('button', { name: 'chat.composerMoreTools' }))
  await fireEvent.press(view.getByRole('button', { name: 'chat.composerCopyAll' }))
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({
    title: outcome === 'success' ? 'common.copied' : 'common.copyFailed',
    tone: outcome === 'success' ? 'mint' : 'danger',
  }))
  expect(toast).toHaveBeenCalledTimes(1)
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith(draft)
  expect(view.getByLabelText('chat.inputAccessibility').props.value).toBe(draft)
})
