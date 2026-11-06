import { describe, expect, it } from '@jest/globals'
import type { UsagePortableSnapshotRepository } from '@/modules/diagnostics'
import { SAVED_DOCUMENT_SCHEMA, type SavedDocument } from '@/modules/documents'
import type { AIProvider } from '@/types/providerContracts'
import type { Settings } from '@/types/settingsContracts'
import {
  createPortableDataPayloadRuntime,
  type PortableDataApplicationImportPlan,
  type PortableDataPayloadRuntimeDependencies,
} from './portableDataPayload'
import { createPortableBackupEnvelope } from './portableBackupPolicy'

const retiredOpenAICompatiblePresetId = ['custom', 'openai', 'compatible'].join('-')
const retiredAnthropicCompatiblePresetId = ['custom', 'anthropic', 'compatible'].join('-')

it('round-trips scene templates, provenance and explicit scopes through a complete portable import', async () => {
  const scene = { schema: 'islemind.scene-plan.v1' as const, id: 'scene', name: 'Research', revision: 2,
    configuration: { enabledTools: [], knowledgeSources: [], contextPolicy: null, toolDeclarationMode: 'auto' as const } }
  const source = runtime([], [], { scenePlans: [scene], theme: 'light', language: 'en', defaultProvider: null, fontSize: 14, hapticsEnabled: false })
  const exported = await source.payloadRuntime.exportPayload()
  exported.conversations = [{ id: 'conversation', title: 'History', providerId: 'p', model: 'm',
    systemPrompt: '', temperature: 0.6, maxTokens: 10, createdAt: 1, updatedAt: 2, messages: [],
    enabledTools: [], knowledgeSources: [], toolDeclarationModeOverride: 'auto',
    resourceScopeOverride: { schema: 'islemind.conversation-resource-scope.v1', tools: 'none', knowledge: 'none' },
    scenePlanSource: { schema: 'islemind.conversation-scene-plan.v1', id: scene.id, name: scene.name, revision: 2, appliedAt: 2 } }]
  const target = runtime()
  const result = await target.payloadRuntime.importJson(JSON.stringify(exported))
  expect(result.ok).toBe(true)
  expect(target.importedPlans[0].settings?.scenePlans).toEqual([scene])
  expect(target.importedPlans[0].conversations[0]).toMatchObject({ toolDeclarationModeOverride: 'auto',
    resourceScopeOverride: { tools: 'none', knowledge: 'none' }, scenePlanSource: { id: 'scene', revision: 2 } })
  const invalid = { ...exported, conversations: [{ ...exported.conversations[0], resourceScopeOverride: { schema: 'future', tools: 'all' } }] }
  expect((await runtime().payloadRuntime.importJson(JSON.stringify(invalid))).ok).toBe(false)
})

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

function runtime(documents: SavedDocument[] = [], agents: import('@/modules/assistant-runtime/agentDefinition').AgentDefinition[] = [], settings: Settings | null = null) {
  const importedPlans: PortableDataApplicationImportPlan[] = []
  const dependencies: PortableDataPayloadRuntimeDependencies = {
    records: {
      loadSettings: async () => settings,
      loadProviders: async () => [],
      loadSkills: async () => [],
      loadAgentDefinitions: async () => agents,
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
    documents: { loadSnapshot: async () => documents },
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

describe('portable Agent definitions', () => {
  const { createAgentDefinition } = require('@/modules/assistant-runtime/agentDefinition') as typeof import('@/modules/assistant-runtime/agentDefinition')
  const agent = createAgentDefinition({ id: 'agent-1', name: 'Research', providerId: 'provider', modelId: 'model' })
  it('exports configuration with settings, previews it, and never exports run approval state', async () => {
    const { payloadRuntime, importedPlans } = runtime([], [agent])
    const all = await payloadRuntime.exportPayload()
    expect(all.agentDefinitions).toEqual([agent])
    expect((await payloadRuntime.exportPayload({ selection: { mode: 'selective', categories: ['documents'] } })).agentDefinitions).toBeUndefined()
    const json = (await payloadRuntime.exportJson({ selection: { mode: 'selective', categories: ['settings'] } })).json
    expect(await payloadRuntime.importJson(json, { confirmRestore: (preview) => {
      expect(preview.actions).toContainEqual({ category: 'settings', id: agent.id, action: 'replace' })
      return true
    } })).toMatchObject({ ok: true })
    expect(importedPlans[0].agentDefinitions).toEqual([agent])
    expect(json).not.toContain('continuationToken')
  })
  it('preserves absent legacy collections and rejects grants, duplicate IDs and execution credentials before writes', async () => {
    const { payloadRuntime, importedPlans } = runtime([], [agent])
    const legacy = JSON.parse(payload(provider()))
    await payloadRuntime.importJson(JSON.stringify(legacy))
    expect(importedPlans[0].agentDefinitions).toBeUndefined()
    for (const invalid of [[agent, agent], [{ ...agent, grants: ['write'] }], [{ ...agent, continuationToken: 'not-a-capability' }]]) {
      expect(await payloadRuntime.importJson(JSON.stringify({ ...legacy, agentDefinitions: invalid }))).toMatchObject({ ok: false, reason: 'invalid_structure' })
    }
    expect(importedPlans).toHaveLength(1)
  })
})

describe('portable saved documents', () => {
  const document: SavedDocument = {
    schema: SAVED_DOCUMENT_SCHEMA, id: 'doc-1', revision: 'write-1', title: 'My edited draft',
    body: 'Human edits', createdAt: 1, updatedAt: 2,
    origin: { conversationId: 'chat', conversationTitle: 'Original chat', messageId: 'answer',
      messageStatus: 'cancelled', messageTimestamp: 1, originalText: 'Partial answer', citations: [] },
    reviewContext: { acceptedAt: 2, title: 'Reviewed draft', body: 'Earlier proposed text [S1]', sources: [
      { citationId: 'source-1', type: 'knowledge', documentId: 'knowledge-1', title: 'Reviewed source', updatedAt: 1, text: 'Exact retained source.\n' },
    ] },
  }

  it('includes editable text and immutable captured provenance in full and documents-only backups', async () => {
    const { payloadRuntime } = runtime([document])
    expect((await payloadRuntime.exportPayload()).savedDocuments).toEqual([document])
    const selective = await payloadRuntime.exportPayload({ selection: { mode: 'selective', categories: ['documents'] } })
    expect(selective.savedDocuments).toEqual([document])
    expect(selective.conversations).toEqual([])
    expect(selective.context?.documents).toEqual([])
    expect((await payloadRuntime.exportPayload({ selection: { mode: 'selective', categories: ['conversations'] } })).savedDocuments).toBeUndefined()
  })

  it('previews same-ID document replacement and honours refusal before calling recovery', async () => {
    const { payloadRuntime, importedPlans } = runtime([document])
    const json = (await payloadRuntime.exportJson({ selection: { mode: 'selective', categories: ['documents'] } })).json
    const result = await payloadRuntime.importJson(json, { confirmRestore: (preview) => {
      expect(preview.counts.documents).toBe(1)
      expect(preview.actions).toContainEqual({ category: 'documents', id: 'doc-1', action: 'replace' })
      return false
    } })
    expect(result).toMatchObject({ ok: false, reason: 'operation_cancelled' })
    expect(importedPlans).toEqual([])
  })

  it('hands selected documents to recovery without converting them to Knowledge or successful answers', async () => {
    const { payloadRuntime, importedPlans } = runtime([document])
    const json = (await payloadRuntime.exportJson({ selection: { mode: 'selective', categories: ['documents'] } })).json
    expect(await payloadRuntime.importJson(json)).toMatchObject({ ok: true })
    expect(importedPlans[0].savedDocuments).toEqual([document])
    expect(importedPlans[0].knowledge).toMatchObject({ documents: [] })
    expect(importedPlans[0].savedDocuments?.[0].origin?.messageStatus).toBe('cancelled')
    expect(importedPlans[0].savedDocuments?.[0].reviewContext).toEqual(document.reviewContext)
  })

  it('normalizes a legacy v1 document but refuses malformed retained context before recovery', async () => {
    const { payloadRuntime, importedPlans } = runtime([document])
    const old = JSON.parse(payload(provider()))
    const { reviewContext: _review, ...withoutReview } = document
    const legacy = { ...withoutReview, schema: 'islemind.saved-document.v1' }
    expect(await payloadRuntime.importJson(JSON.stringify({ ...old, savedDocuments: [legacy] }))).toMatchObject({ ok: true })
    expect(importedPlans[0].savedDocuments).toEqual([withoutReview])
    for (const invalid of [{ ...document, reviewContext: { ...document.reviewContext, sources: [] } }, { ...legacy, reviewContext: document.reviewContext }]) {
      expect(await payloadRuntime.importJson(JSON.stringify({ ...old, savedDocuments: [invalid] }))).toMatchObject({ ok: false, reason: 'invalid_structure' })
    }
    expect(importedPlans).toHaveLength(1)
  })

  it('preserves absence in a legacy full backup and rejects missing selected or malformed documents before recovery', async () => {
    const { payloadRuntime, importedPlans } = runtime([document])
    await payloadRuntime.importJson(payload(provider()))
    expect(importedPlans[0].savedDocuments).toBeUndefined()
    const count = importedPlans.length
    const old = JSON.parse(payload(provider()))
    for (const savedDocuments of [[{ ...document, schema: 'unknown' }], [document, document]]) {
      expect(await payloadRuntime.importJson(JSON.stringify({ ...old, savedDocuments }))).toMatchObject({ ok: false, reason: 'invalid_structure' })
    }
    expect(await payloadRuntime.importJson(JSON.stringify({ schema: 'islemind.portable-backup.v2', version: 2,
      selection: { mode: 'selective', categories: ['documents'] }, payload: old, createdAt: 1 })))
      .toMatchObject({ ok: false, reason: 'invalid_structure' })
    expect(importedPlans).toHaveLength(count)
  })
})

describe('portable model favorites', () => {
  const favorites = [
    { providerId: 'connection-a', modelId: 'requested-alias' },
    { providerId: 'connection-b', modelId: 'requested-alias' },
  ]
  const settings = {
    defaultProvider: 'different-default',
    lastPreferredModel: { schema: 'islemind.global-model-preference.v1', providerId: 'preferred', model: 'different-model' },
    modelDisplayAliases: [{ ...favorites[0], displayName: 'Friendly name' }],
    modelFavorites: favorites,
  } as unknown as Settings

  it('round-trips connection/requested identities with settings in full and selective backups', async () => {
    const source = runtime([], [], settings)
    expect((await source.payloadRuntime.exportPayload()).settings?.modelFavorites).toEqual(favorites)
    expect((await source.payloadRuntime.exportPayload({ selection: { mode: 'selective', categories: ['models'] } })).settings).toBeNull()
    const json = (await source.payloadRuntime.exportJson({ selection: { mode: 'selective', categories: ['settings'] } })).json
    const target = runtime()
    expect((await target.payloadRuntime.importJson(json)).ok).toBe(true)
    expect(target.importedPlans[0].settings).toMatchObject({ ...settings })
    expect(target.importedPlans[0].providerMetadata).toEqual([])
  })

  it('restores an explicitly empty favorite list while preserving omitted legacy fields during selective import', async () => {
    const source = runtime([], [], { defaultProvider: 'restored-default', modelFavorites: [] } as unknown as Settings)
    const exported = JSON.parse((await source.payloadRuntime.exportJson({ selection: { mode: 'selective', categories: ['settings'] } })).json)
    const target = runtime([], [], settings)
    expect((await target.payloadRuntime.importJson(JSON.stringify(exported))).ok).toBe(true)
    expect(target.importedPlans[0].settings).toMatchObject({ defaultProvider: 'restored-default', modelFavorites: [] })
    delete exported.payload.settings.modelFavorites
    exported.payload.version = 1
    expect((await target.payloadRuntime.importJson(JSON.stringify(exported))).ok).toBe(true)
    expect(target.importedPlans[1].settings?.modelFavorites).toEqual(favorites)
  })

  it.each([1, 2])('normalizes favorite entries in payload v%s without changing historical model attribution', async (version) => {
    const target = runtime()
    const result = await target.payloadRuntime.importJson(JSON.stringify({
      app: 'islemind', version, exportedAt: 1, providers: [],
      settings: { ...settings, modelFavorites: [...favorites, favorites[0], null, { providerId: 'bad', modelId: '' }] },
      conversations: [{ id: 'history', title: 'Archive', providerId: 'historical-connection', model: 'historical-model',
        messages: [{ id: 'reply', role: 'assistant', content: 'Saved answer', timestamp: 1, status: 'done',
          providerId: 'actual-connection', model: 'actual-model' }] }],
    }))
    expect(result.ok).toBe(true)
    expect(target.importedPlans[0].settings?.modelFavorites).toEqual(favorites)
    expect(target.importedPlans[0].conversations[0]).toMatchObject({ providerId: 'historical-connection', model: 'historical-model' })
    expect(target.importedPlans[0].conversations[0].messages[0]).toMatchObject({ providerId: 'actual-connection', model: 'actual-model' })
  })
})

describe('portable tool declaration settings', () => {
  it.each(['full', 'auto'] as const)('round-trips explicit %s settings in a selective backup', async mode => {
    const source = runtime([], [], { toolDeclarationMode: mode } as Settings)
    const json = (await source.payloadRuntime.exportJson({ selection: { mode: 'selective', categories: ['settings'] } })).json
    const target = runtime([], [], { toolDeclarationMode: mode === 'full' ? 'auto' : 'full' } as Settings)
    expect((await target.payloadRuntime.importJson(json)).ok).toBe(true)
    expect(target.importedPlans[0].settings?.toolDeclarationMode).toBe(mode)
  })

  it('preserves an existing mode when a legacy selective backup omits it and normalizes an explicit bad value', async () => {
    const source = runtime([], [], {} as Settings)
    const exported = JSON.parse((await source.payloadRuntime.exportJson({ selection: { mode: 'selective', categories: ['settings'] } })).json)
    const target = runtime([], [], { toolDeclarationMode: 'auto' } as Settings)
    expect((await target.payloadRuntime.importJson(JSON.stringify(exported))).ok).toBe(true)
    expect(target.importedPlans[0].settings?.toolDeclarationMode).toBe('auto')
    exported.payload.settings.toolDeclarationMode = 'unknown'
    expect((await target.payloadRuntime.importJson(JSON.stringify(exported))).ok).toBe(true)
    expect(target.importedPlans[1].settings?.toolDeclarationMode).toBe('full')
    const fresh = runtime()
    delete exported.payload.settings.toolDeclarationMode
    expect((await fresh.payloadRuntime.importJson(JSON.stringify(exported))).ok).toBe(true)
    expect(fresh.importedPlans[0].settings).not.toHaveProperty('toolDeclarationMode')
  })
})

describe('portable model preference compatibility', () => {
  const preference = { schema: 'islemind.global-model-preference.v1', providerId: 'remembered', model: 'alias' }
  const history = [{ id: 'old', role: 'assistant', content: 'Historical answer', timestamp: 1, status: 'done' }]
  const base = { id: 'unbound', title: 'Archive', providerId: null, model: null, messages: history }

  it.each([1, 2])('imports payload v%s without binding unbound history or changing the configured default', async (version) => {
    const { payloadRuntime, importedPlans } = runtime()
    const result = await payloadRuntime.importJson(JSON.stringify({
      app: 'islemind', version, providers: [], conversations: [base], exportedAt: 1,
      settings: { defaultProvider: 'legacy-default', lastPreferredModel: preference },
    }))
    expect(result.ok).toBe(true)
    expect(importedPlans[0].settings).toMatchObject({ defaultProvider: 'legacy-default', lastPreferredModel: preference })
    expect(importedPlans[0].conversations[0]).toMatchObject({ providerId: null, model: null })
    expect(importedPlans[0].conversations[0].messages[0].providerId).toBeUndefined()
    expect(importedPlans[0].conversations[0].messages[0].model).toBeUndefined()
  })

  it('rejects future payload or preference versions before changing application state', async () => {
    const { payloadRuntime, importedPlans } = runtime()
    for (const input of [
      { version: 99, settings: null },
      { version: 2, settings: { lastPreferredModel: { ...preference, schema: 'islemind.global-model-preference.v99' } } },
    ]) {
      expect((await payloadRuntime.importJson(JSON.stringify({ app: 'islemind', providers: [], conversations: [base], exportedAt: 1, ...input }))).ok).toBe(false)
    }
    expect(importedPlans).toHaveLength(0)
  })

  it('writes payload v2 and retains the existing v2 backup envelope', async () => {
    const { payloadRuntime } = runtime()
    expect((await payloadRuntime.exportPayload()).version).toBe(2)
    const exported = JSON.parse((await payloadRuntime.exportJson({ selection: { mode: 'full' } })).json)
    expect(exported.schema).toBe('islemind.portable-backup.v2')
    expect(exported.payload.version).toBe(2)
  })

  it('round-trips actual message attribution independently of current preference and rejects future protocol versions', async () => {
    const { payloadRuntime, importedPlans } = runtime()
    const generationProtocol = { schema: 'islemind.message-protocol.v1', adapterId: 'anthropic' }
    const attributed = { ...base, providerId: 'current-C', model: 'model-C', messages: [
      ...history, { ...history[0], id: 'new', providerId: 'actual-B', model: 'upstream-B', generationProtocol },
    ] }
    const json = JSON.stringify({ app: 'islemind', version: 2, providers: [], conversations: [attributed], exportedAt: 1, settings: null })
    expect((await payloadRuntime.importJson(json)).ok).toBe(true)
    expect(importedPlans[0].conversations[0].messages[1]).toMatchObject({ providerId: 'actual-B', model: 'upstream-B', generationProtocol })
    expect(importedPlans[0].conversations[0].messages[0].providerId).toBeUndefined()
    expect((await payloadRuntime.importJson(json.replace('islemind.message-protocol.v1', 'islemind.message-protocol.v99'))).ok).toBe(false)
    expect(importedPlans).toHaveLength(1)
  })
})

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
      documents: { loadSnapshot: async () => [] },
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
      documents: { loadSnapshot: async () => [] },
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
      documents: { loadSnapshot: async () => [] },
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
