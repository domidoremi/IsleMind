import { extractConversationMemories } from './knowledgeMemoryExtraction'
import type { Message } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { Settings } from '@/types/settingsContracts'

const mockExtract = jest.fn(), mockGenerate = jest.fn()
let mockSettings: Settings
jest.mock('@/modules/knowledge', () => ({
  createMemoryCandidatePersistenceUseCase: () => ({}),
  createMemoryExtractionUseCase: () => ({ extract: (...args: unknown[]) => mockExtract(...args) }),
}))
jest.mock('@/modules/providers', () => jest.requireActual('@/modules/providers/providerConfigurationMutation'))
jest.mock('@/bootstrap/knowledgeRepository', () => ({ knowledgeRepository: {} }))
jest.mock('@/bootstrap/providerRuntime', () => ({ generateProviderText: (...args: unknown[]) => mockGenerate(...args) }))
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: { getState: () => ({ settings: mockSettings }) } }))
jest.mock('@/i18n/service', () => ({ st: (key: string) => key }))
jest.mock('@/services/runtimeHealthLog', () => ({ logContextOperation: async () => undefined }))
beforeEach(() => {
  jest.clearAllMocks()
  mockSettings = { memoryEnabled: false, proxyMode: 'off' } as Settings
  mockExtract.mockReset().mockResolvedValue([])
  mockGenerate.mockReset().mockResolvedValue('[]')
})

it('uses the admitted memory setting instead of rereading a different live setting', async () => {
  const settings = { ...mockSettings, memoryEnabled: true }
  await extractConversationMemories('reviewed', [], undefined, undefined, new AbortController().signal, { settings })
  expect(mockExtract.mock.calls[0][0].memoryEnabled).toBe(true)
  expect(mockSettings.memoryEnabled).toBe(false)
})

it('detaches message provenance and provider configuration across delayed model extraction', async () => {
  const messages = [{ id: 'reviewed-message', role: 'user', status: 'done', content: 'Reviewed fact' }] as Message[]
  const provider = { id: 'reviewed-provider', apiKey: 'synthetic-old-key', baseUrl: 'https://old.invalid/v1' } as AIProvider
  const settings = { ...mockSettings, memoryEnabled: true, proxyMode: 'custom-base-url' as const, proxyBaseUrl: 'https://reviewed.invalid' }
  await extractConversationMemories('reviewed', messages, provider, 'reviewed-model', undefined, { settings })
  const admitted = mockExtract.mock.calls[0][0]
  messages[0].content = 'Changed fact'; messages[0].id = 'changed-message'
  provider.apiKey = 'synthetic-new-key'; provider.baseUrl = 'https://changed.invalid/v1'
  settings.proxyBaseUrl = 'https://changed.invalid'
  expect(admitted.messages[0]).toMatchObject({ id: 'reviewed-message', content: 'Reviewed fact' })
  await admitted.modelExtraction.generate('Reviewed transcript', new AbortController().signal)
  expect(mockGenerate).toHaveBeenCalledWith(expect.objectContaining({
    provider: expect.objectContaining({ apiKey: 'synthetic-old-key', baseUrl: 'https://old.invalid/v1' }),
    settings: expect.objectContaining({ proxyBaseUrl: 'https://reviewed.invalid' }),
  }))
})

it('keeps the current settings snapshot for a default caller through later model generation', async () => {
  mockSettings.memoryEnabled = true; mockSettings.proxyBaseUrl = 'https://reviewed.invalid'
  const provider = { id: 'reviewed-provider', apiKey: 'synthetic-key' } as AIProvider
  await extractConversationMemories('reviewed', [], provider, 'reviewed-model')
  mockSettings.proxyBaseUrl = 'https://changed.invalid'
  await mockExtract.mock.calls[0][0].modelExtraction.generate('Transcript')
  expect(mockGenerate.mock.calls[0][0].settings.proxyBaseUrl).toBe('https://reviewed.invalid')
})
