import type { AIProvider } from '@/types/providerContracts'
import type { Conversation } from '@/types/chatContracts'
import { confirmConversationModelSwitch } from './chatModelActions'

const mockLocked = jest.fn()
const mockStreaming = jest.fn()
const mockAccess = jest.fn()

jest.mock('@/services/conversationLock', () => ({
  isConversationLocked: (...args: unknown[]) => mockLocked(...args),
}))
jest.mock('@/services/chatStreamLifecycle', () => ({
  hasActiveStream: (...args: unknown[]) => mockStreaming(...args),
}))
jest.mock('@/bootstrap/providerModelAccess', () => ({
  resolveProviderModelAliasAccess: (...args: unknown[]) => mockAccess(...args),
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockLocked.mockReturnValue(false)
  mockStreaming.mockReturnValue(false)
  mockAccess.mockReturnValue({ allowed: true })
})

function options() {
  return {
    activeConversation: { id: 'chat', providerId: 'current', model: 'current-model' } as Conversation,
    nextProvider: { id: 'next', name: 'Next connection' } as AIProvider,
    nextModel: 'next-model',
    modelAccessSettings: {},
    setShowOptions: jest.fn(),
    switchConversationModel: jest.fn(() => true),
    dialog: { toast: jest.fn() },
    t: ((key: string) => key) as never,
  }
}

it.each(['locked', 'streaming', 'policy', 'switch'] as const)(
  'leaves selection open when a model switch is rejected by %s',
  reason => {
    const input = options()
    if (reason === 'locked') mockLocked.mockReturnValue(true)
    if (reason === 'streaming') mockStreaming.mockReturnValue(true)
    if (reason === 'policy') mockAccess.mockReturnValue({ allowed: false })
    if (reason === 'switch') input.switchConversationModel.mockReturnValue(false)

    expect(confirmConversationModelSwitch(input)).toBe(false)
    expect(input.setShowOptions).not.toHaveBeenCalled()
    expect(input.dialog.toast).not.toHaveBeenCalled()
    if (reason !== 'switch') expect(input.switchConversationModel).not.toHaveBeenCalled()
  },
)

it('returns success without a redundant toast after the model binding changes', () => {
  const input = options()
  expect(confirmConversationModelSwitch(input)).toBe(true)
  expect(input.switchConversationModel).toHaveBeenCalledWith('chat', 'next', 'next-model')
  expect(input.setShowOptions).toHaveBeenCalledWith(false)
  expect(input.dialog.toast).not.toHaveBeenCalled()
})

it('keeps same-model selections behind the validated store boundary', () => {
  const input = options()
  input.nextProvider.id = input.activeConversation.providerId!
  input.nextModel = input.activeConversation.model!
  expect(confirmConversationModelSwitch(input)).toBe(true)
  expect(input.switchConversationModel).toHaveBeenCalledWith('chat', 'current', 'current-model')
  expect(input.setShowOptions).toHaveBeenCalledWith(false)
  expect(input.dialog.toast).not.toHaveBeenCalled()
})
