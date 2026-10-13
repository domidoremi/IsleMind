import { act, fireEvent, render } from '@testing-library/react-native'
import { useChatStore } from '@/store/chatStore'
import type { Conversation, Message } from '@/types/chatContracts'
import { ChatActiveStatusLayer, type ChatActiveStatusLayerProps } from './ChatActiveStatusLayer'
import { cancelConversationTask } from './conversationTaskState'

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ isLiquidGlass: false }) }))
jest.mock('@/store/chatStore', () => ({
  useChatStore: require('zustand').create((set: (patch: object) => void) => ({
    error: null,
    setError: jest.fn((error: string | null) => set({ error })),
  })),
}))
jest.mock('./ChatStatusBanners', () => ({ CompressionBanner: () => null, ConversationHealthBanner: () => null }))
jest.mock('./ProgramErrorBanner', () => {
  const { Pressable, Text, View } = require('react-native')
  return { ProgramErrorBanner: ({ message, onDismiss }: { message: string; onDismiss: () => void }) => (
    <View accessibilityRole="alert"><Text>{message}</Text><Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={onDismiss} /></View>
  ) }
})
jest.mock('./ConversationTaskStatusCard', () => {
  const { Pressable } = require('react-native')
  return { ConversationTaskStatusCard: ({ onCancel }: { onCancel: () => void }) => (
    <Pressable accessibilityRole="button" accessibilityLabel="Cancel task" onPress={onCancel} />
  ) }
})
jest.mock('./conversationTaskState', () => ({ cancelConversationTask: jest.fn() }))

const failure = 'Local fixture returned HTTP 503'
const message: Message = { id: 'answer', role: 'assistant', content: failure, status: 'error', timestamp: 1 }
const conversation = { id: 'chat', messages: [message] } as Conversation
const props: ChatActiveStatusLayerProps = {
  conversation, providerHealth: null, latestCompression: null, compactViewport: true,
  visualTopInset: 0, topChromeInset: 0, chromeHeight: 0, providerHealthTopOffset: 0,
  activeConversationTaskCount: 0, primaryConversationTask: undefined, primaryConversationTaskMessage: undefined,
  goSettings: jest.fn(), markChromeActive: jest.fn(), setShowOptions: jest.fn(), setComposerPanel: jest.fn(),
  confirmActionFromMessage: jest.fn(), repairAgentEvidenceFromMessage: jest.fn(), safeStopMessage: jest.fn(),
}

beforeEach(() => {
  useChatStore.setState({ error: null })
  jest.clearAllMocks()
})

it.each(['error', 'cancelled'] as const)('does not resurrect a projected %s when retry removes its message', async status => {
  useChatStore.setState({ error: failure })
  const failedConversation = { ...conversation, messages: [{ ...message, status, content: ` ${failure} ` }] }
  const view = await render(<ChatActiveStatusLayer {...props} conversation={failedConversation} />)
  expect(view.queryByRole('alert')).toBeNull()
  expect(useChatStore.getState().error).toBeNull()
  await view.rerender(<ChatActiveStatusLayer {...props} conversation={{ ...conversation, messages: [] }} />)
  await view.rerender(<ChatActiveStatusLayer {...props} conversation={{ ...conversation, messages: [{ ...message, status: 'done', content: 'Recovered' }] }} />)
  expect(view.queryByRole('alert')).toBeNull()
  expect(failedConversation.messages[0].status).toBe(status)
})

it('removes only the same provisional banner when the message projection arrives later', async () => {
  useChatStore.setState({ error: failure })
  const view = await render(<ChatActiveStatusLayer {...props} conversation={{ ...conversation, messages: [] }} />)
  expect(view.getByText(failure)).toBeTruthy()
  await view.rerender(<ChatActiveStatusLayer {...props} />)
  expect(view.queryByRole('alert')).toBeNull()
  expect(useChatStore.getState().error).toBeNull()
})

it('keeps unrelated application errors latched through recovery until explicit dismissal', async () => {
  const storageError = 'Local storage write failed'
  useChatStore.setState({ error: storageError })
  const view = await render(<ChatActiveStatusLayer {...props} />)
  await act(() => useChatStore.getState().setError(null))
  await view.rerender(<ChatActiveStatusLayer {...props} conversation={{ ...conversation, messages: [{ ...message, status: 'done', content: 'Recovered' }] }} />)
  expect(view.getByText(storageError)).toBeTruthy()
  await fireEvent.press(view.getByRole('button', { name: 'Dismiss' }))
  expect(view.queryByRole('alert')).toBeNull()
})

it('does not mistake an ordinary answer or a partial text match for an error projection', async () => {
  useChatStore.setState({ error: failure })
  const view = await render(<ChatActiveStatusLayer {...props} conversation={{ ...conversation, messages: [
    { ...message, status: 'done' }, { ...message, id: 'user', role: 'user' },
    { ...message, id: 'other-failure', content: `${failure}: unrelated detail` },
  ] }} />)
  expect(view.getByText(failure)).toBeTruthy()
  expect(useChatStore.getState().error).toBe(failure)
})

it('keeps a failed cancellation visible and dismissible', async () => {
  jest.mocked(cancelConversationTask).mockResolvedValue('failed')
  const view = await render(<ChatActiveStatusLayer {...props} primaryConversationTask={{ id: 'task' } as NonNullable<ChatActiveStatusLayerProps['primaryConversationTask']>} />)
  await fireEvent.press(view.getByRole('button', { name: 'Cancel task' }))
  expect(view.getByText('chat.stopFailedMessage')).toBeTruthy()
  await act(() => useChatStore.getState().setError(null))
  expect(view.getByText('chat.stopFailedMessage')).toBeTruthy()
  await fireEvent.press(view.getByRole('button', { name: 'Dismiss' }))
  expect(view.queryByRole('alert')).toBeNull()
})
