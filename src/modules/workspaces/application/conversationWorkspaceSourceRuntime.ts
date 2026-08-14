import {
  buildTavernContextPack,
} from '../domain/tavernContextPolicy'
import type {
  TavernCharacterCard,
  TavernContextPack,
  TavernLorebookEntry,
  TavernNarrativeSummary,
  TavernRelationshipMemory,
  TavernScene,
  TavernSnapshot,
} from '../domain/tavernContracts'
import {
  parseCanonicalTavernSnapshot,
  TAVERN_SNAPSHOT_LIST_LIMIT,
} from '../domain/tavernSnapshotPolicy'
import {
  TAVERN_WORKSPACE_REPOSITORY_SNAPSHOT_SCHEMA,
  TAVERN_WORKSPACE_SCOPE_RECORD_SCHEMA,
  normalizeTavernWorkspaceScopeId,
} from './tavernWorkspaceRepository'

export const CONVERSATION_WORKSPACE_WRITEBACK_SOURCE_SCHEMA =
  'islemind.assistant-conversation-workspace-writeback-source.v1' as const
export const CONVERSATION_WORKSPACE_WRITEBACK_POLICY_SCHEMA =
  'islemind.assistant-conversation-workspace-writeback-policy.v1' as const

const IDENTITY_MAX_CHARACTERS = 256
const INPUT_MAX_CHARACTERS = 262_144
const SHORT_TEXT_MAX_CHARACTERS = 180
const TEXT_MAX_CHARACTERS = 2_400
const CONTEXT_SECTION_MAX_CHARACTERS = 262_144
const CONTEXT_TOTAL_SECTION_MAX_CHARACTERS = 1_048_576
const CONTEXT_LORE_MAX_ENTRIES = 6
const CONTEXT_MEMORY_MAX_ENTRIES = 8
const CONTEXT_SUMMARY_MAX_ENTRIES = 4
const CONTEXT_PROMPT_MAX_SECTIONS = 64
const CONTEXT_EVIDENCE_MAX_ENTRIES = 67

export interface ConversationWorkspaceSourceCaptureInput {
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly latestUserInput: string
}

export interface ConversationWorkspaceWritebackPolicy {
  readonly schema: typeof CONVERSATION_WORKSPACE_WRITEBACK_POLICY_SCHEMA
  readonly summary: 'commit'
  readonly characterUpdates: 'review'
  readonly lorebookUpdates: 'review'
  readonly relationshipMemoryUpdates: 'review'
  readonly sceneUpdates: 'review'
}

export interface ConversationWorkspaceWritebackSourceEvidence {
  readonly schema: typeof CONVERSATION_WORKSPACE_WRITEBACK_SOURCE_SCHEMA
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly latestUserInput: string
  readonly workspace: {
    readonly id: string
    readonly repositoryAuthorityRevision: number
  }
  readonly selection: {
    readonly workspaceId: string
    readonly repositoryAuthorityRevision: number
    readonly selectedSceneId?: string
    readonly orderedCharacterIds: readonly string[]
  }
  readonly policy: ConversationWorkspaceWritebackPolicy
  readonly occurredAt: number
}

export type ConversationWorkspaceSourceFailureCode =
  | 'invalid_input'
  | 'repository_read_failed'
  | 'invalid_repository_result'
  | 'invalid_repository_snapshot'
  | 'context_capture_failed'
  | 'invalid_clock'

export type ConversationWorkspaceSourceOutcome =
  | {
      readonly status: 'ready'
      readonly context: TavernContextPack
      readonly writebackSource: ConversationWorkspaceWritebackSourceEvidence
    }
  | { readonly status: 'none' }
  | { readonly status: 'cancelled' }
  | {
      readonly status: 'failed'
      readonly code: ConversationWorkspaceSourceFailureCode
    }

export interface ConversationWorkspaceRepositorySnapshotPort {
  load(options: { readonly signal: AbortSignal }): Promise<unknown>
}

export interface ConversationWorkspaceSourceRuntimeDependencies {
  readonly repositorySnapshot: ConversationWorkspaceRepositorySnapshotPort
  readonly now: () => number
}

export interface ConversationWorkspaceSourceRuntime {
  capture(
    input: ConversationWorkspaceSourceCaptureInput,
    options: { readonly signal: AbortSignal },
  ): Promise<ConversationWorkspaceSourceOutcome>
}

interface ParsedRepositorySnapshot {
  readonly revision: number
  readonly scopes: ReadonlyMap<string, TavernSnapshot>
  readonly activeScopeLinks: Readonly<Record<string, string>>
}

type ParsedRepositoryResult =
  | { readonly status: 'ready'; readonly value: ParsedRepositorySnapshot }
  | { readonly status: 'cancelled' }
  | {
      readonly status: 'failed'
      readonly code: Extract<
        ConversationWorkspaceSourceFailureCode,
        'repository_read_failed' | 'invalid_repository_result' | 'invalid_repository_snapshot'
      >
    }

const WRITEBACK_POLICY: ConversationWorkspaceWritebackPolicy = Object.freeze({
  schema: CONVERSATION_WORKSPACE_WRITEBACK_POLICY_SCHEMA,
  summary: 'commit',
  characterUpdates: 'review',
  lorebookUpdates: 'review',
  relationshipMemoryUpdates: 'review',
  sceneUpdates: 'review',
})

const NONE: Extract<ConversationWorkspaceSourceOutcome, { status: 'none' }> =
  Object.freeze({ status: 'none' })
const CANCELLED: Extract<ConversationWorkspaceSourceOutcome, { status: 'cancelled' }> =
  Object.freeze({ status: 'cancelled' })

export function createConversationWorkspaceSourceRuntime(
  dependencies: ConversationWorkspaceSourceRuntimeDependencies,
): ConversationWorkspaceSourceRuntime {
  if (typeof dependencies.repositorySnapshot?.load !== 'function') {
    throw new TypeError('The conversation workspace repository snapshot port is invalid.')
  }
  if (typeof dependencies.now !== 'function') {
    throw new TypeError('The conversation workspace source clock is invalid.')
  }

  const runtime: ConversationWorkspaceSourceRuntime = {
    async capture(input, options) {
      const signal = options.signal
      if (signal.aborted) return CANCELLED
      if (!isValidCaptureInput(input)) return failed('invalid_input')

      let result: unknown
      try {
        result = await dependencies.repositorySnapshot.load({ signal })
      } catch {
        return signal.aborted ? CANCELLED : failed('repository_read_failed')
      }
      if (signal.aborted) return CANCELLED

      const repository = parseRepositoryResult(result)
      if (signal.aborted) return CANCELLED
      if (repository.status === 'cancelled') return CANCELLED
      if (repository.status === 'failed') return failed(repository.code)

      const conversationScopeId = normalizeTavernWorkspaceScopeId(input.conversationId)
      if (!conversationScopeId) return failed('invalid_input')

      const hasExplicitLink = Object.hasOwn(
        repository.value.activeScopeLinks,
        conversationScopeId,
      )
      const workspaceId = hasExplicitLink
        ? repository.value.activeScopeLinks[conversationScopeId]
        : conversationScopeId
      const workspaceSnapshot = repository.value.scopes.get(workspaceId)
      if (!workspaceSnapshot) {
        return hasExplicitLink ? failed('invalid_repository_snapshot') : NONE
      }

      let context: TavernContextPack
      try {
        context = deepFreeze(buildTavernContextPack(workspaceSnapshot, {
          query: input.latestUserInput,
          scopeId: workspaceId,
        }))
      } catch {
        return signal.aborted ? CANCELLED : failed('context_capture_failed')
      }
      if (signal.aborted) return CANCELLED
      if (!isValidConversationWorkspaceContext(context, { workspaceId })) {
        return failed('context_capture_failed')
      }

      let occurredAt: unknown
      try {
        occurredAt = dependencies.now()
      } catch {
        return signal.aborted ? CANCELLED : failed('invalid_clock')
      }
      if (signal.aborted) return CANCELLED
      if (!isTimestamp(occurredAt)) return failed('invalid_clock')

      const authorityRevision = repository.value.revision
      const orderedCharacterIds = Object.freeze(
        context.characters.map((character) => character.id),
      )
      const workspace = Object.freeze({
        id: workspaceId,
        repositoryAuthorityRevision: authorityRevision,
      })
      const selection = Object.freeze({
        workspaceId,
        repositoryAuthorityRevision: authorityRevision,
        ...(context.scene ? { selectedSceneId: context.scene.id } : {}),
        orderedCharacterIds,
      })
      const writebackSource: ConversationWorkspaceWritebackSourceEvidence = Object.freeze({
        schema: CONVERSATION_WORKSPACE_WRITEBACK_SOURCE_SCHEMA,
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        latestUserInput: input.latestUserInput,
        workspace,
        selection,
        policy: WRITEBACK_POLICY,
        occurredAt,
      })

      return Object.freeze({
        status: 'ready',
        context,
        writebackSource,
      })
    },
  }
  return Object.freeze(runtime)
}

export function isValidConversationWorkspaceContext(
  value: unknown,
  expected: { readonly workspaceId: string },
): value is TavernContextPack {
  try {
    if (
      !isBoundedIdentity(expected.workspaceId)
      || !isRecord(value)
      || !isDeepFrozen(value)
      || !hasRequiredAndOptionalKeys(
        value,
        [
          'mode',
          'isolated',
          'shareWithChat',
          'shareWithAgent',
          'scopeId',
          'characters',
          'lorebook',
          'relationshipMemories',
          'narrativeSummaries',
          'promptSections',
          'evidence',
        ],
        ['scene'],
      )
      || value.mode !== 'companion'
      || value.isolated !== true
      || value.shareWithChat !== false
      || value.shareWithAgent !== false
      || value.scopeId !== expected.workspaceId
      || normalizeTavernWorkspaceScopeId(value.scopeId) !== value.scopeId
      || !isOptionalScene(value.scene)
      || !isContextCollection(value.characters, TAVERN_SNAPSHOT_LIST_LIMIT, isCharacter)
      || !hasUniqueIds(value.characters)
      || !isContextCollection(value.lorebook, CONTEXT_LORE_MAX_ENTRIES, isLorebookEntry)
      || !hasUniqueIds(value.lorebook)
      || !isContextCollection(
        value.relationshipMemories,
        CONTEXT_MEMORY_MAX_ENTRIES,
        isRelationshipMemory,
      )
      || !hasUniqueIds(value.relationshipMemories)
      || !isContextCollection(
        value.narrativeSummaries,
        CONTEXT_SUMMARY_MAX_ENTRIES,
        isNarrativeSummary,
      )
      || !hasUniqueIds(value.narrativeSummaries)
      || !isPromptSections(value.promptSections)
      || !isContextEvidence(value.evidence, value)
    ) {
      return false
    }
    return true
  } catch {
    return false
  }
}

function parseRepositoryResult(candidate: unknown): ParsedRepositoryResult {
  try {
    if (!isDataRecord(candidate) || typeof candidate.ok !== 'boolean') {
      return repositoryFailed('invalid_repository_result')
    }
    if (!candidate.ok) {
      if (!isDataRecord(candidate.error) || typeof candidate.error.code !== 'string') {
        return repositoryFailed('invalid_repository_result')
      }
      if (candidate.error.code === 'cancelled') return { status: 'cancelled' }
      return isRepositoryErrorCode(candidate.error.code)
        ? repositoryFailed('repository_read_failed')
        : repositoryFailed('invalid_repository_result')
    }
    let value: ParsedRepositorySnapshot | undefined
    try {
      value = parseRepositorySnapshot(candidate.value)
    } catch {
      return repositoryFailed('invalid_repository_snapshot')
    }
    return value
      ? { status: 'ready', value }
      : repositoryFailed('invalid_repository_snapshot')
  } catch {
    return repositoryFailed('invalid_repository_result')
  }
}

function parseRepositorySnapshot(candidate: unknown): ParsedRepositorySnapshot | undefined {
  if (
    !isDataRecord(candidate)
    || !hasExactKeys(candidate, [
      'schema',
      'revision',
      'scopes',
      'activeScopeLinks',
      'updatedAt',
    ])
    || candidate.schema !== TAVERN_WORKSPACE_REPOSITORY_SNAPSHOT_SCHEMA
    || !isNonNegativeSafeInteger(candidate.revision)
    || !isTimestamp(candidate.updatedAt)
    || !Array.isArray(candidate.scopes)
    || !isPlainDataTree(candidate.scopes)
    || !isDataRecord(candidate.activeScopeLinks)
  ) {
    return undefined
  }

  const scopes = new Map<string, TavernSnapshot>()
  for (const rawScope of candidate.scopes) {
    if (
      !isDataRecord(rawScope)
      || !hasExactKeys(rawScope, ['schema', 'scopeId', 'revision', 'snapshot', 'updatedAt'])
      || rawScope.schema !== TAVERN_WORKSPACE_SCOPE_RECORD_SCHEMA
      || typeof rawScope.scopeId !== 'string'
      || normalizeTavernWorkspaceScopeId(rawScope.scopeId) !== rawScope.scopeId
      || !isNonNegativeSafeInteger(rawScope.revision)
      || !isTimestamp(rawScope.updatedAt)
      || scopes.has(rawScope.scopeId)
    ) {
      return undefined
    }
    const snapshot = parseCanonicalTavernSnapshot(rawScope.snapshot)
    if (!snapshot) return undefined
    scopes.set(rawScope.scopeId, snapshot)
  }

  const activeScopeLinks = Object.create(null) as Record<string, string>
  for (const [rawConversationScopeId, rawWorkspaceId] of dataEntries(candidate.activeScopeLinks)) {
    const conversationScopeId = normalizeTavernWorkspaceScopeId(rawConversationScopeId)
    const workspaceId = normalizeTavernWorkspaceScopeId(rawWorkspaceId)
    if (
      !conversationScopeId
      || conversationScopeId !== rawConversationScopeId
      || !workspaceId
      || workspaceId !== rawWorkspaceId
      || conversationScopeId === workspaceId
      || !scopes.has(workspaceId)
      || Object.hasOwn(activeScopeLinks, conversationScopeId)
    ) {
      return undefined
    }
    activeScopeLinks[conversationScopeId] = workspaceId
  }

  return Object.freeze({
    revision: candidate.revision,
    scopes,
    activeScopeLinks: Object.freeze(activeScopeLinks),
  })
}

function isValidCaptureInput(input: ConversationWorkspaceSourceCaptureInput): boolean {
  try {
    return isBoundedIdentity(input.conversationId)
      && normalizeTavernWorkspaceScopeId(input.conversationId) !== undefined
      && isBoundedIdentity(input.assistantMessageId)
      && typeof input.latestUserInput === 'string'
      && input.latestUserInput.length <= INPUT_MAX_CHARACTERS
  } catch {
    return false
  }
}

function isOptionalScene(value: unknown): value is TavernScene | undefined {
  return value === undefined || isScene(value)
}

function isCharacter(value: unknown): value is TavernCharacterCard {
  if (
    !isRecord(value)
    || !hasRequiredAndOptionalKeys(
      value,
      [
        'id',
        'name',
        'persona',
        'speechStyle',
        'background',
        'constraints',
        'tags',
        'createdAt',
        'updatedAt',
      ],
      ['avatarUri', 'openingMessage'],
    )
  ) {
    return false
  }
  return isCanonicalId(value.id)
    && isCanonicalText(value.name, SHORT_TEXT_MAX_CHARACTERS)
    && isCanonicalTextOrEmpty(value.persona, TEXT_MAX_CHARACTERS)
    && isCanonicalTextOrEmpty(value.speechStyle, TEXT_MAX_CHARACTERS)
    && isCanonicalTextOrEmpty(value.background, TEXT_MAX_CHARACTERS)
    && isOptionalCanonicalText(value.avatarUri, TEXT_MAX_CHARACTERS)
    && isOptionalCanonicalText(value.openingMessage, TEXT_MAX_CHARACTERS)
    && isCanonicalTextList(value.constraints, TAVERN_SNAPSHOT_LIST_LIMIT)
    && isCanonicalTextList(value.tags, TAVERN_SNAPSHOT_LIST_LIMIT)
    && isCanonicalDomainTimestamp(value.createdAt)
    && isCanonicalDomainTimestamp(value.updatedAt)
}

function isLorebookEntry(value: unknown): value is TavernLorebookEntry {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      'id',
      'title',
      'content',
      'keywords',
      'priority',
      'enabled',
      'createdAt',
      'updatedAt',
    ])
  ) {
    return false
  }
  return isCanonicalId(value.id)
    && isCanonicalText(value.title, SHORT_TEXT_MAX_CHARACTERS)
    && isCanonicalText(value.content, TEXT_MAX_CHARACTERS)
    && isCanonicalTextList(value.keywords, 24)
    && isThreeDecimalNumber(value.priority, 0, 100)
    && typeof value.enabled === 'boolean'
    && isCanonicalDomainTimestamp(value.createdAt)
    && isCanonicalDomainTimestamp(value.updatedAt)
}

function isRelationshipMemory(value: unknown): value is TavernRelationshipMemory {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      'id',
      'characterId',
      'kind',
      'content',
      'weight',
      'userVisible',
      'createdAt',
      'updatedAt',
    ])
  ) {
    return false
  }
  return isCanonicalId(value.id)
    && isCanonicalId(value.characterId)
    && (
      value.kind === 'affinity'
      || value.kind === 'trust'
      || value.kind === 'event'
      || value.kind === 'preference'
      || value.kind === 'boundary'
    )
    && isCanonicalText(value.content, TEXT_MAX_CHARACTERS)
    && isThreeDecimalNumber(value.weight, 0, 1)
    && typeof value.userVisible === 'boolean'
    && isCanonicalDomainTimestamp(value.createdAt)
    && isCanonicalDomainTimestamp(value.updatedAt)
}

function isScene(value: unknown): value is TavernScene {
  if (
    !isRecord(value)
    || !hasRequiredAndOptionalKeys(
      value,
      [
        'id',
        'title',
        'location',
        'activeCharacterIds',
        'speakingOrder',
        'createdAt',
        'updatedAt',
      ],
      ['branchFromSceneId', 'timeOfDay', 'mood', 'narrativeGoal', 'narratorStyle'],
    )
  ) {
    return false
  }
  return isCanonicalId(value.id)
    && isCanonicalText(value.title, SHORT_TEXT_MAX_CHARACTERS)
    && isCanonicalText(value.location, SHORT_TEXT_MAX_CHARACTERS)
    && isOptionalCanonicalId(value.branchFromSceneId)
    && isOptionalCanonicalText(value.timeOfDay, SHORT_TEXT_MAX_CHARACTERS)
    && isOptionalCanonicalText(value.mood, SHORT_TEXT_MAX_CHARACTERS)
    && isOptionalCanonicalText(value.narrativeGoal, TEXT_MAX_CHARACTERS)
    && isCanonicalIdList(value.activeCharacterIds, TAVERN_SNAPSHOT_LIST_LIMIT)
    && isOptionalCanonicalText(value.narratorStyle, SHORT_TEXT_MAX_CHARACTERS)
    && isCanonicalIdList(value.speakingOrder, TAVERN_SNAPSHOT_LIST_LIMIT)
    && isCanonicalDomainTimestamp(value.createdAt)
    && isCanonicalDomainTimestamp(value.updatedAt)
}

function isNarrativeSummary(value: unknown): value is TavernNarrativeSummary {
  if (
    !isRecord(value)
    || !hasRequiredAndOptionalKeys(
      value,
      [
        'id',
        'summary',
        'unresolvedThreads',
        'promises',
        'importantChanges',
        'createdAt',
        'updatedAt',
      ],
      ['sceneId', 'chapterTitle'],
    )
  ) {
    return false
  }
  return isCanonicalText(value.id, IDENTITY_MAX_CHARACTERS)
    && isOptionalCanonicalId(value.sceneId)
    && isOptionalCanonicalText(value.chapterTitle, SHORT_TEXT_MAX_CHARACTERS)
    && isCanonicalText(value.summary, TEXT_MAX_CHARACTERS)
    && isCanonicalTextList(value.unresolvedThreads, TAVERN_SNAPSHOT_LIST_LIMIT, false)
    && isCanonicalTextList(value.promises, TAVERN_SNAPSHOT_LIST_LIMIT, false)
    && isCanonicalTextList(value.importantChanges, TAVERN_SNAPSHOT_LIST_LIMIT, false)
    && isCanonicalDomainTimestamp(value.createdAt)
    && isCanonicalDomainTimestamp(value.updatedAt)
}

function isContextCollection<Value>(
  value: unknown,
  maxEntries: number,
  validate: (candidate: unknown) => candidate is Value,
): value is readonly Value[] {
  if (!Array.isArray(value) || value.length > maxEntries) return false
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index) || !validate(value[index])) return false
  }
  return true
}

function hasUniqueIds(value: readonly { readonly id: string }[]): boolean {
  const ids = new Set<string>()
  for (const item of value) {
    if (ids.has(item.id)) return false
    ids.add(item.id)
  }
  return true
}

function isPromptSections(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || value.length > CONTEXT_PROMPT_MAX_SECTIONS) return false
  let totalCharacters = 0
  for (let index = 0; index < value.length; index += 1) {
    const section = value[index]
    if (
      !Object.hasOwn(value, index)
      || typeof section !== 'string'
      || section.length > CONTEXT_SECTION_MAX_CHARACTERS
      || section.trim().length === 0
    ) {
      return false
    }
    totalCharacters += section.length
    if (totalCharacters > CONTEXT_TOTAL_SECTION_MAX_CHARACTERS) return false
  }
  return true
}

function isContextEvidence(
  value: unknown,
  context: Readonly<Record<string, unknown>>,
): value is readonly string[] {
  if (!Array.isArray(value) || value.length > CONTEXT_EVIDENCE_MAX_ENTRIES) return false
  const scene = context.scene as TavernScene | undefined
  const characters = context.characters as readonly TavernCharacterCard[]
  const lorebook = context.lorebook as readonly TavernLorebookEntry[]
  const relationshipMemories = context.relationshipMemories as readonly TavernRelationshipMemory[]
  const narrativeSummaries = context.narrativeSummaries as readonly TavernNarrativeSummary[]
  const expected = [
    ...(scene ? [`scene:${scene.id}`] : []),
    ...characters.map((character) => `character:${character.id}`),
    ...lorebook.map((entry) => `lore:${entry.id}`),
    ...relationshipMemories.map((memory) => `memory:${memory.id}`),
    ...narrativeSummaries.map((summary) => `summary:${summary.id}`),
  ]
  if (value.length !== expected.length) return false
  return expected.every((item, index) => Object.hasOwn(value, index) && value[index] === item)
}

function isCanonicalTextList(
  value: unknown,
  maxEntries: number,
  caseInsensitiveUniqueness = true,
): value is readonly string[] {
  if (!Array.isArray(value) || value.length > maxEntries) return false
  const seen = new Set<string>()
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index]
    if (!Object.hasOwn(value, index) || !isCanonicalText(item, SHORT_TEXT_MAX_CHARACTERS)) {
      return false
    }
    const key = caseInsensitiveUniqueness ? item.toLowerCase() : item
    if (seen.has(key)) return false
    seen.add(key)
  }
  return true
}

function isCanonicalIdList(value: unknown, maxEntries: number): value is readonly string[] {
  if (!Array.isArray(value) || value.length > maxEntries) return false
  const seen = new Set<string>()
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index]
    if (!Object.hasOwn(value, index) || !isCanonicalId(item)) return false
    const key = item.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
  }
  return true
}

function isCanonicalId(value: unknown): value is string {
  return isCanonicalText(value, 120) && !/[\u0000-\u001F]/.test(value)
}

function isOptionalCanonicalId(value: unknown): value is string | undefined {
  return value === undefined || isCanonicalId(value)
}

function isCanonicalText(value: unknown, limit: number): value is string {
  return typeof value === 'string'
    && value.length <= limit
    && value.length > 0
    && value.replace(/\s+/g, ' ').trim() === value
}

function isCanonicalTextOrEmpty(value: unknown, limit: number): value is string {
  return value === '' || isCanonicalText(value, limit)
}

function isOptionalCanonicalText(value: unknown, limit: number): value is string | undefined {
  return value === undefined || isCanonicalText(value, limit)
}

function isCanonicalDomainTimestamp(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && Math.trunc(value) === value
}

function isThreeDecimalNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= min
    && value <= max
    && Number(value.toFixed(3)) === value
}

function isBoundedIdentity(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= IDENTITY_MAX_CHARACTERS
    && value.trim().length > 0
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isTimestamp(value: unknown): value is number {
  return isNonNegativeSafeInteger(value)
}

function isRepositoryErrorCode(value: string): boolean {
  return value === 'invalid_scope'
    || value === 'validation_failed'
    || value === 'duplicate'
    || value === 'not_found'
    || value === 'revision_conflict'
    || value === 'corrupt_record'
    || value === 'persistence_failed'
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDataRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (!isRecord(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return false
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return false
  }
  return true
}

function isPlainDataTree(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null) return true
  if (typeof value !== 'object') {
    return value === undefined
      || typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'boolean'
  }
  if (seen.has(value)) return false
  const isArray = Array.isArray(value)
  const prototype = Object.getPrototypeOf(value)
  if (isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    return false
  }
  seen.add(value)
  for (const key of Reflect.ownKeys(value)) {
    if (isArray && key === 'length') continue
    if (typeof key !== 'string') return false
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return false
    if (!isPlainDataTree(descriptor.value, seen)) return false
  }
  if (isArray) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) return false
    }
  }
  return true
}

function dataEntries(value: Readonly<Record<string, unknown>>): readonly (readonly [string, unknown])[] {
  return Reflect.ownKeys(value).map((key) => {
    if (typeof key !== 'string') throw new TypeError('A repository link key is invalid.')
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('A repository link is invalid.')
    }
    return [key, descriptor.value] as const
  })
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key))
}

function hasRequiredAndOptionalKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const allowed = new Set([...required, ...optional])
  const keys = Object.keys(value)
  return required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => allowed.has(key))
}

function isDeepFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value !== 'object' || value === null) return true
  if (seen.has(value)) return true
  const prototype = Object.getPrototypeOf(value)
  if (
    !Object.isFrozen(value)
    || (Array.isArray(value) ? prototype !== Array.prototype : prototype !== Object.prototype)
  ) {
    return false
  }
  seen.add(value)
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue
    if (typeof key !== 'string') return false
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return false
    if (!isDeepFrozen(descriptor.value, seen)) return false
  }
  return true
}

function deepFreeze<Value>(value: Value, seen = new WeakSet<object>()): Value {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value
  seen.add(value)
  for (const child of Object.values(value)) deepFreeze(child, seen)
  return Object.freeze(value)
}

function failed(
  code: ConversationWorkspaceSourceFailureCode,
): Extract<ConversationWorkspaceSourceOutcome, { status: 'failed' }> {
  return Object.freeze({ status: 'failed', code })
}

function repositoryFailed(
  code: Extract<
    ConversationWorkspaceSourceFailureCode,
    'repository_read_failed' | 'invalid_repository_result' | 'invalid_repository_snapshot'
  >,
): Extract<ParsedRepositoryResult, { status: 'failed' }> {
  return { status: 'failed', code }
}
