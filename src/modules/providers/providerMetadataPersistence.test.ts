import { describe, expect, it } from '@jest/globals'
import type { AIProvider } from '@/types/providerContracts'
import {
  ProviderMetadataPersistenceValidationError,
  createProviderMetadataPersistence,
} from './providerMetadataPersistence'

const retiredOpenAICompatiblePresetId = ['custom', 'openai', 'compatible'].join('-')
const retiredAnthropicCompatiblePresetId = ['custom', 'anthropic', 'compatible'].join('-')

function provider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    id: 'custom-provider',
    type: 'openai-compatible',
    presetId: 'custom-endpoint',
    detectedPresetId: 'custom-endpoint',
    wireProtocol: 'openai-compatible',
    name: 'Custom provider',
    apiKey: '',
    models: [],
    enabled: true,
    ...overrides,
  }
}

describe('provider metadata persistence identity validation', () => {
  it('round-trips explicit empty model selections and rejects malformed lists before writing', async () => {
    let records: readonly AIProvider[] = []
    const write = jest.fn(async (value: readonly AIProvider[]) => { records = JSON.parse(JSON.stringify(value)) })
    const persistence = createProviderMetadataPersistence({ read: async () => records, write })
    await persistence.save([provider({ enabledModels: [] })])
    expect((await persistence.load())?.[0].enabledModels).toEqual([])
    const invalid = provider({ enabledModels: [''] })
    expect(() => persistence.save([invalid])).toThrow('Invalid provider model selection')
    expect(write).toHaveBeenCalledTimes(1)
    records = [invalid]
    await expect(persistence.load()).rejects.toBeInstanceOf(ProviderMetadataPersistenceValidationError)
  })
  it('round-trips key selection as metadata and rejects invalid selection before writing', async () => {
    let records: readonly AIProvider[] = []
    const write = jest.fn(async (value: readonly AIProvider[]) => { records = JSON.parse(JSON.stringify(value)) })
    const persistence = createProviderMetadataPersistence({ read: async () => records, write })
    const current = provider({ credentialSelection: { strategy: 'least-recently-used', preferredGroupId: 'key-b' } })
    await persistence.save([current])
    await expect(persistence.load()).resolves.toEqual([current])
    const invalid = { ...current, credentialSelection: { strategy: 'unsupported' } } as unknown as AIProvider
    expect(() => persistence.save([invalid])).toThrow('Invalid credential selection policy')
    expect(write).toHaveBeenCalledTimes(1)
    records = [invalid]
    await expect(persistence.load()).rejects.toBeInstanceOf(ProviderMetadataPersistenceValidationError)
  })
  it('loads the current custom endpoint identity and wire protocol', async () => {
    const persistence = createProviderMetadataPersistence({
      read: async () => [provider()],
      write: async () => undefined,
    })

    await expect(persistence.load()).resolves.toEqual([provider()])
  })

  it.each([
    {
      presetId: retiredOpenAICompatiblePresetId,
      expectedProtocol: 'openai-compatible',
    },
    {
      detectedPresetId: retiredAnthropicCompatiblePresetId,
      expectedProtocol: 'anthropic-compatible',
    },
  ])('migrates known historical protocol identity %# and writes current metadata', async ({ expectedProtocol, ...legacyIdentity }) => {
    const writes: AIProvider[][] = []
    const persisted = { ...provider(), ...legacyIdentity, wireProtocol: undefined }
    const persistence = createProviderMetadataPersistence({
      read: async () => [persisted],
      write: async (next) => {
        writes.push([...next])
      },
    })
    const expectedDetectedPresetId = legacyIdentity.detectedPresetId
      ? 'custom-endpoint'
      : persisted.detectedPresetId

    await expect(persistence.load()).resolves.toEqual([{
      ...persisted,
      presetId: 'custom-endpoint',
      detectedPresetId: expectedDetectedPresetId,
      wireProtocol: expectedProtocol,
    }])
    expect(writes).toHaveLength(1)
    expect(writes[0]?.[0]?.presetId).toBe('custom-endpoint')
    expect(writes[0]?.[0]?.detectedPresetId).toBe(expectedDetectedPresetId)
    expect(writes[0]?.[0]?.wireProtocol).toBe(expectedProtocol)
  })

  it('does not rewrite current metadata', async () => {
    const writes: AIProvider[][] = []
    const current = provider()
    const persistence = createProviderMetadataPersistence({
      read: async () => [current],
      write: async (next) => {
        writes.push([...next])
      },
    })

    await persistence.load()
    expect(writes).toHaveLength(0)
  })

  it.each([
    { presetId: 'unknown-provider-preset' },
    { wireProtocol: 'unknown-compatible' },
  ])('rejects unsupported provider identity metadata %#', async (invalidIdentity) => {
    const persistence = createProviderMetadataPersistence({
      read: async () => [{ ...provider(), ...invalidIdentity }],
      write: async () => undefined,
    })

    await expect(persistence.load()).rejects.toBeInstanceOf(
      ProviderMetadataPersistenceValidationError,
    )
  })
})
