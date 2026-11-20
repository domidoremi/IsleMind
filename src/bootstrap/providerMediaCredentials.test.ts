import type { AIProvider } from '@/types/providerContracts'
import { embedProviderText, synthesizeProviderSpeech, transcribeProviderAudio } from './providerRuntime'

const mockRequest = jest.fn()
jest.mock('@/modules/providers', () => ({
  ...jest.requireActual('@/modules/providers'),
  fetchProviderWithTimeout: (...args: unknown[]) => mockRequest(...args),
}))
jest.mock('./providerModelAvailabilityRuntime', () => ({ bindProviderModelAvailabilityOperations: jest.fn() }))
jest.mock('./usageStatisticsRuntime', () => ({ recordProviderUsageAttempt: jest.fn(async () => undefined) }))
jest.mock('@/i18n/service', () => ({ st: (key: string) => key }))

function provider(): AIProvider {
  return { id: 'media-keys', type: 'openai-compatible', presetId: 'custom-endpoint', name: 'Media',
    baseUrl: 'https://media.invalid/v1', apiKey: 'legacy-primary', enabled: true, models: ['gpt-4o-mini-tts'],
    credentialSelection: { strategy: 'balanced', preferredGroupId: 'preferred' },
    credentialGroups: [
      { id: 'first', label: 'First', apiKey: 'first-key', enabled: true },
      { id: 'preferred', label: 'Preferred', apiKey: 'preferred-key', enabled: true },
    ],
    capabilities: { chat: true, streaming: true, modelList: true, vision: false, files: false, audioInput: true,
      audioTranscription: true, speech: true, nativeSearch: false, reasoningEffort: false, topP: true },
  }
}

beforeEach(() => {
  mockRequest.mockReset().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer })
})

it('uses the configured key for the actual speech request', async () => {
  await synthesizeProviderSpeech({ provider: provider(), text: 'Test' })
  expect(mockRequest).toHaveBeenCalledTimes(1)
  expect(mockRequest.mock.calls[0][2].headers.Authorization).toBe('Bearer preferred-key')
})

it('uses the configured key for embeddings and blocks a disabled pool before dispatch', async () => {
  const p = provider()
  p.models = ['text-embedding-3-small']
  p.capabilities!.embeddings = true
  mockRequest.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ embedding: [0.1, 0.2] }] }) })
  await expect(embedProviderText(p, 'Test')).resolves.toMatchObject({ embedding: [0.1, 0.2] })
  expect(mockRequest.mock.calls[0][2].headers.Authorization).toBe('Bearer preferred-key')
  p.credentialGroups!.forEach(group => { group.enabled = false })
  await expect(embedProviderText(p, 'Test')).rejects.toThrow('missing_key')
  expect(mockRequest).toHaveBeenCalledTimes(1)
})

it.each(['speech', 'transcription'] as const)('does not send a %s request after every key is disabled', async kind => {
  const p = provider()
  p.credentialGroups!.forEach(group => { group.enabled = false })
  const operation = kind === 'speech' ? synthesizeProviderSpeech({ provider: p, text: 'Test' })
    : transcribeProviderAudio({ provider: p, audioBase64: 'AQID', mimeType: 'audio/wav' })
  await expect(operation).rejects.toThrow('missing_key')
  expect(mockRequest).not.toHaveBeenCalled()
})
