import { describe, expect, it } from '@jest/globals'
import type { AIProvider } from '@/types/providerContracts'
import {
  createPortableDataPayloadRuntime,
  type PortableDataApplicationImportPlan,
  type PortableDataPayloadRuntimeDependencies,
} from './portableDataPayload'

const retiredOpenAICompatiblePresetId = ['custom', 'openai', 'compatible'].join('-')
const retiredAnthropicCompatiblePresetId = ['custom', 'anthropic', 'compatible'].join('-')

function provider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    id: 'portable-custom-provider',
    type: 'openai-compatible',
    presetId: 'custom-endpoint',
    detectedPresetId: 'custom-endpoint',
    wireProtocol: 'openai-compatible',
    name: 'Portable custom provider',
    apiKey: '',
    models: [],
    enabled: true,
    ...overrides,
  }
}

function payload(providerMetadata: unknown): string {
  return JSON.stringify({
    app: 'islemind',
    version: 1,
    conversations: [],
    settings: null,
    providers: [providerMetadata],
    exportedAt: 1,
  })
}

function runtime() {
  const importedPlans: PortableDataApplicationImportPlan[] = []
  const dependencies: PortableDataPayloadRuntimeDependencies = {
    records: {
      loadSettings: async () => null,
      loadProviders: async () => [],
      loadSkills: async () => [],
      loadMcpServers: async () => [],
      loadLanguagePreferenceSource: async () => 'system',
    },
    conversations: { loadAll: async () => [] },
    knowledge: {
      exportSnapshot: async () => ({ memories: [], documents: [], chunks: [] }),
      importMemoriesForReview: async () => undefined,
    },
    workspaces: {
      listScopeIds: async () => [],
      exportActiveScopeLinks: async () => ({}),
      exportSnapshots: async () => [],
    },
    recovery: {
      importApplication: async (plan) => {
        importedPlans.push(plan)
        return { status: 'committed', cancellationObserved: false }
      },
    },
    now: () => 1,
    reportFailure: () => undefined,
  }
  return {
    payloadRuntime: createPortableDataPayloadRuntime(dependencies),
    importedPlans,
  }
}

describe('portable provider identity validation', () => {
  it('imports the current custom endpoint identity with an explicit wire protocol', async () => {
    const { payloadRuntime, importedPlans } = runtime()

    await expect(payloadRuntime.importJson(payload(provider()))).resolves.toEqual({
      ok: true,
      kind: 'islemind',
      conversations: 0,
    })
    expect(importedPlans).toHaveLength(1)
    expect(importedPlans[0].providerMetadata[0]).toMatchObject({
      presetId: 'custom-endpoint',
      detectedPresetId: 'custom-endpoint',
      wireProtocol: 'openai-compatible',
    })
  })

  it.each([
    { presetId: retiredOpenAICompatiblePresetId },
    { detectedPresetId: retiredAnthropicCompatiblePresetId },
    { presetId: 'unknown-provider-preset' },
    { wireProtocol: 'unknown-compatible' },
  ])('rejects unsupported provider identity metadata before recovery %#', async (invalidIdentity) => {
    const { payloadRuntime, importedPlans } = runtime()

    await expect(
      payloadRuntime.importJson(payload({ ...provider(), ...invalidIdentity })),
    ).resolves.toEqual({ ok: false, kind: 'invalid', reason: 'invalid_structure' })
    expect(importedPlans).toHaveLength(0)
  })
})
