import {
  beginPortableImportParticipant,
  completePortableImportParticipant,
  completePortableImportRestoreParticipant,
  createPortableImportRecoveryEnvelope,
  markPortableImportCommitted,
  markPortableImportParticipantPrepared,
  markPortableImportPrepared,
  markPortableImportRestoredWithoutEffects,
  requirePortableImportRollback,
  type PortableImportRecoveryEnvelopeV1,
} from '@/core'
import {
  createAsyncStoragePortableImportRecoveryStore,
  createExpoSqliteDatabaseProvider,
  createSqlitePortableImportRecoveryBlobStorage,
  type PortableImportRecoveryStore,
} from '@/platform/storage'
import type { Conversation } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { Settings } from '@/types/settingsContracts'
import type { SkillDefinition } from '@/types/skillContracts'
import type { McpServerConfig } from '@/types/mcpContracts'
import type { LanguagePreferenceSource } from '@/i18n/languagePreference'
import type {
  KnowledgeRepositorySnapshot,
  PortableKnowledgeSnapshot,
} from '@/modules/knowledge'
import type { ProviderCredentialMutation } from '@/modules/providers'
import type { TavernSnapshot } from '@/modules/workspaces'
import { conversationPersistence } from './conversationPersistence'
import {
  knowledgeRepository,
  replaceKnowledgeContextSnapshot,
} from './knowledgeRepository'
import { portableKnowledgeSnapshot } from './knowledgePortableSnapshot'
import {
  KNOWN_SEARCH_SECURE_KEYS,
  OBSERVABILITY_SINK_API_KEY,
  providerCredentialStorage,
  secureKeyValueStorage,
} from './secureCredentialStorage'
import { clearProviderHealthSnapshot } from './providerHealthRepository'
import { clearAllCompactStates } from './providerCompactStateRepository'
import { clearCompactUsageRecords } from './providerCompactUsage'
import {
  cleanupPortableTavernWorkspaceBackup,
  importPortableTavernWorkspaceState,
  resolvePortableTavernWorkspaceBackupId,
  restorePortableTavernWorkspaceBackup,
} from './tavernWorkspace'
import { clearRuntimeLog } from '@/services/runtimeLog'

const PARTICIPANT_IDS = Object.freeze([
  'workspaces',
  'application_records',
  'conversations',
  'secure_state',
  'knowledge',
] as const)

const APPLICATION_RECORD_KEYS = Object.freeze({
  settings: '@islemind/settings',
  providers: '@islemind/providers',
  skills: '@islemind/skills',
  mcpServers: '@islemind/mcp-servers',
  languageSource: '@islemind/language-source',
} as const)

const APPLICATION_RECORD_BACKUP_SCHEMA =
  'islemind.portable-import-application-records.v1'
const CONVERSATION_BACKUP_SCHEMA =
  'islemind.portable-import-conversations.v1'
const KNOWLEDGE_BACKUP_SCHEMA =
  'islemind.portable-import-knowledge.v1'
const WORKSPACE_PLAN_SCHEMA =
  'islemind.portable-import-workspaces.v1'
const SECURE_MANIFEST_SCHEMA =
  'islemind.portable-import-secure-manifest.v1'
const SECURE_SIDECAR_NULL = 'islemind.portable-import-secret.v1:null'
const SECURE_SIDECAR_VALUE_PREFIX = 'islemind.portable-import-secret.v1:value:'
const SECURE_SIDECAR_KEY_PREFIX = 'islemind.recovery.portable-import.v1.'
const MAX_SECURE_ITEMS = 4_096
let portableImportOperationSequence = 0

export interface PortableApplicationImportPlan {
  readonly portableSource: string
  readonly conversations: readonly Conversation[]
  readonly settings: Settings | null
  readonly languagePreferenceSource?: LanguagePreferenceSource
  readonly providerMetadata: readonly AIProvider[]
  readonly credentialProviders: readonly AIProvider[]
  readonly skills: readonly SkillDefinition[]
  readonly mcpServers: readonly McpServerConfig[]
  readonly knowledge: Partial<PortableKnowledgeSnapshot>
  readonly tavernEntries: readonly {
    readonly scopeId?: string
    readonly snapshot: Partial<TavernSnapshot> | undefined
  }[]
  readonly tavernActiveScopeLinks: Readonly<Record<string, string>>
  readonly conversationIds: readonly string[]
}

export interface PortableImportRecoveryParticipant<Plan> {
  readonly id: string
  prepare(
    plan: Plan,
    envelope: PortableImportRecoveryEnvelopeV1,
    signal?: AbortSignal,
  ): Promise<string>
  apply(envelope: PortableImportRecoveryEnvelopeV1, signal?: AbortSignal): Promise<void>
  restore(envelope: PortableImportRecoveryEnvelopeV1): Promise<void>
  cleanup(envelope: PortableImportRecoveryEnvelopeV1): Promise<void>
}

export interface PortableImportRecoveryCoordinatorDependencies<Plan> {
  readonly store: PortableImportRecoveryStore
  readonly participants: readonly PortableImportRecoveryParticipant<Plan>[]
  readonly now: () => number
  readonly createOperationId: () => string
  readonly sourceText: (plan: Plan) => string
  readonly postCommit: (envelope: PortableImportRecoveryEnvelopeV1) => Promise<void>
}

export type PortableImportRecoveryExecutionResult = Readonly<{
  status: 'committed' | 'rolled_back' | 'recovery_required'
  cancellationObserved: boolean
}>

export type InterruptedPortableImportRecoveryResult = Readonly<{
  status: 'none' | 'restored' | 'committed' | 'recovery_required'
}>

class PortableImportParticipantApplyError extends Error {
  constructor(readonly effectPossible: boolean) {
    super('A portable import participant failed.')
    this.name = 'PortableImportParticipantApplyError'
  }
}

export function createPortableImportRecoveryCoordinator<Plan>(
  dependencies: PortableImportRecoveryCoordinatorDependencies<Plan>,
) {
  const participantIds = dependencies.participants.map((participant) => participant.id)
  if (
    participantIds.length === 0 ||
    new Set(participantIds).size !== participantIds.length
  ) {
    throw new TypeError('The portable import recovery participants are invalid.')
  }

  async function persistTransition(
    previous: PortableImportRecoveryEnvelopeV1,
    next: PortableImportRecoveryEnvelopeV1,
  ): Promise<PortableImportRecoveryEnvelopeV1> {
    await dependencies.store.writeEnvelope(next, previous.revision)
    return next
  }

  async function cleanupAndRemove(
    envelope: PortableImportRecoveryEnvelopeV1,
  ): Promise<boolean> {
    try {
      for (const participant of dependencies.participants) {
        await participant.cleanup(envelope)
      }
      await dependencies.store.removeEnvelope(envelope.revision)
      return true
    } catch {
      return false
    }
  }

  async function rollback(
    initial: PortableImportRecoveryEnvelopeV1,
  ): Promise<boolean> {
    let envelope = initial
    try {
      while (envelope.phase === 'rollback_required') {
        const index = envelope.restoreParticipantIndex
        if (index === undefined) return false
        await dependencies.participants[index].restore(envelope)
        envelope = await persistTransition(
          envelope,
          completePortableImportRestoreParticipant(
            envelope,
            index,
            dependencies.now(),
          ),
        )
      }
      return envelope.phase === 'restored' && await cleanupAndRemove(envelope)
    } catch {
      return false
    }
  }

  async function recoverLocked(): Promise<InterruptedPortableImportRecoveryResult> {
    let envelope = await dependencies.store.readEnvelope()
    if (!envelope) return { status: 'none' }
    if (!sameStrings(envelope.participants, participantIds)) {
      return { status: 'recovery_required' }
    }

    try {
      if (envelope.phase === 'preparing' || envelope.phase === 'prepared') {
        envelope = await persistTransition(
          envelope,
          markPortableImportRestoredWithoutEffects(envelope, dependencies.now()),
        )
      } else if (envelope.phase === 'applying') {
        const restoreIndex = envelope.activeParticipantIndex ??
          envelope.appliedParticipantCount - 1
        if (restoreIndex < 0) {
          envelope = await persistTransition(
            envelope,
            markPortableImportRestoredWithoutEffects(envelope, dependencies.now()),
          )
        } else {
          envelope = await persistTransition(
            envelope,
            requirePortableImportRollback(envelope, restoreIndex, dependencies.now()),
          )
        }
      }

      if (envelope.phase === 'rollback_required') {
        return await rollback(envelope)
          ? { status: 'restored' }
          : { status: 'recovery_required' }
      }
      if (envelope.phase === 'restored') {
        return await cleanupAndRemove(envelope)
          ? { status: 'restored' }
          : { status: 'recovery_required' }
      }
      if (envelope.phase === 'committed') {
        await dependencies.postCommit(envelope)
        return await cleanupAndRemove(envelope)
          ? { status: 'committed' }
          : { status: 'recovery_required' }
      }
      return { status: 'recovery_required' }
    } catch {
      return { status: 'recovery_required' }
    }
  }

  return Object.freeze({
    recover(): Promise<InterruptedPortableImportRecoveryResult> {
      return dependencies.store.runExclusive(recoverLocked)
    },
    importPlan(
      plan: Plan,
      options: { signal?: AbortSignal } = {},
    ): Promise<PortableImportRecoveryExecutionResult> {
      return dependencies.store.runExclusive(async () => {
        const pending = await recoverLocked()
        if (pending.status === 'recovery_required') {
          return { status: 'recovery_required', cancellationObserved: false }
        }
        if (options.signal?.aborted) {
          return { status: 'rolled_back', cancellationObserved: true }
        }

        const sourceDigest = await dependencies.store.digest(dependencies.sourceText(plan))
        let envelope = createPortableImportRecoveryEnvelope({
          operationId: dependencies.createOperationId(),
          sourceDigest,
          participants: participantIds,
          now: dependencies.now(),
        })
        await dependencies.store.writeEnvelope(envelope, null)

        try {
          for (const participant of dependencies.participants) {
            throwIfCancelled(options.signal)
            const backupDigest = await participant.prepare(plan, envelope, options.signal)
            envelope = await persistTransition(
              envelope,
              markPortableImportParticipantPrepared(
                envelope,
                participant.id,
                backupDigest,
                dependencies.now(),
              ),
            )
          }
          envelope = await persistTransition(
            envelope,
            markPortableImportPrepared(envelope, dependencies.now()),
          )
          throwIfCancelled(options.signal)
        } catch (error) {
          const cancellationObserved = isCancellation(error, options.signal)
          try {
            envelope = await persistTransition(
              envelope,
              markPortableImportRestoredWithoutEffects(envelope, dependencies.now()),
            )
          } catch {
            return { status: 'recovery_required', cancellationObserved }
          }
          return await cleanupAndRemove(envelope)
            ? { status: 'rolled_back', cancellationObserved }
            : { status: 'recovery_required', cancellationObserved }
        }

        for (let index = 0; index < dependencies.participants.length; index += 1) {
          if (options.signal?.aborted) {
            if (index === 0) {
              envelope = await persistTransition(
                envelope,
                markPortableImportRestoredWithoutEffects(envelope, dependencies.now()),
              )
              return await cleanupAndRemove(envelope)
                ? { status: 'rolled_back', cancellationObserved: true }
                : { status: 'recovery_required', cancellationObserved: true }
            }
            envelope = await persistTransition(
              envelope,
              requirePortableImportRollback(envelope, index - 1, dependencies.now()),
            )
            return await rollback(envelope)
              ? { status: 'rolled_back', cancellationObserved: true }
              : { status: 'recovery_required', cancellationObserved: true }
          }

          envelope = await persistTransition(
            envelope,
            beginPortableImportParticipant(envelope, index, dependencies.now()),
          )
          try {
            await dependencies.participants[index].apply(envelope, options.signal)
            envelope = await persistTransition(
              envelope,
              completePortableImportParticipant(envelope, index, dependencies.now()),
            )
          } catch (error) {
            const cancellationObserved = isCancellation(error, options.signal)
            const currentEffectPossible = !(
              error instanceof PortableImportParticipantApplyError &&
              !error.effectPossible
            )
            const restoreIndex = currentEffectPossible ? index : index - 1
            if (restoreIndex < 0) {
              envelope = await persistTransition(
                envelope,
                markPortableImportRestoredWithoutEffects(envelope, dependencies.now()),
              )
              return await cleanupAndRemove(envelope)
                ? { status: 'rolled_back', cancellationObserved }
                : { status: 'recovery_required', cancellationObserved }
            }
            envelope = await persistTransition(
              envelope,
              requirePortableImportRollback(envelope, restoreIndex, dependencies.now()),
            )
            return await rollback(envelope)
              ? { status: 'rolled_back', cancellationObserved }
              : { status: 'recovery_required', cancellationObserved }
          }
        }

        envelope = await persistTransition(
          envelope,
          markPortableImportCommitted(envelope, dependencies.now()),
        )
        try {
          await dependencies.postCommit(envelope)
        } catch {
          return { status: 'recovery_required', cancellationObserved: Boolean(options.signal?.aborted) }
        }
        return await cleanupAndRemove(envelope)
          ? { status: 'committed', cancellationObserved: Boolean(options.signal?.aborted) }
          : { status: 'recovery_required', cancellationObserved: Boolean(options.signal?.aborted) }
      })
    },
  })
}

const recoveryStore = createAsyncStoragePortableImportRecoveryStore({
  blobStorage: createSqlitePortableImportRecoveryBlobStorage(
    createExpoSqliteDatabaseProvider(),
  ),
})
const productionParticipants = createProductionParticipants(recoveryStore)
const productionCoordinator = createPortableImportRecoveryCoordinator({
  store: recoveryStore,
  participants: productionParticipants,
  now: () => Date.now(),
  createOperationId: createPortableImportOperationId,
  sourceText: (plan: PortableApplicationImportPlan) => plan.portableSource,
  postCommit: async () => {
    await Promise.all([
      clearProviderHealthSnapshot(),
      clearAllCompactStates(),
      clearRuntimeLog(),
    ])
    clearCompactUsageRecords()
  },
})

export function importPortableApplicationDataWithRecovery(
  plan: PortableApplicationImportPlan,
  options: { signal?: AbortSignal } = {},
): Promise<PortableImportRecoveryExecutionResult> {
  return productionCoordinator.importPlan(plan, options)
}

export function recoverInterruptedPortableImport(): Promise<InterruptedPortableImportRecoveryResult> {
  return productionCoordinator.recover()
}

function createProductionParticipants(
  store: PortableImportRecoveryStore,
): readonly PortableImportRecoveryParticipant<PortableApplicationImportPlan>[] {
  return Object.freeze([
    createWorkspaceParticipant(store),
    createApplicationRecordParticipant(store),
    createConversationParticipant(store),
    createSecureStateParticipant(store),
    createKnowledgeParticipant(store),
  ])
}

function createWorkspaceParticipant(
  store: PortableImportRecoveryStore,
): PortableImportRecoveryParticipant<PortableApplicationImportPlan> {
  const id = PARTICIPANT_IDS[0]
  return {
    id,
    async prepare(plan, envelope, signal) {
      const backupId = await resolvePortableTavernWorkspaceBackupId({
        operationId: envelope.operationId,
        portableSource: plan.portableSource,
        signal,
      })
      const raw = JSON.stringify({
        schema: WORKSPACE_PLAN_SCHEMA,
        operationId: envelope.operationId,
        backupId,
        entries: plan.tavernEntries,
        activeScopeLinks: plan.tavernActiveScopeLinks,
        conversationIds: plan.conversationIds,
      })
      await store.createBlob(envelope.operationId, id, raw)
      return store.digest(raw)
    },
    async apply(envelope, signal) {
      const plan = parseWorkspacePlan(await readVerifiedBlob(store, envelope, id))
      const result = await importPortableTavernWorkspaceState({
        backupId: plan.backupId,
        entries: plan.entries,
        activeScopeLinks: plan.activeScopeLinks,
        conversationIds: plan.conversationIds,
        signal,
      })
      if (!result.ok) {
        const effect = result.error.details?.effect
        throw new PortableImportParticipantApplyError(effect !== 'none')
      }
    },
    async restore(envelope) {
      const plan = parseWorkspacePlan(await readVerifiedBlob(store, envelope, id))
      const result = await restorePortableTavernWorkspaceBackup(plan.backupId)
      if (!result.ok) throw new PortableImportParticipantApplyError(true)
    },
    async cleanup(envelope) {
      const raw = await store.readBlob(envelope.operationId, id)
      if (raw !== undefined) {
        const plan = parseWorkspacePlan(raw)
        await cleanupPortableTavernWorkspaceBackup(plan.backupId)
      }
      await store.removeBlob(envelope.operationId, id)
    },
  }
}

function createApplicationRecordParticipant(
  store: PortableImportRecoveryStore,
): PortableImportRecoveryParticipant<PortableApplicationImportPlan> {
  const id = PARTICIPANT_IDS[1]
  return {
    id,
    async prepare(plan, envelope, signal) {
      throwIfCancelled(signal)
      const targets = new Map<string, string | null>([
        [APPLICATION_RECORD_KEYS.settings, JSON.stringify(plan.settings)],
        [APPLICATION_RECORD_KEYS.providers, JSON.stringify(plan.providerMetadata)],
        [APPLICATION_RECORD_KEYS.skills, JSON.stringify(plan.skills)],
        [APPLICATION_RECORD_KEYS.mcpServers, JSON.stringify(plan.mcpServers)],
        [APPLICATION_RECORD_KEYS.languageSource, plan.languagePreferenceSource ?? null],
      ])
      const records: Array<ApplicationRecordBackup['records'][number]> = []
      for (const [key, target] of targets) {
        records.push({ key, source: await store.readRaw(key), target })
      }
      throwIfCancelled(signal)
      const raw = JSON.stringify({
        schema: APPLICATION_RECORD_BACKUP_SCHEMA,
        operationId: envelope.operationId,
        records,
      })
      await store.createBlob(envelope.operationId, id, raw)
      return store.digest(raw)
    },
    async apply(envelope) {
      const backup = parseApplicationRecordBackup(await readVerifiedBlob(store, envelope, id))
      await replaceRawRecords(store, backup.records, 'target')
    },
    async restore(envelope) {
      const backup = parseApplicationRecordBackup(await readVerifiedBlob(store, envelope, id))
      await replaceRawRecords(store, backup.records, 'source')
    },
    cleanup(envelope) {
      return store.removeBlob(envelope.operationId, id)
    },
  }
}

function createConversationParticipant(
  store: PortableImportRecoveryStore,
): PortableImportRecoveryParticipant<PortableApplicationImportPlan> {
  const id = PARTICIPANT_IDS[2]
  return {
    id,
    async prepare(plan, envelope, signal) {
      throwIfCancelled(signal)
      const source = await conversationPersistence.loadReplacementSnapshot()
      const target = canonicalConversationSnapshot(plan.conversations)
      throwIfCancelled(signal)
      const raw = JSON.stringify({
        schema: CONVERSATION_BACKUP_SCHEMA,
        operationId: envelope.operationId,
        source,
        target,
      })
      await store.createBlob(envelope.operationId, id, raw)
      return store.digest(raw)
    },
    async apply(envelope, signal) {
      const backup = parseConversationBackup(await readVerifiedBlob(store, envelope, id))
      await replaceConversations(backup, 'target', signal)
    },
    async restore(envelope) {
      const backup = parseConversationBackup(await readVerifiedBlob(store, envelope, id))
      await replaceConversations(backup, 'source')
    },
    cleanup(envelope) {
      return store.removeBlob(envelope.operationId, id)
    },
  }
}

function createKnowledgeParticipant(
  store: PortableImportRecoveryStore,
): PortableImportRecoveryParticipant<PortableApplicationImportPlan> {
  const id = PARTICIPANT_IDS[4]
  return {
    id,
    async prepare(plan, envelope, signal) {
      throwIfCancelled(signal)
      const source = canonicalKnowledgeSnapshot(
        await knowledgeRepository.loadSnapshot({ signal }),
      )
      const target = canonicalKnowledgeSnapshot(
        portableKnowledgeSnapshot.prepareImportSnapshot(plan.knowledge),
      )
      throwIfCancelled(signal)
      const raw = JSON.stringify({
        schema: KNOWLEDGE_BACKUP_SCHEMA,
        operationId: envelope.operationId,
        source,
        target,
      })
      await store.createBlob(envelope.operationId, id, raw)
      return store.digest(raw)
    },
    async apply(envelope, signal) {
      const backup = parseKnowledgeBackup(await readVerifiedBlob(store, envelope, id))
      await replaceKnowledge(backup, 'target', signal)
    },
    async restore(envelope) {
      const backup = parseKnowledgeBackup(await readVerifiedBlob(store, envelope, id))
      await replaceKnowledge(backup, 'source')
    },
    cleanup(envelope) {
      return store.removeBlob(envelope.operationId, id)
    },
  }
}

function createSecureStateParticipant(
  store: PortableImportRecoveryStore,
): PortableImportRecoveryParticipant<PortableApplicationImportPlan> {
  const id = PARTICIPANT_IDS[3]
  return {
    id,
    async prepare(plan, envelope, signal) {
      throwIfCancelled(signal)
      const sourceProviders = parseProviderInventory(
        await store.readRaw(APPLICATION_RECORD_KEYS.providers),
      )
      const descriptors = buildSecureDescriptors(sourceProviders, plan.credentialProviders)
      if (descriptors.length > MAX_SECURE_ITEMS) {
        throw new Error('The portable import secure-state inventory is oversized.')
      }
      const prepared: PreparedSecureItem[] = []
      for (let index = 0; index < descriptors.length; index += 1) {
        throwIfCancelled(signal)
        const descriptor = descriptors[index]
        const source = await readSecureDescriptor(descriptor)
        const target = descriptor.target
        const sourceRaw = encodeSecureSidecar(source)
        const targetRaw = encodeSecureSidecar(target)
        prepared.push({
          ...descriptor,
          sourceRef: secureSidecarKey(envelope.operationId, index, 'source'),
          targetRef: secureSidecarKey(envelope.operationId, index, 'target'),
          sourceDigest: await store.digest(sourceRaw),
          targetDigest: await store.digest(targetRaw),
          sourceRaw,
          targetRaw,
        })
      }
      if (
        isUnprotectedWebRuntime() &&
        prepared.some((item) => decodeSecureSidecar(item.sourceRaw) !== null || decodeSecureSidecar(item.targetRaw) !== null)
      ) {
        throw new Error('Credential-bearing portable imports require protected recovery storage.')
      }
      const manifest: SecureManifest = {
        schema: SECURE_MANIFEST_SCHEMA,
        operationId: envelope.operationId,
        items: prepared.map(({ sourceRaw: _sourceRaw, targetRaw: _targetRaw, target: _target, ...item }) => item),
      }
      const raw = JSON.stringify(manifest)
      await store.createBlob(envelope.operationId, id, raw)
      for (const item of prepared) {
        await createSecureSidecar(item.sourceRef, item.sourceRaw)
        await createSecureSidecar(item.targetRef, item.targetRaw)
      }
      return store.digest(raw)
    },
    async apply(envelope) {
      const manifest = parseSecureManifest(await readVerifiedBlob(store, envelope, id))
      await replaceSecureState(store, manifest, 'target')
    },
    async restore(envelope) {
      const manifest = parseSecureManifest(await readVerifiedBlob(store, envelope, id))
      await replaceSecureState(store, manifest, 'source')
    },
    async cleanup(envelope) {
      const raw = await store.readBlob(envelope.operationId, id)
      if (raw !== undefined) {
        const manifest = parseSecureManifest(raw)
        for (const item of manifest.items) {
          await removeSecureSidecar(item.sourceRef)
          await removeSecureSidecar(item.targetRef)
        }
      }
      await store.removeBlob(envelope.operationId, id)
    },
  }
}

interface ApplicationRecordBackup {
  readonly schema: typeof APPLICATION_RECORD_BACKUP_SCHEMA
  readonly operationId: string
  readonly records: readonly {
    readonly key: string
    readonly source: string | null
    readonly target: string | null
  }[]
}

interface ConversationBackup {
  readonly schema: typeof CONVERSATION_BACKUP_SCHEMA
  readonly operationId: string
  readonly source: readonly Conversation[]
  readonly target: readonly Conversation[]
}

interface KnowledgeBackup {
  readonly schema: typeof KNOWLEDGE_BACKUP_SCHEMA
  readonly operationId: string
  readonly source: KnowledgeRepositorySnapshot
  readonly target: KnowledgeRepositorySnapshot
}

interface WorkspacePlan {
  readonly schema: typeof WORKSPACE_PLAN_SCHEMA
  readonly operationId: string
  readonly backupId: string
  readonly entries: readonly {
    readonly scopeId?: string
    readonly snapshot: Partial<TavernSnapshot> | undefined
  }[]
  readonly activeScopeLinks: Record<string, string>
  readonly conversationIds: readonly string[]
}

type SecureDescriptor =
  | Readonly<{
      kind: 'provider'
      providerId: string
      target: string | null
    }>
  | Readonly<{
      kind: 'group'
      providerId: string
      groupId: string
      target: string | null
    }>
  | Readonly<{
      kind: 'secure_key'
      secureKey: string
      target: string | null
    }>

type SecureManifestItem = Omit<PreparedSecureItem, 'sourceRaw' | 'targetRaw' | 'target'>

interface PreparedSecureItem {
  readonly kind: SecureDescriptor['kind']
  readonly providerId?: string
  readonly groupId?: string
  readonly secureKey?: string
  readonly target: string | null
  readonly sourceRef: string
  readonly targetRef: string
  readonly sourceDigest: string
  readonly targetDigest: string
  readonly sourceRaw: string
  readonly targetRaw: string
}

interface SecureManifest {
  readonly schema: typeof SECURE_MANIFEST_SCHEMA
  readonly operationId: string
  readonly items: readonly SecureManifestItem[]
}

async function readVerifiedBlob(
  store: PortableImportRecoveryStore,
  envelope: PortableImportRecoveryEnvelopeV1,
  participantId: string,
): Promise<string> {
  const reference = envelope.preparedBackups.find(
    (backup) => backup.participantId === participantId,
  )
  if (!reference) throw new Error('The portable import participant backup is missing.')
  const raw = await store.readBlob(envelope.operationId, participantId)
  if (raw === undefined || await store.digest(raw) !== reference.digest) {
    throw new Error('The portable import participant backup does not match its envelope.')
  }
  return raw
}

async function replaceRawRecords(
  store: PortableImportRecoveryStore,
  records: ApplicationRecordBackup['records'],
  target: 'source' | 'target',
): Promise<void> {
  for (const record of records) {
    const current = await store.readRaw(record.key)
    if (current !== record.source && current !== record.target) {
      throw new Error('Portable import application record drift was detected.')
    }
  }
  for (const record of records) await store.writeRaw(record.key, record[target])
  for (const record of records) {
    if (await store.readRaw(record.key) !== record[target]) {
      throw new Error('Portable import application record verification failed.')
    }
  }
}

async function replaceConversations(
  backup: ConversationBackup,
  target: 'source' | 'target',
  signal?: AbortSignal,
): Promise<void> {
  throwIfCancelled(signal)
  const current = await conversationPersistence.loadReplacementSnapshot()
  assertSourceOrTarget(current, backup.source, backup.target, 'conversation')
  await conversationPersistence.replaceAll(backup[target])
  const persisted = await conversationPersistence.loadReplacementSnapshot()
  if (!sameJson(persisted, backup[target])) {
    throw new Error('Portable import conversation verification failed.')
  }
  throwIfCancelled(signal)
}

async function replaceKnowledge(
  backup: KnowledgeBackup,
  target: 'source' | 'target',
  signal?: AbortSignal,
): Promise<void> {
  throwIfCancelled(signal)
  const current = await knowledgeRepository.loadSnapshot({ signal })
  assertSourceOrTarget(current, backup.source, backup.target, 'knowledge')
  await replaceKnowledgeContextSnapshot(backup[target], { signal })
  const persisted = await knowledgeRepository.loadSnapshot({ signal })
  if (!sameJson(persisted, backup[target])) {
    throw new Error('Portable import knowledge verification failed.')
  }
  throwIfCancelled(signal)
}

function buildSecureDescriptors(
  sourceProviders: readonly ProviderInventory[],
  targetProviders: readonly AIProvider[],
): SecureDescriptor[] {
  const descriptors = new Map<string, SecureDescriptor>()
  for (const provider of sourceProviders) {
    descriptors.set(`provider:${provider.providerId}`, {
      kind: 'provider', providerId: provider.providerId, target: null,
    })
    for (const groupId of provider.groupIds) {
      descriptors.set(`group:${provider.providerId}:${groupId}`, {
        kind: 'group', providerId: provider.providerId, groupId, target: null,
      })
    }
  }
  for (const provider of targetProviders) {
    descriptors.set(`provider:${provider.id}`, {
      kind: 'provider',
      providerId: provider.id,
      target: normalizeCredential(provider.apiKey),
    })
    for (let index = 0; index < (provider.credentialGroups ?? []).length; index += 1) {
      const group = provider.credentialGroups![index]
      const groupId = group.id || `group-${index + 1}`
      descriptors.set(`group:${provider.id}:${groupId}`, {
        kind: 'group',
        providerId: provider.id,
        groupId,
        target: normalizeCredential(group.apiKey),
      })
    }
  }
  for (const secureKey of [...KNOWN_SEARCH_SECURE_KEYS, OBSERVABILITY_SINK_API_KEY]) {
    descriptors.set(`secure:${secureKey}`, { kind: 'secure_key', secureKey, target: null })
  }
  return [...descriptors.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, descriptor]) => descriptor)
}

async function replaceSecureState(
  store: PortableImportRecoveryStore,
  manifest: SecureManifest,
  target: 'source' | 'target',
): Promise<void> {
  const resolved: { item: SecureManifestItem; source: string | null; target: string | null }[] = []
  for (const item of manifest.items) {
    const source = await readSecureSidecar(store, item.sourceRef, item.sourceDigest)
    const targetValue = await readSecureSidecar(store, item.targetRef, item.targetDigest)
    const current = await readSecureManifestItem(item)
    if (current !== source && current !== targetValue) {
      throw new Error('Portable import secure-state drift was detected.')
    }
    resolved.push({ item, source, target: targetValue })
  }

  const providerMutations: ProviderCredentialMutation[] = []
  for (const entry of resolved) {
    const value = entry[target]
    if (entry.item.kind === 'provider' && entry.item.providerId) {
      providerMutations.push({ providerId: entry.item.providerId, credential: value })
    } else if (
      entry.item.kind === 'group' &&
      entry.item.providerId &&
      entry.item.groupId
    ) {
      providerMutations.push({
        providerId: entry.item.providerId,
        groupId: entry.item.groupId,
        credential: value,
      })
    }
  }
  await providerCredentialStorage.applyMutations(providerMutations)
  for (const entry of resolved) {
    if (entry.item.kind !== 'secure_key' || !entry.item.secureKey) continue
    const value = entry[target]
    if (value === null) await secureKeyValueStorage.removeItem(entry.item.secureKey)
    else await secureKeyValueStorage.setItem(entry.item.secureKey, value)
  }
  for (const entry of resolved) {
    if (await readSecureManifestItem(entry.item) !== entry[target]) {
      throw new Error('Portable import secure-state verification failed.')
    }
  }
}

async function readSecureDescriptor(descriptor: SecureDescriptor): Promise<string | null> {
  if (descriptor.kind === 'provider') {
    return providerCredentialStorage.getProviderCredential(descriptor.providerId)
  }
  if (descriptor.kind === 'group') {
    return providerCredentialStorage.getCredentialGroupCredential(
      descriptor.providerId,
      descriptor.groupId,
    )
  }
  return secureKeyValueStorage.getItem(descriptor.secureKey)
}

async function readSecureManifestItem(item: SecureManifestItem): Promise<string | null> {
  if (item.kind === 'provider' && item.providerId) {
    return providerCredentialStorage.getProviderCredential(item.providerId)
  }
  if (item.kind === 'group' && item.providerId && item.groupId) {
    return providerCredentialStorage.getCredentialGroupCredential(item.providerId, item.groupId)
  }
  if (item.kind === 'secure_key' && item.secureKey) {
    return secureKeyValueStorage.getItem(item.secureKey)
  }
  throw new Error('The portable import secure-state identity is invalid.')
}

async function createSecureSidecar(key: string, value: string): Promise<void> {
  const existing = await secureKeyValueStorage.getItem(key)
  if (existing === value) return
  if (existing !== null) throw new Error('A portable import secure sidecar already exists.')
  await secureKeyValueStorage.setItem(key, value)
}

async function removeSecureSidecar(key: string): Promise<void> {
  if (await secureKeyValueStorage.getItem(key) === null) return
  await secureKeyValueStorage.removeItem(key)
}

async function readSecureSidecar(
  store: PortableImportRecoveryStore,
  key: string,
  expectedDigest: string,
): Promise<string | null> {
  const raw = await secureKeyValueStorage.getItem(key)
  if (raw === null || await store.digest(raw) !== expectedDigest) {
    throw new Error('A portable import secure sidecar is missing or invalid.')
  }
  return decodeSecureSidecar(raw)
}

function encodeSecureSidecar(value: string | null): string {
  return value === null ? SECURE_SIDECAR_NULL : `${SECURE_SIDECAR_VALUE_PREFIX}${value}`
}

function decodeSecureSidecar(value: string): string | null {
  if (value === SECURE_SIDECAR_NULL) return null
  if (value.startsWith(SECURE_SIDECAR_VALUE_PREFIX)) {
    return value.slice(SECURE_SIDECAR_VALUE_PREFIX.length)
  }
  throw new Error('The portable import secure sidecar is invalid.')
}

function secureSidecarKey(
  operationId: string,
  index: number,
  side: 'source' | 'target',
): string {
  return `${SECURE_SIDECAR_KEY_PREFIX}${operationId}.${index}.${side}`
}

interface ProviderInventory {
  readonly providerId: string
  readonly groupIds: readonly string[]
}

function parseProviderInventory(raw: string | null): ProviderInventory[] {
  if (raw === null) return []
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('The current provider metadata is invalid.')
  }
  if (!Array.isArray(value)) throw new Error('The current provider metadata is invalid.')
  return value.map((provider) => {
    if (!isRecord(provider) || typeof provider.id !== 'string' || !provider.id) {
      throw new Error('The current provider metadata is invalid.')
    }
    const groups = provider.credentialGroups
    if (groups !== undefined && !Array.isArray(groups)) {
      throw new Error('The current provider metadata is invalid.')
    }
    const groupIds = (groups ?? []).map((group) => {
      if (!isRecord(group) || typeof group.id !== 'string' || !group.id) {
        throw new Error('The current provider metadata is invalid.')
      }
      return group.id
    })
    return { providerId: provider.id, groupIds }
  })
}

function parseApplicationRecordBackup(raw: string): ApplicationRecordBackup {
  const value = parseJsonRecord(raw)
  if (
    value.schema !== APPLICATION_RECORD_BACKUP_SCHEMA ||
    typeof value.operationId !== 'string' ||
    !Array.isArray(value.records) ||
    value.records.length !== Object.keys(APPLICATION_RECORD_KEYS).length
  ) {
    throw new Error('The portable import application-record backup is invalid.')
  }
  const records = value.records.map((record) => {
    if (
      !isRecord(record) ||
      typeof record.key !== 'string' ||
      !isNullableString(record.source) ||
      !isNullableString(record.target)
    ) {
      throw new Error('The portable import application-record backup is invalid.')
    }
    return { key: record.key, source: record.source, target: record.target }
  })
  const allowed = new Set(Object.values(APPLICATION_RECORD_KEYS))
  if (new Set(records.map((record) => record.key)).size !== records.length || records.some((record) => !allowed.has(record.key as never))) {
    throw new Error('The portable import application-record backup is invalid.')
  }
  return { schema: APPLICATION_RECORD_BACKUP_SCHEMA, operationId: value.operationId, records }
}

function parseConversationBackup(raw: string): ConversationBackup {
  const value = parseJsonRecord(raw)
  if (
    value.schema !== CONVERSATION_BACKUP_SCHEMA ||
    typeof value.operationId !== 'string' ||
    !Array.isArray(value.source) ||
    !Array.isArray(value.target)
  ) {
    throw new Error('The portable import conversation backup is invalid.')
  }
  return value as unknown as ConversationBackup
}

function parseKnowledgeBackup(raw: string): KnowledgeBackup {
  const value = parseJsonRecord(raw)
  if (
    value.schema !== KNOWLEDGE_BACKUP_SCHEMA ||
    typeof value.operationId !== 'string' ||
    !isKnowledgeSnapshot(value.source) ||
    !isKnowledgeSnapshot(value.target)
  ) {
    throw new Error('The portable import knowledge backup is invalid.')
  }
  return value as unknown as KnowledgeBackup
}

function parseWorkspacePlan(raw: string): WorkspacePlan {
  const value = parseJsonRecord(raw)
  if (
    value.schema !== WORKSPACE_PLAN_SCHEMA ||
    typeof value.operationId !== 'string' ||
    typeof value.backupId !== 'string' ||
    !Array.isArray(value.entries) ||
    !isRecord(value.activeScopeLinks) ||
    !Array.isArray(value.conversationIds) ||
    !value.conversationIds.every((id) => typeof id === 'string')
  ) {
    throw new Error('The portable import workspace plan is invalid.')
  }
  return value as unknown as WorkspacePlan
}

function parseSecureManifest(raw: string): SecureManifest {
  const value = parseJsonRecord(raw)
  if (
    value.schema !== SECURE_MANIFEST_SCHEMA ||
    typeof value.operationId !== 'string' ||
    !Array.isArray(value.items) ||
    value.items.length > MAX_SECURE_ITEMS
  ) {
    throw new Error('The portable import secure-state manifest is invalid.')
  }
  for (const item of value.items) {
    if (
      !isRecord(item) ||
      (item.kind !== 'provider' && item.kind !== 'group' && item.kind !== 'secure_key') ||
      typeof item.sourceRef !== 'string' ||
      typeof item.targetRef !== 'string' ||
      typeof item.sourceDigest !== 'string' ||
      typeof item.targetDigest !== 'string' ||
      !/^sha256:[0-9a-f]{64}$/.test(item.sourceDigest) ||
      !/^sha256:[0-9a-f]{64}$/.test(item.targetDigest) ||
      (item.kind === 'provider' && typeof item.providerId !== 'string') ||
      (item.kind === 'group' && (typeof item.providerId !== 'string' || typeof item.groupId !== 'string')) ||
      (item.kind === 'secure_key' && typeof item.secureKey !== 'string')
    ) {
      throw new Error('The portable import secure-state manifest is invalid.')
    }
  }
  return value as unknown as SecureManifest
}

function parseJsonRecord(raw: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('The portable import recovery backup is invalid.')
  }
  if (!isRecord(value)) throw new Error('The portable import recovery backup is invalid.')
  return value
}

function isKnowledgeSnapshot(value: unknown): boolean {
  return isRecord(value) &&
    Array.isArray(value.memories) &&
    Array.isArray(value.documents) &&
    Array.isArray(value.chunks)
}

function assertSourceOrTarget(
  current: unknown,
  source: unknown,
  target: unknown,
  label: string,
): void {
  if (!sameJson(current, source) && !sameJson(current, target)) {
    throw new Error(`Portable import ${label} drift was detected.`)
  }
}

function canonicalConversationSnapshot(
  conversations: readonly Conversation[],
): readonly Conversation[] {
  return [...conversations].sort((left, right) =>
    right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
}

function canonicalKnowledgeSnapshot(
  snapshot: KnowledgeRepositorySnapshot,
): KnowledgeRepositorySnapshot {
  return {
    memories: [...snapshot.memories].sort((left, right) =>
      (right.updatedAt ?? 0) - (left.updatedAt ?? 0) ||
      (left.id ?? '').localeCompare(right.id ?? '')),
    documents: [...snapshot.documents].sort((left, right) =>
      right.updatedAt - left.updatedAt || left.id.localeCompare(right.id)),
    chunks: [...snapshot.chunks].sort((left, right) =>
      left.documentId.localeCompare(right.documentId) ||
      left.ordinal - right.ordinal ||
      left.id.localeCompare(right.id)),
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right)
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value))
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortJson(value[key])]),
  )
}

function normalizeCredential(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  const error = new Error('The portable import was cancelled.')
  error.name = 'AbortError'
  throw error
}

function isCancellation(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) ||
    (error instanceof Error && error.name === 'AbortError')
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isUnprotectedWebRuntime(): boolean {
  const environment = globalThis as {
    document?: unknown
    navigator?: { product?: string }
  }
  return environment.document !== undefined &&
    environment.navigator?.product !== 'ReactNative'
}

function createPortableImportOperationId(): string {
  const randomUuid = (globalThis as {
    crypto?: { randomUUID?: () => string }
  }).crypto?.randomUUID
  if (typeof randomUuid === 'function') return randomUuid.call(globalThis.crypto)
  portableImportOperationSequence += 1
  return `pi-${Date.now().toString(36)}-${portableImportOperationSequence.toString(36)}-${Math.random().toString(36).slice(2, 14)}`
}
