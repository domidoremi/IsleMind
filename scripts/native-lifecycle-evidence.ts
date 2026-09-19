/** Qualification-only commands. Never imported by the application entry. */
import { NativeModules } from 'react-native'
import { asAssistantRunId, asContextSnapshotId, systemClock } from '../src/core'
import { createAssistantRuntime, createSqliteAssistantRunPersistence } from '../src/modules/assistant-runtime'
import { createExpoSqliteDatabaseProvider } from '../src/platform/storage'
import { conversationPersistence } from '../src/bootstrap/conversationPersistence'
import { documentLibrary } from '../src/bootstrap/documentLibrary'
import { providerCompactStateRepository } from '../src/bootstrap/providerCompactStateRepository'
import { providerRemoteCompactLifecycle } from '../src/bootstrap/providerRemoteCompactLifecycle'

const database = createExpoSqliteDatabaseProvider()
const runs = createSqliteAssistantRunPersistence(database)
const pending = new Map<string, ReturnType<typeof createAssistantRuntime>>()
const prefix = 'local-qualification-'
const text = 'Durable output 繁體 日本語 😀 e\u0301\n'.repeat(8)
const compact = {
  conversationId: `${prefix}conversation`, providerId: `${prefix}provider`, model: 'qualification/model',
  strategy: 'native-openai-responses' as const, capabilityKind: 'native-compaction' as const,
  remoteClassification: 'remote-available' as const, settings: { remoteCompactMode: 'auto' as const },
}
function assertIsolated() {
  if (!['com.islemind.stage9', 'com.islemind.stage9.network'].includes(NativeModules.Stage9?.packageName)) {
    throw new Error('Lifecycle evidence requires the isolated qualification identity')
  }
}
function runtime() {
  return createAssistantRuntime({ clock: systemClock, ids: { next: kind => `${prefix}${kind}-${Date.now()}` }, persistence: runs,
    providerGateway: { describe: () => undefined, async *stream() { throw new Error('Qualification must never call a provider') } } })
}
export async function nativeLifecycleEvidence(name: string, input: Record<string, any>) {
  assertIsolated()
  if (name === 'lifecycle-seed') {
    const now = Date.now()
    const conversation = { id: compact.conversationId, title: 'Local qualification', providerId: null, model: null,
      systemPrompt: '', temperature: 0.7, maxTokens: 128, createdAt: now, updatedAt: now,
      messages: [{ id: `${prefix}message`, role: 'assistant' as const, content: text, status: 'cancelled' as const, timestamp: now }] }
    await conversationPersistence.save(conversation)
    const document = await documentLibrary.create({ title: 'Local qualification document', body: text })
    await providerRemoteCompactLifecycle.recordCompleted({ ...compact, mode: 'auto', messageCount: 1,
      responseId: 'qualification-response', contextFragments: [{ id: 'fragment', sourceId: 'source', sourceHash: 'qualification-hash' }] })
    return { conversation, document, compact: await providerRemoteCompactLifecycle.resolvePreviousState(compact) }
  }
  if (name === 'lifecycle-start-run') {
    if (typeof input.id !== 'string' || !input.id.startsWith(prefix)) throw new Error('A qualification run ID is required')
    const instance = runtime()
    pending.set(input.id, instance)
    let acknowledge!: () => void
    const acknowledged = new Promise<void>(resolve => { acknowledge = resolve })
    let fail!: (error: unknown) => void
    const failed = new Promise<never>((_resolve, reject) => { fail = reject })
    void instance.executeActivity({ runId: asAssistantRunId(input.id), kind: 'chat', conversationId: compact.conversationId,
      responseMessageId: `${input.id}-message`, context: { schema: 'islemind.context-snapshot.v1',
        id: asContextSnapshotId(`${input.id}-context`), createdAt: Date.now(), conversationMessageIds: [], memoryIds: [],
        knowledgeSourceIds: [], attachmentIds: [], approvedToolContextIds: [] },
      executor: { async execute({ checkpointTextDelta }) {
        await checkpointTextDelta!(text)
        acknowledge()
        await new Promise<void>(() => { /* host kills the process after durable acknowledgement */ })
        return { outputText: text }
      } },
    }).then(result => { if (!result.ok) fail(new Error(result.error.message)) }, fail)
    await Promise.race([acknowledged, failed])
    return runs.get(asAssistantRunId(input.id))
  }
  if (name === 'lifecycle-cancel-run') {
    const instance = pending.get(input.id)
    if (!instance) throw new Error('No owned qualification run')
    await instance.cancel(asAssistantRunId(input.id))
    return runs.get(asAssistantRunId(input.id))
  }
  if (name === 'lifecycle-inspect') {
    const db = await database.get()
    return { conversation: await conversationPersistence.loadRecord(compact.conversationId),
      document: input.documentId ? await documentLibrary.get(input.documentId) : undefined,
      compact: await providerRemoteCompactLifecycle.resolvePreviousState(compact),
      compactRows: await providerCompactStateRepository.listActiveCompactStates(compact.conversationId, compact.providerId, compact.model),
      runs: await Promise.all((input.runIds ?? []).map(async (id: string) => {
        if (!id.startsWith(prefix)) throw new Error('Only qualification runs may be inspected')
        return { run: await runs.get(asAssistantRunId(id)), journal: await runs.list(asAssistantRunId(id)) }
      })),
      sqlite: await db.getFirst('SELECT sqlite_version() AS version'),
      journal: await db.getFirst('PRAGMA journal_mode'), synchronous: await db.getFirst('PRAGMA synchronous'),
      foreignKeys: await db.getFirst('PRAGMA foreign_keys'), integrity: await db.getAll('PRAGMA integrity_check'),
      foreignKeyViolations: await db.getAll('PRAGMA foreign_key_check') }
  }
  throw new Error(`Unknown lifecycle evidence command: ${name}`)
}
