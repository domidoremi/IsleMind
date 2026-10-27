import { renderHook } from '@testing-library/react-native'
import { useChatActiveWorkspaceActions } from './chatActiveWorkspaceActions'
import { confirmActionForMessage } from './chatMessageBubbleActions'
import type { Message } from '@/types/chatContracts'

const mockStop = jest.fn()
const mockError = jest.fn()
jest.mock('@/presentation/features/conversations/conversationControlCommand', () => ({
  stopConversationMessage: (...args: unknown[]) => mockStop(...args),
}))
jest.mock('@/store/chatStore', () => ({ useChatStore: { getState: () => ({ setError: mockError }) } }))
jest.mock('./chatModelActions', () => ({ confirmConversationModelSwitch: jest.fn() }))
jest.mock('./chatMessageBubbleActions', () => ({ confirmActionForMessage: jest.fn(), repairAgentEvidenceDraft: jest.fn() }))

beforeEach(() => jest.clearAllMocks())

it.each([true, false])('acknowledges asynchronous Stop only after persistence settles (%s)', async success => {
  let finish!: () => void
  let fail!: (error: Error) => void
  mockStop.mockReturnValue(new Promise<void>((resolve, reject) => { finish = resolve; fail = reject }))
  const options = { activeConversation: { id: 'conversation' }, t: (key: string) => key } as Parameters<typeof useChatActiveWorkspaceActions>[0]
  const view = await renderHook(() => useChatActiveWorkspaceActions(options))
  let settled = false
  const stopped = view.result.current.safeStopMessage('conversation').then(value => { settled = true; return value })
  await Promise.resolve()
  expect(settled).toBe(false)
  expect(mockStop).toHaveBeenCalledWith('conversation')
  if (success) finish()
  else fail(new Error('durable cancellation failed'))
  await expect(stopped).resolves.toBe(success)
  if (success) expect(mockError).not.toHaveBeenCalled()
  else expect(mockError).toHaveBeenCalledWith('chat.stopFailedMessage')
})

it('binds pending-action dialogs to the active conversation and aborts the old lifetime on navigation', async () => {
  const options = { activeConversation: { id: 'conversation' }, t: (key: string) => key } as Parameters<typeof useChatActiveWorkspaceActions>[0]
  const view = await renderHook((props: typeof options) => useChatActiveWorkspaceActions(props), { initialProps: options })
  const message = { id: 'response' } as Message
  const previous = view.result.current.confirmActionFromMessage
  previous(message)
  const first = jest.mocked(confirmActionForMessage).mock.calls[0][0]
  expect(first.signal).toBeInstanceOf(AbortSignal)
  expect(first.signal?.aborted).toBe(false)
  await view.rerender({ ...options, activeConversation: { ...options.activeConversation, id: 'next-conversation' } })
  expect(first.signal?.aborted).toBe(true)
  previous(message)
  expect(confirmActionForMessage).toHaveBeenCalledTimes(1)
  view.result.current.confirmActionFromMessage(message)
  const next = jest.mocked(confirmActionForMessage).mock.calls[1][0]
  expect(next.conversationId).toBe('next-conversation')
  expect(next.signal?.aborted).toBe(false)
  await view.unmount()
  expect(next.signal?.aborted).toBe(true)
})

it('does not invoke a saved confirmation callback after unmount', async () => {
  const options = { activeConversation: { id: 'conversation' }, t: (key: string) => key } as Parameters<typeof useChatActiveWorkspaceActions>[0]
  const view = await renderHook(() => useChatActiveWorkspaceActions(options))
  const callback = view.result.current.confirmActionFromMessage
  await view.unmount()
  callback({ id: 'response' } as Message)
  expect(confirmActionForMessage).not.toHaveBeenCalled()
})

it('does not revive an old callback when navigating back to the same conversation', async () => {
  const options = { activeConversation: { id: 'conversation' }, t: (key: string) => key } as Parameters<typeof useChatActiveWorkspaceActions>[0]
  const view = await renderHook((props: typeof options) => useChatActiveWorkspaceActions(props), { initialProps: options })
  const oldCallback = view.result.current.confirmActionFromMessage
  await view.rerender({ ...options, activeConversation: { ...options.activeConversation, id: 'other' } })
  await view.rerender(options)
  oldCallback({ id: 'old-response' } as Message)
  expect(confirmActionForMessage).not.toHaveBeenCalled()
  view.result.current.confirmActionFromMessage({ id: 'current-response' } as Message)
  expect(confirmActionForMessage).toHaveBeenCalledTimes(1)
  await view.unmount()
})
