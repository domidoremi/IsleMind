import type { AssistantRunId } from '@/core'
import {
  ASSISTANT_CONVERSATION_WORKSPACE_WRITEBACK_HANDOFF_SCHEMA,
  ASSISTANT_CONVERSATION_WORKSPACE_WRITEBACK_POLICY_SCHEMA,
  type AssistantConversationWorkspaceWritebackHandoff,
  type AssistantConversationWorkspaceWritebackPolicy,
} from '../workspaceWritebackContracts'

export {
  ASSISTANT_CONVERSATION_WORKSPACE_WRITEBACK_HANDOFF_SCHEMA,
  ASSISTANT_CONVERSATION_WORKSPACE_WRITEBACK_POLICY_SCHEMA,
  type AssistantConversationWorkspaceWritebackHandoff,
  type AssistantConversationWorkspaceWritebackPolicy,
} from '../workspaceWritebackContracts'

export const ASSISTANT_CONVERSATION_WORKSPACE_WRITEBACK_SOURCE_SCHEMA =
  'islemind.assistant-conversation-workspace-writeback-source.v1' as const
export const ASSISTANT_CONVERSATION_WORKSPACE_WRITEBACK_CAPTURE_SCHEMA =
  'islemind.assistant-conversation-workspace-writeback-capture.v1' as const

export const ASSISTANT_CONVERSATION_WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS = 256
export const ASSISTANT_CONVERSATION_WORKSPACE_WRITEBACK_INPUT_MAX_CHARACTERS = 262_144
export const ASSISTANT_CONVERSATION_WORKSPACE_WRITEBACK_REASON_MAX_CHARACTERS = 1_024
export const ASSISTANT_CONVERSATION_WORKSPACE_WRITEBACK_MAX_SELECTED_CHARACTERS = 64

const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/
const IDEMPOTENCY_KEY_PREFIX = 'islemind.chat-workspace-writeback.v1:'

export interface AssistantConversationWorkspaceWritebackAdmissionInput {
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly latestUserInput: string
}

export interface AssistantConversationWorkspaceWritebackSourceSnapshot {
  readonly schema: typeof ASSISTANT_CONVERSATION_WORKSPACE_WRITEBACK_SOURCE_SCHEMA
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
  readonly policy: AssistantConversationWorkspaceWritebackPolicy
  readonly occurredAt: number
}

export interface AssistantConversationWorkspaceWritebackIdempotencyDigestPort {
  /** Returns a deterministic lowercase SHA-256 digest for the exact canonical payload. */
  digestCanonicalPayload(
    canonicalPayload: string,
    options: { readonly signal: AbortSignal },
  ): Promise<string>
}

export interface AssistantConversationWorkspaceWritebackSourceCapture {
  readonly schema: typeof ASSISTANT_CONVERSATION_WORKSPACE_WRITEBACK_CAPTURE_SCHEMA
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly workspaceId: string
  readonly repositoryAuthorityRevision: number
  readonly latestUserInput: string
  readonly selectedSceneId?: string
  readonly orderedCharacterIds: readonly string[]
  readonly policy: AssistantConversationWorkspaceWritebackPolicy
  readonly occurredAt: number
}

export type AssistantConversationWorkspaceWritebackAdmissionOutcome<TWorkspaceContext> =
  | {
      readonly status: 'none'
    }
  | {
      readonly status: 'ready'
      readonly workspaceContext: TWorkspaceContext
      readonly capture: AssistantConversationWorkspaceWritebackSourceCapture
    }
  | {
      readonly status: 'cancelled'
    }
  | {
      readonly status: 'failed'
      readonly code: string
      readonly reason?: string
    }

export type AssistantConversationWorkspaceWritebackBindOutcome =
  | {
      readonly status: 'ready'
      readonly handoff: AssistantConversationWorkspaceWritebackHandoff
    }
  | {
      readonly status: 'cancelled'
      readonly code: 'cancelled_before_idempotency' | 'cancelled_after_idempotency'
    }
  | {
      readonly status: 'failed'
      readonly code:
        | 'invalid_assistant_run_id'
        | 'capture_not_issued'
        | 'idempotency_digest_threw'
        | 'invalid_idempotency_digest'
    }

export interface AssistantConversationWorkspaceWritebackHandoffRuntime<TWorkspaceContext> {
  admitResolvedSource(
    input: AssistantConversationWorkspaceWritebackAdmissionInput,
    candidate: unknown,
  ): AssistantConversationWorkspaceWritebackAdmissionOutcome<TWorkspaceContext>
  bindRun(
    input: {
      readonly assistantRunId: AssistantRunId
      readonly capture: AssistantConversationWorkspaceWritebackSourceCapture
    },
    options: { readonly signal: AbortSignal },
  ): Promise<AssistantConversationWorkspaceWritebackBindOutcome>
}

export interface AssistantConversationWorkspaceWritebackHandoffRuntimeDependencies<TWorkspaceContext> {
  readonly isValidWorkspaceContext: (
    candidate: unknown,
    options: { readonly workspaceId: string },
  ) => candidate is TWorkspaceContext
  readonly idempotencyDigest: AssistantConversationWorkspaceWritebackIdempotencyDigestPort
}

export function createAssistantConversationWorkspaceWritebackHandoffRuntime<TWorkspaceContext>(
  dependencies: AssistantConversationWorkspaceWritebackHandoffRuntimeDependencies<TWorkspaceContext>,
): AssistantConversationWorkspaceWritebackHandoffRuntime<TWorkspaceContext> {
  if (typeof dependencies.isValidWorkspaceContext !== 'function') {
    throw new TypeError('The workspace context validator is invalid.')
  }
  if (typeof dependencies.idempotencyDigest?.digestCanonicalPayload !== 'function') {
    throw new TypeError('The workspace writeback idempotency digest port is invalid.')
  }

  const issuedCaptures = new WeakSet<object>()

  function admitResolvedSource(
    input: AssistantConversationWorkspaceWritebackAdmissionInput,
    candidate: unknown,
  ): AssistantConversationWorkspaceWritebackAdmissionOutcome<TWorkspaceContext> {
    if (!isValidCaptureInput(input)) {
      return Object.freeze({ status: 'failed', code: 'invalid_input' })
    }

    const resolution = parseResolvedSource(candidate, input)
    if (resolution.status === 'invalid') {
      return Object.freeze({ status: 'failed', code: resolution.code })
    }
    if (resolution.status === 'none') {
      return Object.freeze({ status: 'none' })
    }
    if (resolution.status === 'cancelled') {
      return Object.freeze({ status: 'cancelled' })
    }
    if (resolution.status === 'failed') {
      return Object.freeze({
        status: 'failed',
        code: resolution.code,
        ...(resolution.reason ? { reason: resolution.reason } : {}),
      })
    }

    let workspaceContext: TWorkspaceContext
    try {
      if (!dependencies.isValidWorkspaceContext(
        resolution.workspaceContext,
        { workspaceId: resolution.capture.workspaceId },
      )) {
        return Object.freeze({ status: 'failed', code: 'workspace_context_mismatch' })
      }
      workspaceContext = resolution.workspaceContext
    } catch {
      return Object.freeze({ status: 'failed', code: 'workspace_context_mismatch' })
    }
    if (!isDeeplyFrozenGraph(workspaceContext)) {
      return Object.freeze({ status: 'failed', code: 'workspace_context_not_frozen' })
    }

    issuedCaptures.add(resolution.capture)
    return Object.freeze({
      status: 'ready',
      workspaceContext,
      capture: resolution.capture,
    })
  }

  async function bindRun(
    input: {
      readonly assistantRunId: AssistantRunId
      readonly capture: AssistantConversationWorkspaceWritebackSourceCapture
    },
    options: { readonly signal: AbortSignal },
  ): Promise<AssistantConversationWorkspaceWritebackBindOutcome> {
    if (options.signal.aborted) {
      return { status: 'cancelled', code: 'cancelled_before_idempotency' }
    }
    if (!isBoundedIdentity(input.assistantRunId)) {
      return { status: 'failed', code: 'invalid_assistant_run_id' }
    }
    if (!isRecord(input.capture) || !issuedCaptures.has(input.capture)) {
      return { status: 'failed', code: 'capture_not_issued' }
    }

    let digest: unknown
    try {
      digest = await dependencies.idempotencyDigest.digestCanonicalPayload(
        canonicalizeIdempotencyPayload(input.assistantRunId, input.capture),
        options,
      )
    } catch {
      return options.signal.aborted
        ? { status: 'cancelled', code: 'cancelled_after_idempotency' }
        : { status: 'failed', code: 'idempotency_digest_threw' }
    }
    if (options.signal.aborted) {
      return { status: 'cancelled', code: 'cancelled_after_idempotency' }
    }
    if (typeof digest !== 'string' || !SHA256_DIGEST_PATTERN.test(digest)) {
      return { status: 'failed', code: 'invalid_idempotency_digest' }
    }

    const capture = input.capture
    const handoff = Object.freeze({
      schema: ASSISTANT_CONVERSATION_WORKSPACE_WRITEBACK_HANDOFF_SCHEMA,
      assistantRunId: input.assistantRunId,
      conversationId: capture.conversationId,
      assistantMessageId: capture.assistantMessageId,
      workspaceId: capture.workspaceId,
      repositoryAuthorityRevision: capture.repositoryAuthorityRevision,
      latestUserInput: capture.latestUserInput,
      ...(capture.selectedSceneId ? { selectedSceneId: capture.selectedSceneId } : {}),
      orderedCharacterIds: capture.orderedCharacterIds,
      policy: capture.policy,
      occurredAt: capture.occurredAt,
      idempotencyKey: `${IDEMPOTENCY_KEY_PREFIX}${digest}`,
    })
    return { status: 'ready', handoff }
  }

  return Object.freeze({ admitResolvedSource, bindRun })
}

type ParsedResolvedSource =
  | { readonly status: 'none' }
  | {
      readonly status: 'ready'
      readonly workspaceContext: unknown
      readonly capture: AssistantConversationWorkspaceWritebackSourceCapture
    }
  | { readonly status: 'cancelled' }
  | { readonly status: 'failed'; readonly code: string; readonly reason?: string }
  | {
      readonly status: 'invalid'
      readonly code:
        | 'invalid_resolved_source'
        | 'invalid_writeback_source'
        | 'writeback_source_coherence_mismatch'
    }

type ParsedWritebackSource =
  | {
      readonly status: 'ready'
      readonly capture: AssistantConversationWorkspaceWritebackSourceCapture
    }
  | {
      readonly status: 'invalid'
      readonly code: 'invalid_writeback_source' | 'writeback_source_coherence_mismatch'
    }

function parseResolvedSource(
  candidate: unknown,
  input: AssistantConversationWorkspaceWritebackAdmissionInput,
): ParsedResolvedSource {
  try {
    if (!isRecord(candidate)) {
      return { status: 'invalid', code: 'invalid_resolved_source' }
    }
    const status = readOwnDataProperty(candidate, 'status')
    if (status === 'none') {
      return hasExactDataProperties(candidate, ['status'])
        ? Object.freeze({ status: 'none' })
        : { status: 'invalid', code: 'invalid_resolved_source' }
    }
    if (status === 'failed') {
      if (!hasExactDataProperties(candidate, ['status', 'code'], ['reason'])) {
        return { status: 'invalid', code: 'invalid_resolved_source' }
      }
      const code = parseCode(candidate.code)
      const reason = parseReason(candidate.reason)
      if (!code || (candidate.reason !== undefined && reason === undefined)) {
        return { status: 'invalid', code: 'invalid_resolved_source' }
      }
      return Object.freeze({
        status: 'failed',
        code,
        ...(reason ? { reason } : {}),
      })
    }
    if (status === 'cancelled') {
      return hasExactDataProperties(candidate, ['status'])
        ? Object.freeze({ status: 'cancelled' })
        : { status: 'invalid', code: 'invalid_resolved_source' }
    }
    if (
      status !== 'ready'
      || !hasExactDataProperties(candidate, ['status', 'context', 'writebackSource'])
    ) {
      return { status: 'invalid', code: 'invalid_resolved_source' }
    }
    const writebackSource = parseWritebackSource(candidate.writebackSource, input)
    return writebackSource.status === 'ready'
      ? {
          status: 'ready',
          workspaceContext: candidate.context,
          capture: writebackSource.capture,
        }
      : writebackSource
  } catch {
    return { status: 'invalid', code: 'invalid_resolved_source' }
  }
}

function parseWritebackSource(
  candidate: unknown,
  input: AssistantConversationWorkspaceWritebackAdmissionInput,
): ParsedWritebackSource {
  if (
    !isRecord(candidate)
    || !hasExactDataProperties(candidate, [
      'schema',
      'conversationId',
      'assistantMessageId',
      'latestUserInput',
      'workspace',
      'selection',
      'policy',
      'occurredAt',
    ])
  ) {
    return { status: 'invalid', code: 'invalid_writeback_source' }
  }
  const workspace = candidate.workspace
  const selection = candidate.selection
  const policyCandidate = candidate.policy
  if (
    !isRecord(workspace)
    || !hasExactDataProperties(workspace, ['id', 'repositoryAuthorityRevision'])
    || !isRecord(selection)
    || !hasExactDataProperties(
      selection,
      ['workspaceId', 'repositoryAuthorityRevision', 'orderedCharacterIds'],
      ['selectedSceneId'],
    )
    || !isRecord(policyCandidate)
    || !hasExactDataProperties(policyCandidate, [
      'schema',
      'summary',
      'characterUpdates',
      'lorebookUpdates',
      'relationshipMemoryUpdates',
      'sceneUpdates',
    ])
  ) {
    return { status: 'invalid', code: 'invalid_writeback_source' }
  }
  if (
    candidate.schema !== ASSISTANT_CONVERSATION_WORKSPACE_WRITEBACK_SOURCE_SCHEMA
    || !isBoundedIdentity(candidate.conversationId)
    || !isBoundedIdentity(candidate.assistantMessageId)
    || typeof candidate.latestUserInput !== 'string'
    || candidate.latestUserInput.length > ASSISTANT_CONVERSATION_WORKSPACE_WRITEBACK_INPUT_MAX_CHARACTERS
    || !isBoundedIdentity(workspace.id)
    || !isNonNegativeSafeInteger(workspace.repositoryAuthorityRevision)
    || !isBoundedIdentity(selection.workspaceId)
    || !isNonNegativeSafeInteger(selection.repositoryAuthorityRevision)
    || !isNonNegativeSafeInteger(candidate.occurredAt)
  ) {
    return { status: 'invalid', code: 'invalid_writeback_source' }
  }
  if (
    candidate.conversationId !== input.conversationId
    || candidate.assistantMessageId !== input.assistantMessageId
    || candidate.latestUserInput !== input.latestUserInput
    || selection.workspaceId !== workspace.id
    || selection.repositoryAuthorityRevision !== workspace.repositoryAuthorityRevision
  ) {
    return { status: 'invalid', code: 'writeback_source_coherence_mismatch' }
  }

  const selectedSceneId = selection.selectedSceneId === undefined
    ? undefined
    : parseIdentity(selection.selectedSceneId)
  const orderedCharacterIds = parseOrderedCharacterIds(selection.orderedCharacterIds)
  const policy = parsePolicy(policyCandidate)
  if (
    (selection.selectedSceneId !== undefined && selectedSceneId === undefined)
    || orderedCharacterIds === undefined
    || policy === undefined
  ) {
    return { status: 'invalid', code: 'invalid_writeback_source' }
  }

  const capture = Object.freeze({
    schema: ASSISTANT_CONVERSATION_WORKSPACE_WRITEBACK_CAPTURE_SCHEMA,
    conversationId: input.conversationId,
    assistantMessageId: input.assistantMessageId,
    workspaceId: workspace.id,
    repositoryAuthorityRevision: workspace.repositoryAuthorityRevision,
    latestUserInput: input.latestUserInput,
    ...(selectedSceneId ? { selectedSceneId } : {}),
    orderedCharacterIds,
    policy,
    occurredAt: candidate.occurredAt,
  })
  return { status: 'ready', capture }
}

function parsePolicy(
  candidate: Readonly<Record<string, unknown>>,
): AssistantConversationWorkspaceWritebackPolicy | undefined {
  if (
    candidate.schema !== ASSISTANT_CONVERSATION_WORKSPACE_WRITEBACK_POLICY_SCHEMA
    || candidate.summary !== 'commit'
    || candidate.characterUpdates !== 'review'
    || candidate.lorebookUpdates !== 'review'
    || candidate.relationshipMemoryUpdates !== 'review'
    || candidate.sceneUpdates !== 'review'
  ) {
    return undefined
  }
  return Object.freeze({
    schema: ASSISTANT_CONVERSATION_WORKSPACE_WRITEBACK_POLICY_SCHEMA,
    summary: 'commit',
    characterUpdates: 'review',
    lorebookUpdates: 'review',
    relationshipMemoryUpdates: 'review',
    sceneUpdates: 'review',
  })
}

function parseOrderedCharacterIds(value: unknown): readonly string[] | undefined {
  if (
    !Array.isArray(value)
    || value.length > ASSISTANT_CONVERSATION_WORKSPACE_WRITEBACK_MAX_SELECTED_CHARACTERS
    || !hasExactArrayDataProperties(value)
  ) {
    return undefined
  }
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

function canonicalizeIdempotencyPayload(
  assistantRunId: AssistantRunId,
  capture: AssistantConversationWorkspaceWritebackSourceCapture,
): string {
  return JSON.stringify([
    ASSISTANT_CONVERSATION_WORKSPACE_WRITEBACK_HANDOFF_SCHEMA,
    assistantRunId,
    capture.conversationId,
    capture.assistantMessageId,
    capture.workspaceId,
    capture.repositoryAuthorityRevision,
    capture.latestUserInput,
    capture.selectedSceneId ?? null,
    [...capture.orderedCharacterIds],
    [
      capture.policy.schema,
      capture.policy.summary,
      capture.policy.characterUpdates,
      capture.policy.lorebookUpdates,
      capture.policy.relationshipMemoryUpdates,
      capture.policy.sceneUpdates,
    ],
    capture.occurredAt,
  ])
}

function isValidCaptureInput(
  input: AssistantConversationWorkspaceWritebackAdmissionInput,
): boolean {
  try {
    return isBoundedIdentity(input.conversationId)
      && isBoundedIdentity(input.assistantMessageId)
      && typeof input.latestUserInput === 'string'
      && input.latestUserInput.length
        <= ASSISTANT_CONVERSATION_WORKSPACE_WRITEBACK_INPUT_MAX_CHARACTERS
  } catch {
    return false
  }
}

const OUTCOME_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/

function parseCode(value: unknown): string | undefined {
  return typeof value === 'string' && OUTCOME_CODE_PATTERN.test(value)
    ? value
    : undefined
}

function parseIdentity(value: unknown): string | undefined {
  return isBoundedIdentity(value) ? value : undefined
}

function parseReason(value: unknown): string | undefined {
  return value === undefined
    ? undefined
    : typeof value === 'string'
      && value.length <= ASSISTANT_CONVERSATION_WORKSPACE_WRITEBACK_REASON_MAX_CHARACTERS
      && value.trim().length > 0
      ? value
      : undefined
}

function isBoundedIdentity(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= ASSISTANT_CONVERSATION_WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS
    && value.trim().length > 0
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactDataProperties(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional])
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== 'string' || !allowed.has(key))) return false
  if (required.some((key) => !keys.includes(key))) return false
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor !== undefined && 'value' in descriptor && descriptor.enumerable
  })
}

function readOwnDataProperty(
  value: Readonly<Record<string, unknown>>,
  key: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor && 'value' in descriptor ? descriptor.value : undefined
}

function hasExactArrayDataProperties(value: readonly unknown[]): boolean {
  const expectedKeys = new Set<string>(['length'])
  for (let index = 0; index < value.length; index += 1) {
    expectedKeys.add(String(index))
  }
  const keys = Reflect.ownKeys(value)
  if (
    keys.length !== expectedKeys.size
    || keys.some((key) => typeof key !== 'string' || !expectedKeys.has(key))
  ) {
    return false
  }
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor !== undefined && 'value' in descriptor
  })
}

function isDeeplyFrozenGraph(
  value: unknown,
  seen: WeakSet<object> = new WeakSet<object>(),
): boolean {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return true
  }
  try {
    if (typeof value === 'function') return false
    if (seen.has(value)) return true
    if (!Object.isFrozen(value)) return false
    const prototype = Object.getPrototypeOf(value)
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
      return false
    }
    seen.add(value)
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !('value' in descriptor)) return false
      if (!isDeeplyFrozenGraph(descriptor.value, seen)) return false
    }
    return true
  } catch {
    return false
  }
}
