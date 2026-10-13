import { render } from '@testing-library/react-native'
import ReportRoute from '../../../../app/report'
import { ContentReportScreen } from '@/presentation/features/conversations/ContentReportScreen'
import { conversationPersistence } from '@/bootstrap/conversationPersistence'
import type { Message } from '@/types/chatContracts'

const mockParams = { conversationId: 'synthetic-chat', messageId: 'synthetic-answer' }
let mockConversations: { id: string; messages: Message[] }[] = []
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams, router: { canGoBack: () => true, back: jest.fn() } }))
jest.mock('@/store/chatStore', () => ({ useChatStore: { getState: () => ({ conversations: mockConversations }) } }))
jest.mock('@/bootstrap/conversationPersistence', () => ({ conversationPersistence: { loadRecord: jest.fn() } }))
jest.mock('@/bootstrap/contentReporting', () => ({ contentReporting: { configuration: null } }))
jest.mock('@/presentation/features/conversations/ContentReportScreen', () => ({ ContentReportScreen: jest.fn(() => null) }))
jest.mock('@/i18n/service', () => ({ st: (_key: string, _values: unknown, fallback: string) => fallback }))

const message: Message = { id: mockParams.messageId, role: 'assistant', status: 'done', timestamp: 1,
  content: 'Fallback must not be sent', responseText: '<think>private reasoning</think>Visible synthetic answer',
  reasoning: [{ id: 'trace', type: 'tool', title: 'Private tool activity', status: 'done', content: 'Never attach me' }] }
const lastSource = () => jest.mocked(ContentReportScreen).mock.calls.at(-1)![0].source
beforeEach(() => { jest.clearAllMocks(); mockConversations = [{ id: mockParams.conversationId, messages: [message] }] })

it('captures only the selected visible answer, not hidden reasoning, activity or earlier messages', async () => {
  mockConversations[0].messages.unshift({ ...message, id: 'another-answer', responseText: 'Other private answer' })
  await render(<ReportRoute />)
  expect(lastSource()).toBe('Visible synthetic answer')
  expect(conversationPersistence.loadRecord).not.toHaveBeenCalled()
})

it.each(['streaming', 'sending'] as const)('does not capture a %s answer', async status => {
  mockConversations[0].messages = [{ ...message, status }]
  await render(<ReportRoute />)
  expect(lastSource()).toBeNull()
})

it('reads only the addressed conversation when it is not already loaded', async () => {
  mockConversations = []
  jest.mocked(conversationPersistence.loadRecord).mockResolvedValue({ id: mockParams.conversationId, messages: [message] } as never)
  await render(<ReportRoute />)
  expect(conversationPersistence.loadRecord).toHaveBeenCalledWith(mockParams.conversationId)
  expect(lastSource()).toBe('Visible synthetic answer')
})
