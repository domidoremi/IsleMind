import { describe, expect, it } from '@jest/globals'
import type { UsagePortableSnapshotRepository } from '@/modules/diagnostics'
import type { AIProvider } from '@/types/providerContracts'
import {
  createPortableDataPayloadRuntime,
  type PortableDataApplicationImportPlan,
  type PortableDataPayloadRuntimeDependencies,
} from './portableDataPayload'
import { createPortableBackupEnvelope } from './portableBackupPolicy'

const retiredOpenAICompatiblePresetId = ['custom', 'openai', 'compatible'].join('-')
const retiredAnthropicCompatiblePresetId = ['custom', 'anthropic', 'compatible'].join('-')

const emptyUsageSnapshot = {
  schema: 'islemind.usage-portable-snapshot.v1',
  records: [],
  dailyRollups: [],
  pricingEntries: [],
} as const
const populatedUsageSnapshot = {
  ...emptyUsageSnapshot,
  pricingEntries: [{
    id: 'manual-price-1',
    providerId: 'portable-custom-provider',
    modelPattern: 'current-model',
    displayName: 'Portable price',
    version: '2026-08-30',
    effectiveFrom: 1,
    source: 'manual',
    rates: {
      inputNanodollarsPerMillionTokens: 1,
      outputNanodollarsPerMillionTokens: 2,
      reasoningBilling: 'included-in-output',
    },
  }],
} as const

function usageRepository(
  snapshot = emptyUsageSnapshot,
): UsagePortableSnapshotRepository {
  return {
    load: async () => snapshot,
    replace: async () => undefined,
  }
}

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
    usage: usageRepository(),
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
    expect(importedPlans[0].usage).toBeUndefined()
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

  it('serializes selective exports as v2 envelopes', async () => {
    const importedPlans: PortableDataApplicationImportPlan[] = []
    const payloadRuntime = createPortableDataPayloadRuntime({
      records: {
        loadSettings: async () => ({ theme: 'dark' }) as never,
        loadProviders: async () => [provider({
          models: ['current-model'],
          manualModels: ['current-model'],
        })],
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
      usage: usageRepository(),
      recovery: {
        importApplication: async (plan) => {
          importedPlans.push(plan)
          return { status: 'committed', cancellationObserved: false }
        },
      },
      now: () => 10,
      reportFailure: () => undefined,
    })

    const serialized = await payloadRuntime.exportJson({
      selection: { mode: 'selective', categories: ['models'] },
    })
    const envelope = JSON.parse(serialized.json)
    expect(envelope).toMatchObject({
      schema: 'islemind.portable-backup.v2',
      version: 2,
      selection: { mode: 'selective', categories: ['models'] },
      payload: {
        app: 'islemind',
        settings: null,
        conversations: [],
      },
    })
    expect(envelope.payload.providers[0].models).toEqual(['current-model'])
    expect(importedPlans).toHaveLength(0)
  })

  it('exports and imports usage as an independent selective category', async () => {
    let usageLoadCount = 0
    const importedPlans: PortableDataApplicationImportPlan[] = []
    const payloadRuntime = createPortableDataPayloadRuntime({
      records: {
        loadSettings: async () => ({ theme: 'dark' }) as never,
        loadProviders: async () => [provider()],
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
      usage: {
        load: async () => {
          usageLoadCount += 1
          return populatedUsageSnapshot
        },
        replace: async () => undefined,
      },
      recovery: {
        importApplication: async (plan) => {
          importedPlans.push(plan)
          return { status: 'committed', cancellationObserved: false }
        },
      },
      now: () => 10,
      reportFailure: () => undefined,
    })

    const serialized = await payloadRuntime.exportJson({
      selection: { mode: 'selective', categories: ['usage'] },
    })
    const envelope = JSON.parse(serialized.json)
    expect(usageLoadCount).toBe(1)
    expect(envelope.payload).toMatchObject({
      providers: [],
      conversations: [],
      settings: null,
      usage: populatedUsageSnapshot,
    })

    await expect(payloadRuntime.importJson(serialized.json)).resolves.toEqual({
      ok: true,
      kind: 'islemind',
      conversations: 0,
    })
    expect(importedPlans).toHaveLength(1)
    expect(importedPlans[0]).toMatchObject({
      selection: { mode: 'selective', categories: ['usage'] },
      preserveSecureState: true,
      usage: populatedUsageSnapshot,
    })
  })

  it('merges selected model data without replacing provider metadata or secure state', async () => {
    const importedPlans: PortableDataApplicationImportPlan[] = []
    const currentProvider = provider({
      name: 'Current provider metadata',
      models: ['current-model'],
      manualModels: ['current-model'],
    })
    const payloadRuntime = createPortableDataPayloadRuntime({
      records: {
        loadSettings: async () => ({ theme: 'dark' }) as never,
        loadProviders: async () => [currentProvider],
        loadSkills: async () => [],
        loadMcpServers: async () => [],
        loadLanguagePreferenceSource: async () => 'user',
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
      usage: usageRepository(),
      recovery: {
        importApplication: async (plan) => {
          importedPlans.push(plan)
          return { status: 'committed', cancellationObserved: false }
        },
      },
      now: () => 10,
      reportFailure: () => undefined,
    })
    const importedProvider = provider({
      name: 'Backup provider shell',
      models: ['restored-model'],
      manualModels: ['restored-model'],
    })
    const envelope = createPortableBackupEnvelope({
      app: 'islemind',
      version: 1,
      conversations: [],
      settings: null,
      providers: [importedProvider],
      context: { memories: [], documents: [], chunks: [] },
      exportedAt: 10,
    }, { mode: 'selective', categories: ['models'] }, 10)

    await expect(payloadRuntime.importJson(JSON.stringify(envelope))).resolves.toEqual({
      ok: true,
      kind: 'islemind',
      conversations: 0,
    })
    expect(importedPlans).toHaveLength(1)
    expect(importedPlans[0]).toMatchObject({
      selection: { mode: 'selective', categories: ['models'] },
      preserveSecureState: true,
    })
    expect(importedPlans[0].providerMetadata[0]).toMatchObject({
      name: 'Current provider metadata',
      models: ['restored-model'],
    })
  })
})
