import { conversationAssistantProviderAdmissionRuntime } from './conversationAssistantProviderAdmissionRuntime'
import type { Conversation } from '@/types/chatContracts'
import type { Settings } from '@/types/settingsContracts'

const mockAdmission = jest.fn()
const mockStop = jest.fn()
const mockFailure = jest.fn()
let mockController: AbortController | undefined
jest.mock('@/bootstrap/conversationProviderAdmissionRuntime', () => ({ conversationProviderAdmissionRuntime: { admitConversation: (...args: unknown[]) => mockAdmission(...args) } }))
jest.mock('@/bootstrap/conversationAssistantMessageProjection', () => ({ projectConversationAssistantFailure: (...args: unknown[]) => mockFailure(...args) }))
jest.mock('@/bootstrap/providerRuntimeDiagnostics', () => ({ createProviderCompatibilityTrace: jest.fn() }))
jest.mock('@/services/chatStreamLifecycle', () => ({ getActiveStream: () => mockController ? { controller: mockController } : undefined }))
jest.mock('@/presentation/features/conversations/conversationControlCommand', () => ({ stopConversationMessage: (...args: unknown[]) => mockStop(...args) }))
jest.mock('@/services/chatErrorUtils', () => ({ buildSetupGuide: () => 'setup' }))
jest.mock('@/i18n/service', () => ({ st: (key: string) => key }))
jest.mock('@/store/chatStore', () => ({ useChatStore: { getState: jest.fn() } }))
jest.mock('@/store/chatStreamingStore', () => ({ useChatStreamingStore: { getState: jest.fn() } }))

beforeEach(() => { jest.clearAllMocks(); mockController = new AbortController() })

it.each(['owned', 'superseded', 'already-stopped'] as const)('settles %s declined consent without an error or cancelling a newer turn', async state => {
  const signal = mockController!.signal
  if (state === 'superseded') mockController = new AbortController()
  if (state === 'already-stopped') mockController = undefined
  mockAdmission.mockResolvedValue({ kind: 'rejected', reason: 'confirmation_declined', code: 'unknown', providerId: 'p' })
  const outcome = await conversationAssistantProviderAdmissionRuntime.admit({ conversationId: 'c', assistantMessageId: 'm',
    conversation: { id: 'c', providerId: 'p', model: 'm' } as Conversation, providers: [], settings: {} as Settings, signal })
  expect(outcome).toEqual({ kind: 'cancelled' })
  expect(mockStop).toHaveBeenCalledTimes(state === 'owned' ? 1 : 0)
  if (state === 'owned') expect(mockStop).toHaveBeenCalledWith('c')
  expect(mockFailure).not.toHaveBeenCalled()
})

it('keeps actual admission failures as failures with localized content', async () => {
  mockAdmission.mockResolvedValue({ kind: 'rejected', reason: 'policy_blocked', code: 'unknown', providerId: 'p', messageKey: 'modelStatus.policyBlocked' })
  await conversationAssistantProviderAdmissionRuntime.admit({ conversationId: 'c', assistantMessageId: 'm',
    conversation: { id: 'c', providerId: 'p', model: 'm' } as Conversation, providers: [], settings: {} as Settings, signal: mockController!.signal })
  expect(mockFailure).toHaveBeenCalledWith(expect.objectContaining({ content: 'modelStatus.policyBlocked' }))
  expect(mockStop).not.toHaveBeenCalled()
})
