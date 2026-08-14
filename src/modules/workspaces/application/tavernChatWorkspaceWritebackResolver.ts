import type { AssistantRunId } from '@/core'
import {
  CHAT_WORKSPACE_WRITEBACK_FINAL_OUTPUT_MAX_CHARACTERS,
  CHAT_WORKSPACE_WRITEBACK_IDEMPOTENCY_KEY_MAX_CHARACTERS,
  CHAT_WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS,
  type ChatWorkspaceWritebackIntent,
} from './chatWorkspaceWritebackRuntime'
import {
  TAVERN_CHAT_WORKSPACE_WRITEBACK_CHANGE_SET_SCHEMA,
  canonicalizeTavernChatWorkspaceWritebackChangeSet,
  type TavernChatWorkspaceWritebackChangeSet,
  type TavernChatWorkspaceWritebackChangeSetResolver,
  type TavernChatWorkspaceWritebackDigestProvider,
  type TavernChatWorkspaceWritebackPolicyOptions,
  type TavernChatWorkspaceWritebackResolution,
} from './tavernChatWorkspaceWritebackAdapter'
import { normalizeTavernWorkspaceScopeId } from './tavernWorkspaceRepository'

export const TAVERN_CHAT_WORKSPACE_WRITEBACK_HANDOFF_SCHEMA =
  'islemind.assistant-conversation-workspace-writeback-handoff.v1' as const
export const TAVERN_CHAT_WORKSPACE_WRITEBACK_POLICY_SCHEMA =
  'islemind.assistant-conversation-workspace-writeback-policy.v1' as const

const MAX_SELECTED_CHARACTER_COUNT = 64
const INPUT_MAX_CHARACTERS = 262_144
const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/
const IDEMPOTENCY_KEY_PATTERN =
  /^islemind\.chat-workspace-writeback\.v1:sha256:[0-9a-f]{64}$/
const EMPTY_CHANGE_SET_DIGEST = `sha256:${'0'.repeat(64)}`

const INVALID_HANDOFF_REASON = 'The Tavern Chat workspace writeback handoff is invalid.'
const INTENT_MISMATCH_REASON = 'The Tavern Chat workspace writeback intent does not match its captured handoff.'
const DIGEST_FAILURE_REASON = 'The Tavern Chat workspace writeback change-set digest could not be created.'
const INVALID_DIGEST_REASON = 'The Tavern Chat workspace writeback change-set digest is invalid.'

export interface TavernChatWorkspaceWritebackHandoffPolicy {
  readonly schema: typeof TAVERN_CHAT_WORKSPACE_WRITEBACK_POLICY_SCHEMA
  readonly summary: 'commit'
  readonly characterUpdates: 'review'
  readonly lorebookUpdates: 'review'
  readonly relationshipMemoryUpdates: 'review'
  readonly sceneUpdates: 'review'
}

/** Structural copy of the pre-execution handoff; Workspaces does not import Assistant Runtime. */
export interface TavernChatWorkspaceWritebackHandoff {
  readonly schema: typeof TAVERN_CHAT_WORKSPACE_WRITEBACK_HANDOFF_SCHEMA
  readonly assistantRunId: AssistantRunId
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly workspaceId: string
  readonly repositoryAuthorityRevision: number
  readonly latestUserInput: string
  readonly selectedSceneId?: string
  readonly orderedCharacterIds: readonly string[]
  readonly policy: TavernChatWorkspaceWritebackHandoffPolicy
  readonly occurredAt: number
  readonly idempotencyKey: string
}

export interface TavernChatWorkspaceWritebackChangeSetResolverDependencies {
  readonly handoff: TavernChatWorkspaceWritebackHandoff
  readonly digestProvider: TavernChatWorkspaceWritebackDigestProvider
}

const APPLICATION_OPTIONS: TavernChatWorkspaceWritebackPolicyOptions = deepFreeze({
  commitSummary: true,
  commitCharacterDraft: false,
  commitLorebookDraft: false,
  commitRelationshipMemoryCandidateIds: [],
  commitSceneChange: false,
  storePendingProposals: true,
})

export function createTavernChatWorkspaceWritebackChangeSetResolver(
  dependencies: TavernChatWorkspaceWritebackChangeSetResolverDependencies,
): TavernChatWorkspaceWritebackChangeSetResolver {
  if (typeof dependencies?.digestProvider?.digestCanonicalPayload !== 'function') {
    throw new TypeError('The Tavern Chat workspace writeback digest provider is invalid.')
  }

  const handoff = parseHandoff(dependencies.handoff)
  const resolver: TavernChatWorkspaceWritebackChangeSetResolver = {
    async resolve(intent, options) {
      throwIfCancelled(options.signal)
      if (!handoff) return failed(INVALID_HANDOFF_REASON)
      if (!isMatchingIntent(intent, handoff)) return failed(INTENT_MISMATCH_REASON)

      const unsignedChangeSet = createChangeSet(
        handoff,
        intent.finalOutput,
        EMPTY_CHANGE_SET_DIGEST,
      )
      const canonicalPayload = canonicalizeTavernChatWorkspaceWritebackChangeSet(
        unsignedChangeSet,
      )
      throwIfCancelled(options.signal)

      let digest: unknown
      try {
        digest = await dependencies.digestProvider.digestCanonicalPayload(
          canonicalPayload,
          options,
        )
      } catch {
        throwIfCancelled(options.signal)
        return failed(DIGEST_FAILURE_REASON)
      }
      throwIfCancelled(options.signal)
      if (typeof digest !== 'string' || !SHA256_DIGEST_PATTERN.test(digest)) {
        return failed(INVALID_DIGEST_REASON)
      }

      return deepFreeze({
        status: 'ready',
        changeSet: createChangeSet(handoff, intent.finalOutput, digest),
      })
    },
  }
  return Object.freeze(resolver)
}

function parseHandoff(candidate: unknown): TavernChatWorkspaceWritebackHandoff | undefined {
  try {
    if (
      !isRecord(candidate)
      || !hasExactKeys(candidate, [
        'schema',
        'assistantRunId',
        'conversationId',
        'assistantMessageId',
        'workspaceId',
        'repositoryAuthorityRevision',
        'latestUserInput',
        'orderedCharacterIds',
        'policy',
        'occurredAt',
        'idempotencyKey',
      ], ['selectedSceneId'])
      || candidate.schema !== TAVERN_CHAT_WORKSPACE_WRITEBACK_HANDOFF_SCHEMA
      || !isBoundedIdentity(candidate.assistantRunId)
      || !isBoundedIdentity(candidate.conversationId)
      || !isBoundedIdentity(candidate.assistantMessageId)
      || !isCanonicalWorkspaceId(candidate.workspaceId)
      || !isNonNegativeSafeInteger(candidate.repositoryAuthorityRevision)
      || typeof candidate.latestUserInput !== 'string'
      || candidate.latestUserInput.length > INPUT_MAX_CHARACTERS
      || !isNonNegativeSafeInteger(candidate.occurredAt)
      || typeof candidate.idempotencyKey !== 'string'
      || candidate.idempotencyKey.length > CHAT_WORKSPACE_WRITEBACK_IDEMPOTENCY_KEY_MAX_CHARACTERS
      || !IDEMPOTENCY_KEY_PATTERN.test(candidate.idempotencyKey)
    ) {
      return undefined
    }

    const selectedSceneId = candidate.selectedSceneId === undefined
      ? undefined
      : parseIdentity(candidate.selectedSceneId)
    const orderedCharacterIds = parseOrderedCharacterIds(candidate.orderedCharacterIds)
    const policy = parsePolicy(candidate.policy)
    if (
      (candidate.selectedSceneId !== undefined && selectedSceneId === undefined)
      || orderedCharacterIds === undefined
      || policy === undefined
    ) {
      return undefined
    }

    return deepFreeze({
      schema: TAVERN_CHAT_WORKSPACE_WRITEBACK_HANDOFF_SCHEMA,
      assistantRunId: candidate.assistantRunId as AssistantRunId,
      conversationId: candidate.conversationId,
      assistantMessageId: candidate.assistantMessageId,
      workspaceId: candidate.workspaceId,
      repositoryAuthorityRevision: candidate.repositoryAuthorityRevision,
      latestUserInput: candidate.latestUserInput,
      ...(selectedSceneId ? { selectedSceneId } : {}),
      orderedCharacterIds,
      policy,
      occurredAt: candidate.occurredAt,
      idempotencyKey: candidate.idempotencyKey,
    })
  } catch {
    return undefined
  }
}

function parsePolicy(candidate: unknown): TavernChatWorkspaceWritebackHandoffPolicy | undefined {
  if (
    !isRecord(candidate)
    || !hasExactKeys(candidate, [
      'schema',
      'summary',
      'characterUpdates',
      'lorebookUpdates',
      'relationshipMemoryUpdates',
      'sceneUpdates',
    ])
    || candidate.schema !== TAVERN_CHAT_WORKSPACE_WRITEBACK_POLICY_SCHEMA
    || candidate.summary !== 'commit'
    || candidate.characterUpdates !== 'review'
    || candidate.lorebookUpdates !== 'review'
    || candidate.relationshipMemoryUpdates !== 'review'
    || candidate.sceneUpdates !== 'review'
  ) {
    return undefined
  }
  return Object.freeze({
    schema: TAVERN_CHAT_WORKSPACE_WRITEBACK_POLICY_SCHEMA,
    summary: 'commit',
    characterUpdates: 'review',
    lorebookUpdates: 'review',
    relationshipMemoryUpdates: 'review',
    sceneUpdates: 'review',
  })
}

function parseOrderedCharacterIds(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_SELECTED_CHARACTER_COUNT) return undefined
  const result: string[] = []
  const seen = new Set<string>()
  for (const candidate of value) {
    const characterId = parseIdentity(candidate)
    if (!characterId || seen.has(characterId)) return undefined
    seen.add(characterId)
    result.push(characterId)
  }
  return Object.freeze(result)
}

function isMatchingIntent(
  intent: ChatWorkspaceWritebackIntent,
  handoff: TavernChatWorkspaceWritebackHandoff,
): boolean {
  try {
    return isBoundedIdentity(intent.assistantRunId)
      && isBoundedIdentity(intent.conversationId)
      && isBoundedIdentity(intent.assistantMessageId)
      && isCanonicalWorkspaceId(intent.workspaceId)
      && isNonNegativeSafeInteger(intent.expectedAuthorityRevision)
      && typeof intent.idempotencyKey === 'string'
      && intent.idempotencyKey.length <= CHAT_WORKSPACE_WRITEBACK_IDEMPOTENCY_KEY_MAX_CHARACTERS
      && IDEMPOTENCY_KEY_PATTERN.test(intent.idempotencyKey)
      && typeof intent.finalOutput === 'string'
      && intent.finalOutput.length <= CHAT_WORKSPACE_WRITEBACK_FINAL_OUTPUT_MAX_CHARACTERS
      && intent.assistantRunId === handoff.assistantRunId
      && intent.conversationId === handoff.conversationId
      && intent.assistantMessageId === handoff.assistantMessageId
      && intent.workspaceId === handoff.workspaceId
      && intent.expectedAuthorityRevision === handoff.repositoryAuthorityRevision
      && intent.idempotencyKey === handoff.idempotencyKey
  } catch {
    return false
  }
}

function createChangeSet(
  handoff: TavernChatWorkspaceWritebackHandoff,
  finalOutput: string,
  digest: string,
): TavernChatWorkspaceWritebackChangeSet {
  return deepFreeze({
    schema: TAVERN_CHAT_WORKSPACE_WRITEBACK_CHANGE_SET_SCHEMA,
    assistantRunId: handoff.assistantRunId,
    conversationId: handoff.conversationId,
    assistantMessageId: handoff.assistantMessageId,
    workspaceId: handoff.workspaceId,
    activeScopeId: handoff.workspaceId,
    repositoryAuthorityRevision: handoff.repositoryAuthorityRevision,
    idempotencyKey: handoff.idempotencyKey,
    latestUserInput: handoff.latestUserInput,
    finalOutput,
    ...(handoff.selectedSceneId ? { selectedSceneId: handoff.selectedSceneId } : {}),
    orderedCharacterIds: [...handoff.orderedCharacterIds],
    applicationOptions: APPLICATION_OPTIONS,
    occurredAt: handoff.occurredAt,
    digest,
  })
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value)
  if (keys.length < required.length || keys.length > required.length + optional.length) return false
  const allowed = new Set([...required, ...optional])
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && keys.every((key) => allowed.has(key))
}

function parseIdentity(value: unknown): string | undefined {
  return isBoundedIdentity(value) ? value : undefined
}

function isBoundedIdentity(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= CHAT_WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS
    && value.trim().length > 0
}

function isCanonicalWorkspaceId(value: unknown): value is string {
  return isBoundedIdentity(value) && normalizeTavernWorkspaceScopeId(value) === value
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason ?? new Error('The Tavern Chat workspace writeback was cancelled.')
  }
}

function failed(reason: string): Extract<TavernChatWorkspaceWritebackResolution, { status: 'failed' }> {
  return Object.freeze({ status: 'failed', reason })
}

function deepFreeze<Value>(value: Value, seen = new WeakSet<object>()): Value {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value
  seen.add(value)
  for (const child of Object.values(value)) deepFreeze(child, seen)
  return Object.freeze(value)
}
