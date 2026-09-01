import type { AIProvider } from '@/types/providerContracts'
import type { PortableDataExportPayload } from '../contracts'
import {
  createPortableBackupEnvelope,
  migratePortableBackup,
  planPortableBackupRestore,
  selectPortableDataPayload,
} from './portableBackupPolicy'

function provider(id: string, modelId: string): AIProvider {
  return {
    id,
    type: 'openai-compatible',
    name: id,
    apiKey: '',
    models: [modelId],
    modelConfigs: [{
      id: modelId,
      name: modelId,
      provider: 'openai-compatible',
      contextWindow: 32_000,
      maxTokens: 32_000,
      maxOutputTokens: 4_000,
      defaultMaxTokens: 2_000,
      supportsVision: false,
      supportsFiles: false,
      source: 'remote',
    }],
    enabled: true,
  }
}

function payload(): PortableDataExportPayload {
  return {
    app: 'islemind',
    version: 1,
    conversations: [{
      id: 'conversation-1',
      title: 'Conversation',
      providerId: 'provider-1',
      model: 'model-1',
      systemPrompt: '',
      temperature: 0.7,
      maxTokens: 100,
      messages: [],
      createdAt: 1,
      updatedAt: 1,
    }],
    settings: { theme: 'dark' } as never,
    providers: [provider('provider-1', 'model-1')],
    skills: [{ schema: 'islemind.skill.v1', id: 'skill-1', name: 'Skill' } as never],
    mcpServers: [{ id: 'mcp-1', name: 'MCP', url: 'https://example.com' } as never],
    context: { memories: [], documents: [], chunks: [] },
    tavernSnapshots: { 'workspace-1': {} as never },
    exportedAt: 1,
  }
}

describe('portable backup policy', () => {
  it('creates a selective, redacted payload without unrelated categories', () => {
    const selected = selectPortableDataPayload(payload(), {
      mode: 'selective',
      categories: ['providers', 'models'],
    })
    expect(selected.providers).toHaveLength(1)
    expect(selected.providers[0].apiKey).toBe('')
    expect(selected.providers[0].modelConfigs).toHaveLength(1)
    expect(selected.conversations).toHaveLength(0)
    expect(selected.settings).toBeNull()
    expect(selected.tavernSnapshots).toBeUndefined()
  })

  it('keeps provider metadata and model data as separate selectable categories', () => {
    const providersOnly = selectPortableDataPayload(payload(), {
      mode: 'selective',
      categories: ['providers'],
    })
    expect(providersOnly.providers[0]).toMatchObject({
      id: 'provider-1',
      models: [],
      modelConfigs: undefined,
    })

    const modelsOnly = selectPortableDataPayload(payload(), {
      mode: 'selective',
      categories: ['models'],
    })
    expect(modelsOnly.providers[0]).toMatchObject({
      id: 'provider-1',
      models: ['model-1'],
    })
    expect(modelsOnly.providers[0].baseUrl).toBeUndefined()
  })

  it('projects usage independently and reports its replacement scope', () => {
    const backupPayload: PortableDataExportPayload = {
      ...payload(),
      usage: {
        schema: 'islemind.usage-portable-snapshot.v1',
        records: [],
        dailyRollups: [],
        pricingEntries: [{
          id: 'manual-price-1',
          modelPattern: 'model-1',
          displayName: 'Manual price',
          version: '2026-08-30',
          effectiveFrom: 1,
          source: 'manual',
          rates: {
            inputNanodollarsPerMillionTokens: 1,
            outputNanodollarsPerMillionTokens: 2,
            reasoningBilling: 'included-in-output',
          },
        }],
      },
    }
    const envelope = createPortableBackupEnvelope(
      backupPayload,
      { mode: 'selective', categories: ['usage'] },
      10,
    )
    expect(envelope.payload.usage).toEqual(backupPayload.usage)
    expect(envelope.payload.providers).toEqual([])

    const plan = planPortableBackupRestore({ backup: envelope })
    expect(plan.counts.usage).toBe(1)
    expect(plan.actions).toContainEqual({ category: 'usage', action: 'replace' })
  })

  it('does not emit a selective usage envelope without a snapshot', () => {
    expect(() => createPortableBackupEnvelope(
      payload(),
      { mode: 'selective', categories: ['usage'] },
      10,
    )).toThrow('requires a usage snapshot')
  })

  it('migrates a legacy v1 payload and reports dependency/conflict actions', () => {
    const legacy = payload()
    const envelope = migratePortableBackup(legacy)
    expect(envelope?.schema).toBe('islemind.portable-backup.v2')
    const plan = planPortableBackupRestore({
      backup: createPortableBackupEnvelope(legacy, { mode: 'selective', categories: ['conversations'] }, 10),
      existing: { conversationIds: ['conversation-1'] },
      conflictMode: 'replace',
    })
    expect(plan.missingDependencies).toContain('conversations→providers (provider metadata is not selected)')
    expect(plan.conflicts).toContainEqual({ category: 'conversations', id: 'conversation-1' })
    expect(plan.actions).toContainEqual({ category: 'conversations', action: 'replace', id: 'conversation-1' })
    expect(plan.safeRollbackRequired).toBe(true)
    expect(plan.secretsIncluded).toBe(false)
  })
})
