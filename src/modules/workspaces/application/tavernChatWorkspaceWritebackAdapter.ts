import type { AssistantRunId } from '@/core'
import {
  CHAT_WORKSPACE_WRITEBACK_FINAL_OUTPUT_MAX_CHARACTERS,
  CHAT_WORKSPACE_WRITEBACK_IDEMPOTENCY_KEY_MAX_CHARACTERS,
  CHAT_WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS,
  CHAT_WORKSPACE_WRITEBACK_REASON_MAX_CHARACTERS,
  CHAT_WORKSPACE_WRITEBACK_RECEIPT_SCHEMA,
  type ChatWorkspaceWritebackIntent,
  type ChatWorkspaceWritebackPort,
  type ChatWorkspaceWritebackPortReceipt,
} from './chatWorkspaceWritebackRuntime'
import { normalizeTavernWorkspaceScopeId } from './tavernWorkspaceRepository'
import type {
  TavernSnapshot,
} from '../domain/tavernContracts'
import {
  applyTavernTurnWritebackProposal,
  buildTavernTurnWritebackProposal,
} from '../domain/tavernWritebackPolicy'

export const TAVERN_CHAT_WORKSPACE_WRITEBACK_CHANGE_SET_SCHEMA =
  'islemind.tavern-chat-workspace-writeback-change-set.v1' as const

const MAX_SELECTED_CHARACTER_COUNT = 64
const CHANGE_SET_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/

export interface TavernChatWorkspaceWritebackPolicyOptions {
  readonly commitSummary: true
  readonly commitCharacterDraft: false
  readonly commitLorebookDraft: false
  readonly commitRelationshipMemoryCandidateIds: readonly string[]
  readonly commitSceneChange: false
  readonly storePendingProposals: true
}

/**
 * One resolver-owned, point-in-time Tavern writeback decision. The digest must
 * cover every field, including the exact user input and final model output.
 */
export interface TavernChatWorkspaceWritebackChangeSet {
  readonly schema: typeof TAVERN_CHAT_WORKSPACE_WRITEBACK_CHANGE_SET_SCHEMA
  readonly assistantRunId: AssistantRunId
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly workspaceId: string
  readonly activeScopeId: string
  readonly repositoryAuthorityRevision: number
  readonly idempotencyKey: string
  readonly latestUserInput: string
  readonly finalOutput: string
  readonly selectedSceneId?: string
  readonly orderedCharacterIds: readonly string[]
  readonly applicationOptions: TavernChatWorkspaceWritebackPolicyOptions
  readonly occurredAt: number
  readonly digest: string
}

export type TavernChatWorkspaceWritebackResolution =
  | {
      readonly status: 'ready'
      readonly changeSet: TavernChatWorkspaceWritebackChangeSet
    }
  | {
      readonly status: 'failed'
      readonly reason?: string
    }

export interface TavernChatWorkspaceWritebackChangeSetResolver {
  /** Resolves messages, active scope, selection, and authority from one coherent read. */
  resolve(
    intent: ChatWorkspaceWritebackIntent,
    options: { readonly signal: AbortSignal },
  ): Promise<TavernChatWorkspaceWritebackResolution>
}

export type TavernChatWorkspaceWritebackMutationResult<Snapshot> =
  | {
      readonly status: 'applied'
      readonly snapshot: Snapshot
    }
  | {
      readonly status: 'no_changes'
    }

export type TavernChatWorkspaceWritebackAtomicStoreResult =
  | {
      readonly status: 'applied' | 'replayed' | 'no_changes'
      readonly authorityRevision: number
    }
  | {
      readonly status: 'conflict'
      readonly actualAuthorityRevision: number
    }
  | {
      readonly status: 'cancelled'
    }
  | {
      readonly status: 'failed'
      readonly reason?: string
    }

export interface TavernChatWorkspaceWritebackAtomicStore<Snapshot> {
  writebackAtomic(
    changeSet: TavernChatWorkspaceWritebackChangeSet,
    mutate: (
      snapshot: Snapshot,
      changeSet: TavernChatWorkspaceWritebackChangeSet,
    ) => TavernChatWorkspaceWritebackMutationResult<Snapshot>,
    options: { readonly signal: AbortSignal },
  ): Promise<TavernChatWorkspaceWritebackAtomicStoreResult>
}

export interface TavernChatWorkspaceWritebackDigestProvider {
  digestCanonicalPayload(
    canonicalPayload: string,
    options: { readonly signal: AbortSignal },
  ): Promise<string>
}

export interface TavernChatWorkspaceWritebackAdapterDependencies {
  readonly resolver: TavernChatWorkspaceWritebackChangeSetResolver
  readonly store: TavernChatWorkspaceWritebackAtomicStore<TavernSnapshot>
  readonly digestProvider: TavernChatWorkspaceWritebackDigestProvider
}

/** Bridges generic Chat writeback to the current Tavern snapshot policy. */
export function createTavernChatWorkspaceWritebackAdapter(
  dependencies: TavernChatWorkspaceWritebackAdapterDependencies,
): ChatWorkspaceWritebackPort {
  if (typeof dependencies.digestProvider?.digestCanonicalPayload !== 'function') {
    throw new TypeError('The Tavern Chat workspace writeback digest provider is invalid.')
  }

  return {
    async writeback(intent, options) {
      const identity = receiptIdentity(intent)
      if (options.signal.aborted) return { ...identity, status: 'cancelled' }
      if (!isValidIntent(intent)) {
        return { ...identity, status: 'failed', reason: 'The Chat workspace writeback intent is invalid.' }
      }

      let resolution: unknown
      try {
        resolution = await dependencies.resolver.resolve(intent, options)
      } catch {
        return options.signal.aborted
          ? { ...identity, status: 'cancelled' }
          : { ...identity, status: 'failed', reason: 'The Tavern writeback change set could not be resolved.' }
      }
      if (options.signal.aborted) return { ...identity, status: 'cancelled' }

      const resolved = parseResolution(resolution, intent)
      if (!resolved) {
        return { ...identity, status: 'failed', reason: 'The Tavern writeback resolver returned an invalid result.' }
      }
      if (resolved.status === 'failed') {
        return { ...identity, status: 'failed', ...(resolved.reason ? { reason: resolved.reason } : {}) }
      }
      if (options.signal.aborted) return { ...identity, status: 'cancelled' }

      let actualDigest: unknown
      try {
        actualDigest = await dependencies.digestProvider.digestCanonicalPayload(
          canonicalizeTavernChatWorkspaceWritebackChangeSet(resolved.changeSet),
          options,
        )
      } catch {
        return options.signal.aborted
          ? { ...identity, status: 'cancelled' }
          : { ...identity, status: 'failed', reason: 'The Tavern writeback change-set digest could not be verified.' }
      }
      if (options.signal.aborted) return { ...identity, status: 'cancelled' }
      if (actualDigest !== resolved.changeSet.digest) {
        return { ...identity, status: 'failed', reason: 'The Tavern writeback change-set digest is invalid.' }
      }

      let result: unknown
      try {
        result = await dependencies.store.writebackAtomic(
          resolved.changeSet,
          applyChangeSet,
          options,
        )
      } catch {
        return options.signal.aborted
          ? { ...identity, status: 'cancelled' }
          : { ...identity, status: 'failed', reason: 'The Tavern workspace writeback store failed.' }
      }

      // Do not inspect cancellation here. A committed atomic receipt is the
      // authority, and callers can reconcile it by the same idempotency key.
      return storeResultToReceipt(result, intent)
        ?? { ...identity, status: 'failed', reason: 'The Tavern workspace writeback store returned an invalid result.' }
    },
  }
}

export function canonicalizeTavernChatWorkspaceWritebackChangeSet(
  changeSet: TavernChatWorkspaceWritebackChangeSet,
): string {
  return JSON.stringify([
    changeSet.schema,
    changeSet.assistantRunId,
    changeSet.conversationId,
    changeSet.assistantMessageId,
    changeSet.workspaceId,
    changeSet.activeScopeId,
    changeSet.repositoryAuthorityRevision,
    changeSet.idempotencyKey,
    changeSet.latestUserInput,
    changeSet.finalOutput,
    changeSet.selectedSceneId ?? null,
    [...changeSet.orderedCharacterIds],
    [
      changeSet.applicationOptions.commitSummary,
      changeSet.applicationOptions.commitCharacterDraft,
      changeSet.applicationOptions.commitLorebookDraft,
      [...changeSet.applicationOptions.commitRelationshipMemoryCandidateIds],
      changeSet.applicationOptions.commitSceneChange,
      changeSet.applicationOptions.storePendingProposals,
    ],
    changeSet.occurredAt,
  ])
}

function applyChangeSet(
  snapshot: TavernSnapshot,
  changeSet: TavernChatWorkspaceWritebackChangeSet,
): TavernChatWorkspaceWritebackMutationResult<TavernSnapshot> {
  assertSelectedWorkspaceState(snapshot, changeSet)
  const proposal = buildTavernTurnWritebackProposal(snapshot, {
    userInput: changeSet.latestUserInput,
    assistantOutput: changeSet.finalOutput,
    assistantMessageId: changeSet.assistantMessageId,
    sceneId: changeSet.selectedSceneId,
    characterIds: [...changeSet.orderedCharacterIds],
  }, changeSet.occurredAt)
  const application = applyTavernTurnWritebackProposal(
    snapshot,
    proposal,
    {
      commitSummary: changeSet.applicationOptions.commitSummary,
      commitCharacterDraft: changeSet.applicationOptions.commitCharacterDraft,
      commitLorebookDraft: changeSet.applicationOptions.commitLorebookDraft,
      commitRelationshipMemoryCandidateIds: [
        ...changeSet.applicationOptions.commitRelationshipMemoryCandidateIds,
      ],
      commitSceneChange: changeSet.applicationOptions.commitSceneChange,
      storePendingProposals: changeSet.applicationOptions.storePendingProposals,
    },
    changeSet.occurredAt,
  )
  return application.committedSummary || application.pendingWritebackStored
    ? { status: 'applied', snapshot: application.snapshot }
    : { status: 'no_changes' }
}

function assertSelectedWorkspaceState(
  snapshot: TavernSnapshot,
  changeSet: TavernChatWorkspaceWritebackChangeSet,
): void {
  if (changeSet.selectedSceneId && !snapshot.scenes.some((scene) => scene.id === changeSet.selectedSceneId)) {
    throw new TypeError('The resolved Tavern scene is not present in the authoritative snapshot.')
  }
  const characterIds = new Set(snapshot.characters.map((character) => character.id))
  if (changeSet.orderedCharacterIds.some((characterId) => !characterIds.has(characterId))) {
    throw new TypeError('A resolved Tavern character is not present in the authoritative snapshot.')
  }
}

function parseResolution(
  candidate: unknown,
  intent: ChatWorkspaceWritebackIntent,
): TavernChatWorkspaceWritebackResolution | undefined {
  try {
    if (!isRecord(candidate)) return undefined
    if (candidate.status === 'failed') {
      const reason = parseReason(candidate.reason)
      if (candidate.reason !== undefined && reason === undefined) return undefined
      return Object.freeze({
        status: 'failed',
        ...(reason ? { reason } : {}),
      })
    }
    if (candidate.status !== 'ready') return undefined
    const changeSet = parseChangeSet(candidate.changeSet, intent)
    return changeSet ? Object.freeze({ status: 'ready', changeSet }) : undefined
  } catch {
    return undefined
  }
}

function parseChangeSet(
  candidate: unknown,
  intent: ChatWorkspaceWritebackIntent,
): TavernChatWorkspaceWritebackChangeSet | undefined {
  if (!isRecord(candidate) || !isRecord(candidate.applicationOptions)) return undefined
  const activeScopeId = normalizeTavernWorkspaceScopeId(candidate.activeScopeId)
  const selectedSceneId = candidate.selectedSceneId === undefined
    ? undefined
    : parseIdentity(candidate.selectedSceneId)
  const orderedCharacterIds = parseOrderedCharacterIds(candidate.orderedCharacterIds)
  const applicationOptions = parseApplicationOptions(candidate.applicationOptions)
  if (
    candidate.schema !== TAVERN_CHAT_WORKSPACE_WRITEBACK_CHANGE_SET_SCHEMA
    || candidate.assistantRunId !== intent.assistantRunId
    || candidate.conversationId !== intent.conversationId
    || candidate.assistantMessageId !== intent.assistantMessageId
    || candidate.workspaceId !== intent.workspaceId
    || candidate.repositoryAuthorityRevision !== intent.expectedAuthorityRevision
    || candidate.idempotencyKey !== intent.idempotencyKey
    || candidate.finalOutput !== intent.finalOutput
    || activeScopeId === undefined
    || activeScopeId !== candidate.activeScopeId
    || activeScopeId !== intent.workspaceId
    || (candidate.selectedSceneId !== undefined && selectedSceneId === undefined)
    || orderedCharacterIds === undefined
    || applicationOptions === undefined
    || typeof candidate.latestUserInput !== 'string'
    || candidate.latestUserInput.length > CHAT_WORKSPACE_WRITEBACK_FINAL_OUTPUT_MAX_CHARACTERS
    || !isNonNegativeSafeInteger(candidate.occurredAt)
    || typeof candidate.digest !== 'string'
    || !CHANGE_SET_DIGEST_PATTERN.test(candidate.digest)
  ) {
    return undefined
  }
  return Object.freeze({
    schema: TAVERN_CHAT_WORKSPACE_WRITEBACK_CHANGE_SET_SCHEMA,
    assistantRunId: intent.assistantRunId,
    conversationId: intent.conversationId,
    assistantMessageId: intent.assistantMessageId,
    workspaceId: intent.workspaceId,
    activeScopeId,
    repositoryAuthorityRevision: intent.expectedAuthorityRevision,
    idempotencyKey: intent.idempotencyKey,
    latestUserInput: candidate.latestUserInput,
    finalOutput: intent.finalOutput,
    ...(selectedSceneId ? { selectedSceneId } : {}),
    orderedCharacterIds,
    applicationOptions,
    occurredAt: candidate.occurredAt,
    digest: candidate.digest,
  })
}

function parseOrderedCharacterIds(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_SELECTED_CHARACTER_COUNT) return undefined
  const result: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const characterId = parseIdentity(item)
    if (!characterId || seen.has(characterId)) return undefined
    seen.add(characterId)
    result.push(characterId)
  }
  return Object.freeze(result)
}

function parseApplicationOptions(value: Readonly<Record<string, unknown>>): TavernChatWorkspaceWritebackPolicyOptions | undefined {
  if (
    value.commitSummary !== true
    || value.commitCharacterDraft !== false
    || value.commitLorebookDraft !== false
    || !Array.isArray(value.commitRelationshipMemoryCandidateIds)
    || value.commitRelationshipMemoryCandidateIds.length !== 0
    || value.commitSceneChange !== false
    || value.storePendingProposals !== true
  ) {
    return undefined
  }
  return Object.freeze({
    commitSummary: true,
    commitCharacterDraft: false,
    commitLorebookDraft: false,
    commitRelationshipMemoryCandidateIds: Object.freeze([]),
    commitSceneChange: false,
    storePendingProposals: true,
  })
}

function storeResultToReceipt(
  candidate: unknown,
  intent: ChatWorkspaceWritebackIntent,
): ChatWorkspaceWritebackPortReceipt | undefined {
  if (!isRecord(candidate)) return undefined
  const identity = receiptIdentity(intent)
  switch (candidate.status) {
    case 'applied':
    case 'replayed':
      return isNonNegativeSafeInteger(candidate.authorityRevision)
        && candidate.authorityRevision > intent.expectedAuthorityRevision
        ? { ...identity, status: candidate.status, authorityRevision: candidate.authorityRevision }
        : undefined
    case 'no_changes':
      return candidate.authorityRevision === intent.expectedAuthorityRevision
        ? { ...identity, status: candidate.status, authorityRevision: candidate.authorityRevision }
        : undefined
    case 'conflict':
      return isNonNegativeSafeInteger(candidate.actualAuthorityRevision)
        && candidate.actualAuthorityRevision !== intent.expectedAuthorityRevision
        ? { ...identity, status: candidate.status, actualAuthorityRevision: candidate.actualAuthorityRevision }
        : undefined
    case 'cancelled':
      return { ...identity, status: candidate.status }
    case 'failed': {
      const reason = parseReason(candidate.reason)
      return candidate.reason === undefined || reason !== undefined
        ? { ...identity, status: candidate.status, ...(reason ? { reason } : {}) }
        : undefined
    }
    default:
      return undefined
  }
}

function receiptIdentity(intent: ChatWorkspaceWritebackIntent) {
  return {
    schema: CHAT_WORKSPACE_WRITEBACK_RECEIPT_SCHEMA,
    assistantRunId: intent.assistantRunId,
    conversationId: intent.conversationId,
    assistantMessageId: intent.assistantMessageId,
    workspaceId: intent.workspaceId,
    expectedAuthorityRevision: intent.expectedAuthorityRevision,
    idempotencyKey: intent.idempotencyKey,
  } as const
}

function isValidIntent(intent: ChatWorkspaceWritebackIntent): boolean {
  return parseIdentity(intent.assistantRunId) !== undefined
    && parseIdentity(intent.conversationId) !== undefined
    && parseIdentity(intent.assistantMessageId) !== undefined
    && parseIdentity(intent.workspaceId) !== undefined
    && isNonNegativeSafeInteger(intent.expectedAuthorityRevision)
    && typeof intent.idempotencyKey === 'string'
    && intent.idempotencyKey.length <= CHAT_WORKSPACE_WRITEBACK_IDEMPOTENCY_KEY_MAX_CHARACTERS
    && intent.idempotencyKey.trim().length > 0
    && typeof intent.finalOutput === 'string'
    && intent.finalOutput.length <= CHAT_WORKSPACE_WRITEBACK_FINAL_OUTPUT_MAX_CHARACTERS
}

function parseIdentity(value: unknown): string | undefined {
  return typeof value === 'string'
    && value.length <= CHAT_WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS
    && value.trim().length > 0
    ? value
    : undefined
}

function parseReason(value: unknown): string | undefined {
  return value === undefined
    ? undefined
    : typeof value === 'string'
      && value.length <= CHAT_WORKSPACE_WRITEBACK_REASON_MAX_CHARACTERS
      && value.trim().length > 0
      ? value
      : undefined
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
