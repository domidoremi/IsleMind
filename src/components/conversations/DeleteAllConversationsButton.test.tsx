import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { DeleteAllConversationsButton } from './DeleteAllConversationsButton'

const mockConfirm = jest.fn()
const mockToast = jest.fn()
const mockClear = jest.fn()
const mockState = { conversations: [{ id: 'saved' }], draftConversationIds: new Set<string>(), historyHasMore: true, isLoading: false, clearAll: mockClear }
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: require('@/theme/colors').getColors('light', 'minimal') }) }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('@/store/chatStore', () => ({ useChatStore: Object.assign(
  (select: (state: unknown) => unknown) => select(mockState), { getState: () => mockState },
) }))
jest.mock('@/components/ui/isle', () => {
  const { Pressable: MockPressable, Text } = require('react-native')
  return { useIsleDialog: () => ({ confirm: mockConfirm, toast: mockToast }),
    IsleButton: ({ accessibilityLabel, label, onPress, disabled }: any) => <MockPressable accessibilityRole="button"
      accessibilityLabel={accessibilityLabel} disabled={disabled} onPress={onPress}><Text>{label}</Text></MockPressable> }
})
beforeEach(() => {
  jest.clearAllMocks()
  mockConfirm.mockReset().mockResolvedValue(false)
  mockClear.mockReset().mockResolvedValue(undefined)
})

it('requires confirmation and reports success only after deletion finishes', async () => {
  const view = await render(<DeleteAllConversationsButton compact />)
  const button = view.getByRole('button', { name: 'conversation.deleteAll.title' })
  await fireEvent.press(button)
  expect(mockClear).not.toHaveBeenCalled()
  mockConfirm.mockResolvedValueOnce(true)
  let finish!: () => void
  mockClear.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  await fireEvent.press(button)
  await waitFor(() => expect(mockClear).toHaveBeenCalledTimes(1))
  expect(mockToast).not.toHaveBeenCalled()
  await act(async () => { finish() })
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith({ title: 'conversation.deleteAll.done', tone: 'mint' }))
  await view.unmount()
})

it('does not delete if a pending confirmation completes after the button unmounts', async () => {
  let confirm!: (accepted: boolean) => void
  mockConfirm.mockImplementationOnce(() => new Promise<boolean>(resolve => { confirm = resolve }))
  const view = await render(<DeleteAllConversationsButton />)
  await fireEvent.press(view.getByRole('button', { name: 'conversation.deleteAll.title' }))
  const signal = mockConfirm.mock.calls[0][0].signal as AbortSignal
  await view.unmount()
  await act(async () => { confirm(true) })
  expect(signal.aborted).toBe(true)
  expect(mockClear).not.toHaveBeenCalled()
})

it('reports deletion failure without showing a success message', async () => {
  mockConfirm.mockResolvedValueOnce(true)
  mockClear.mockRejectedValueOnce(new Error('storage unavailable'))
  const view = await render(<DeleteAllConversationsButton />)
  await fireEvent.press(view.getByRole('button', { name: 'conversation.deleteAll.title' }))
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'conversation.deleteAll.failed' })))
  expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'conversation.deleteAll.done' }))
  await view.unmount()
})
