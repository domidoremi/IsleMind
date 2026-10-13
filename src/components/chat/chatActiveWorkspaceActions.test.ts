import { renderHook } from '@testing-library/react-native'
import { useChatActiveWorkspaceActions } from './chatActiveWorkspaceActions'

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
