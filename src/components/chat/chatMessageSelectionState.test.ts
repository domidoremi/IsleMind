import { act, renderHook } from '@testing-library/react-native'
import type { Conversation } from '@/types/chatContracts'
import { useChatMessageSelectionController } from './chatMessageSelectionState'

const mockEdit = jest.fn()
const mockUser = { id: 'user', role: 'user' as const, content: 'Draft', timestamp: 1, status: 'done' as const }
const mockConversation = { id: 'conversation', messages: [mockUser] } as Conversation
jest.mock('@/store/chatStore', () => ({ useChatStore: { getState: () => ({ conversations: [mockConversation] }) } }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('./chatMessageSelectionActions', () => ({}))
jest.mock('./chatMessageDraftActions', () => ({
  clearChatMessageSelection: jest.fn(),
  editUserChatMessageDraft: (...args: unknown[]) => mockEdit(...args),
}))

beforeEach(() => jest.clearAllMocks())

it.each(['success', 'failure', 'unmounted'] as const)('does not trim history before Stop or after an abandoned edit (%s)', async outcome => {
  let finish!: (success: boolean) => void
  const stopping = new Promise<boolean>(resolve => { finish = resolve })
  const options = {
    conversation: mockConversation, safeStopMessage: jest.fn(() => stopping),
    setActiveActionMessageId: jest.fn(), updateConversation: jest.fn(),
    dialog: { toast: jest.fn() }, onApplyStarter: jest.fn(), t: (key: string) => key,
  } as unknown as Parameters<typeof useChatMessageSelectionController>[0]
  const view = await renderHook(() => useChatMessageSelectionController(options))
  const editing = view.result.current.editUserMessage(mockUser)
  await Promise.resolve()
  expect(mockEdit).not.toHaveBeenCalled()
  if (outcome === 'unmounted') await view.unmount()
  await act(async () => { finish(outcome !== 'failure'); await editing })
  expect(mockEdit).toHaveBeenCalledTimes(outcome === 'success' ? 1 : 0)
  if (outcome === 'success') expect(mockEdit).toHaveBeenCalledWith(expect.objectContaining({ conversation: mockConversation, message: mockUser }))
})
