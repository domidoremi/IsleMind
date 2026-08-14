import { err, ok, type Result } from '@/core'
import type {
  TavernActiveScopeLinksExportOptions,
  TavernSnapshot,
} from '../domain/tavernContracts'
import { TAVERN_SNAPSHOT_SCHEMA } from '../domain/tavernContracts'
import { normalizeTavernSnapshot } from '../domain/tavernSnapshotPolicy'
import { normalizeTavernWorkspaceImportState } from './tavernWorkspaceApplication'
import {
  normalizeTavernWorkspaceScopeId,
  TAVERN_WORKSPACE_REPOSITORY_SNAPSHOT_SCHEMA,
  TAVERN_WORKSPACE_SCOPE_RECORD_SCHEMA,
  type TavernWorkspaceRepository,
  type TavernWorkspaceRepositorySnapshot,
  type TavernWorkspaceReplacementScope,
  type TavernWorkspaceScopeRecord,
} from './tavernWorkspaceRepository'

export const TAVERN_PORTABLE_WORKSPACE_BACKUP_SCHEMA =
  'islemind.tavern-portable-workspace-backup.v1'

const DEFAULT_MAX_REPOSITORY_CHARACTERS = 16 * 1024 * 1024
const DEFAULT_MAX_BACKUP_CHARACTERS = 48 * 1024 * 1024
const MAX_SCOPE_COUNT = 512
const MAX_ACTIVE_SCOPE_LINK_COUNT = 2_048
const MAX_BACKUP_ID_CHARACTERS = 160
const MAX_DIGEST_CHARACTERS = 256

export type TavernPortableWorkspaceBackupCreateResult = 'created' | 'exists'

/** A durable compare-create store. Existing values must never be overwritten. */
export interface TavernPortableWorkspaceBackupStore {
  read(backupId: string, signal?: AbortSignal): Promise<string | null | undefined>
  create(
    backupId: string,
    value: string,
    signal?: AbortSignal,
  ): Promise<TavernPortableWorkspaceBackupCreateResult>
}

export interface TavernPortableWorkspaceDigestPort {
  digest(value: string, signal?: AbortSignal): string | Promise<string>
}

export interface TavernPortableWorkspaceImportDependencies {
  repository: Pick<TavernWorkspaceRepository<TavernSnapshot>, 'load' | 'replaceAll'>
  backups: TavernPortableWorkspaceBackupStore
  digest: TavernPortableWorkspaceDigestPort
  now: () => number
  maxRepositoryCharacters?: number
  maxBackupCharacters?: number
}

export interface TavernPortableWorkspaceImportInput {
  backupId: string
  entries: readonly {
    scopeId?: string
    snapshot: Partial<TavernSnapshot> | undefined
  }[]
  activeScopeLinks?: Record<string, string>
  activeScopeOptions?: TavernActiveScopeLinksExportOptions
}

export interface TavernPortableWorkspaceImportOptions {
  signal?: AbortSignal
}

export type TavernPortableWorkspaceImportStatus =
  | 'imported'
  | 'already_imported'
  | 'unchanged'
  | 'restored'
  | 'already_restored'

export interface TavernPortableWorkspaceImportOutcome {
  status: TavernPortableWorkspaceImportStatus
  backupId: string
  backupDigest: string
  sourceRepositoryRevision: number
  repositoryRevision: number
  effect: 'not_committed' | 'committed'
  cancellationObserved: boolean
}

export type TavernPortableWorkspaceImportErrorCode =
  | 'invalid_backup_id'
  | 'cancelled_before_effect'
  | 'cancelled_after_backup'
  | 'source_load_failed'
  | 'source_corrupt'
  | 'source_oversized'
  | 'source_drift'
  | 'target_invalid'
  | 'target_oversized'
  | 'target_commit_failed'
  | 'target_mismatch'
  | 'backup_not_found'
  | 'backup_store_failed'
  | 'backup_corrupt'
  | 'backup_oversized'
  | 'backup_mismatch'
  | 'digest_failed'
  | 'clock_invalid'

export type TavernPortableWorkspaceImportResult = Result<
  TavernPortableWorkspaceImportOutcome,
  TavernPortableWorkspaceImportErrorCode
>

export interface TavernPortableWorkspaceImportRuntime {
  importWorkspace(
    input: TavernPortableWorkspaceImportInput,
    options?: TavernPortableWorkspaceImportOptions,
  ): Promise<TavernPortableWorkspaceImportResult>
  restore(
    backupId: string,
    options?: TavernPortableWorkspaceImportOptions,
  ): Promise<TavernPortableWorkspaceImportResult>
}

interface DigestIdentity {
  digest: string
  characters: number
}

interface PortableBackupEnvelope {
  schema: typeof TAVERN_PORTABLE_WORKSPACE_BACKUP_SCHEMA
  backupId: string
  capturedAt: number
  mutationAt: number
  sourceExact: string
  sourceIdentity: DigestIdentity
  targetContents: string
  targetIdentity: DigestIdentity
}

interface PreparedRepository {
  snapshot: TavernWorkspaceRepositorySnapshot<TavernSnapshot>
  exact: string
  contents: string
}

interface PreparedReplacement {
  scopes: readonly TavernWorkspaceReplacementScope<TavernSnapshot>[]
  activeScopeLinks: Readonly<Record<string, string>>
  contents: string
}

interface PreparedBackup {
  envelope: PortableBackupEnvelope
  raw: string
  rawIdentity: DigestIdentity
  source: PreparedRepository
  target: PreparedReplacement
}

type EffectStage = 'none' | 'backup' | 'commit_unknown' | 'committed_verified'

class PortableImportFailure extends Error {
  constructor(
    readonly code: TavernPortableWorkspaceImportErrorCode,
    message: string,
    readonly retryable = false,
    readonly effect: EffectStage = 'none',
  ) {
    super(message)
  }
}

class CanonicalDataFailure extends Error {
  constructor(readonly oversized: boolean) {
    super(oversized ? 'Canonical data is oversized.' : 'Canonical data is invalid.')
  }
}

export function createTavernPortableWorkspaceImportRuntime(
  dependencies: TavernPortableWorkspaceImportDependencies,
): TavernPortableWorkspaceImportRuntime {
  const maxRepositoryCharacters = dependencies.maxRepositoryCharacters ?? DEFAULT_MAX_REPOSITORY_CHARACTERS
  const maxBackupCharacters = dependencies.maxBackupCharacters ?? DEFAULT_MAX_BACKUP_CHARACTERS
  if (!dependencies.repository || !dependencies.backups || !dependencies.digest ||
      typeof dependencies.now !== 'function' || !isPositiveLimit(maxRepositoryCharacters) ||
      !isPositiveLimit(maxBackupCharacters) || maxBackupCharacters < maxRepositoryCharacters) {
    throw new TypeError('The Tavern portable workspace import configuration is invalid.')
  }

  async function importWorkspace(
    input: TavernPortableWorkspaceImportInput,
    options: TavernPortableWorkspaceImportOptions = {},
  ): Promise<TavernPortableWorkspaceImportResult> {
    const backupId = readBackupId(input?.backupId)
    if (!backupId) return failure('invalid_backup_id', 'The Tavern portable backup identifier is invalid.')
    const signal = options.signal
    let stage: EffectStage = 'none'

    try {
      throwIfCancelled(signal, stage)
      const existingRaw = await readBackupRaw(backupId, signal)
      let backup: PreparedBackup

      if (existingRaw !== undefined) {
        stage = 'backup'
        backup = await prepareBackup(backupId, existingRaw, signal)
        const normalizedTarget = preparePortableTarget(
          input,
          backup.envelope.mutationAt,
          maxRepositoryCharacters,
        )
        if (normalizedTarget.contents !== backup.envelope.targetContents) {
          throw new PortableImportFailure(
            'backup_mismatch',
            'The Tavern portable import does not match its immutable backup target.',
            false,
            stage,
          )
        }
      } else {
        const mutationAt = readTimestamp(dependencies.now)
        const target = preparePortableTarget(input, mutationAt, maxRepositoryCharacters)
        const source = await loadRepository(signal, 'source')
        const envelope: PortableBackupEnvelope = {
          schema: TAVERN_PORTABLE_WORKSPACE_BACKUP_SCHEMA,
          backupId,
          capturedAt: mutationAt,
          mutationAt,
          sourceExact: source.exact,
          sourceIdentity: await identity(source.exact, maxRepositoryCharacters, signal),
          targetContents: target.contents,
          targetIdentity: await identity(target.contents, maxRepositoryCharacters, signal),
        }
        const raw = serializeBounded(envelope, maxBackupCharacters)
        throwIfCancelled(signal, stage)
        await createAndVerifyBackup(backupId, raw, signal)
        backup = await prepareBackup(backupId, raw, undefined)
        stage = 'backup'
      }

      throwIfCancelled(signal, stage)
      const current = await loadRepository(signal, 'source')
      const expectedImported = buildExpectedRepository(
        backup.target,
        checkedNextRevision(backup.source.snapshot.revision),
        backup.envelope.mutationAt,
        maxRepositoryCharacters,
      )

      if (current.exact === expectedImported.exact) {
        await verifyStableRepository(expectedImported.exact)
        await verifyBackupStillExact(backup)
        return outcome('already_imported', backup, current.snapshot.revision, false, signal)
      }
      if (current.exact !== backup.source.exact) {
        throw new PortableImportFailure(
          'source_drift',
          'The Tavern repository differs from the source captured by the immutable backup.',
          false,
          stage,
        )
      }
      if (current.contents === backup.target.contents) {
        await verifyStableRepository(current.exact)
        await verifyBackupStillExact(backup)
        return outcome('unchanged', backup, current.snapshot.revision, false, signal)
      }

      await verifyBackupStillExact(backup, signal)
      throwIfCancelled(signal, stage)
      return commitAndVerify({
        operation: 'import',
        status: 'imported',
        backup,
        replacement: backup.target,
        expectedRepositoryRevision: backup.source.snapshot.revision,
        updatedAt: backup.envelope.mutationAt,
        expected: expectedImported,
        signal,
      })
    } catch (error) {
      return mapFailure(error, signal, stage, backupId)
    }
  }

  async function restore(
    rawBackupId: string,
    options: TavernPortableWorkspaceImportOptions = {},
  ): Promise<TavernPortableWorkspaceImportResult> {
    const backupId = readBackupId(rawBackupId)
    if (!backupId) return failure('invalid_backup_id', 'The Tavern portable backup identifier is invalid.')
    const signal = options.signal
    let stage: EffectStage = 'none'

    try {
      throwIfCancelled(signal, stage)
      const raw = await readBackupRaw(backupId, signal)
      if (raw === undefined) {
        throw new PortableImportFailure('backup_not_found', 'The Tavern portable backup was not found.')
      }
      stage = 'backup'
      const backup = await prepareBackup(backupId, raw, signal)
      throwIfCancelled(signal, stage)

      const current = await loadRepository(signal, 'source')
      if (current.exact === backup.source.exact) {
        await verifyStableRepository(current.exact)
        await verifyBackupStillExact(backup)
        return outcome('already_restored', backup, current.snapshot.revision, false, signal)
      }

      const expectedImported = buildExpectedRepository(
        backup.target,
        checkedNextRevision(backup.source.snapshot.revision),
        backup.envelope.mutationAt,
        maxRepositoryCharacters,
      )
      const restoreReplacement = replacementFromRepository(backup.source, maxRepositoryCharacters)
      const expectedRestored = buildExpectedRepository(
        restoreReplacement,
        checkedNextRevision(expectedImported.snapshot.revision),
        backup.source.snapshot.updatedAt,
        maxRepositoryCharacters,
      )
      if (current.exact === expectedRestored.exact) {
        await verifyStableRepository(expectedRestored.exact)
        await verifyBackupStillExact(backup)
        return outcome('already_restored', backup, current.snapshot.revision, false, signal)
      }
      if (current.exact !== expectedImported.exact) {
        throw new PortableImportFailure(
          'source_drift',
          'The Tavern repository changed after import; restore refused to overwrite newer state.',
          false,
          stage,
        )
      }

      await verifyBackupStillExact(backup, signal)
      throwIfCancelled(signal, stage)
      return commitAndVerify({
        operation: 'restore',
        status: 'restored',
        backup,
        replacement: restoreReplacement,
        expectedRepositoryRevision: expectedImported.snapshot.revision,
        updatedAt: backup.source.snapshot.updatedAt,
        expected: expectedRestored,
        signal,
      })
    } catch (error) {
      return mapFailure(error, signal, stage, backupId)
    }
  }

  async function commitAndVerify(input: {
    operation: 'import' | 'restore'
    status: Extract<TavernPortableWorkspaceImportStatus, 'imported' | 'restored'>
    backup: PreparedBackup
    replacement: PreparedReplacement
    expectedRepositoryRevision: number
    updatedAt: number
    expected: PreparedRepository
    signal?: AbortSignal
  }): Promise<TavernPortableWorkspaceImportResult> {
    let cancellationObserved = false
    try {
      const receipt = await dependencies.repository.replaceAll({
        scopes: input.replacement.scopes,
        activeScopeLinks: input.replacement.activeScopeLinks,
        expectedRepositoryRevision: input.expectedRepositoryRevision,
        updatedAt: input.updatedAt,
      }, { signal: input.signal })
      if (!receipt.ok) {
        cancellationObserved = receipt.error.code === 'cancelled' || Boolean(input.signal?.aborted)
        const reconciled = await reconcileExpected(input.expected)
        if (!reconciled) {
          if (receipt.error.code === 'revision_conflict') {
            throw new PortableImportFailure(
              'source_drift',
              `The Tavern portable ${input.operation} repository revision changed before atomic replacement.`,
              true,
              'backup',
            )
          }
          throw new PortableImportFailure(
            'target_commit_failed',
            `The Tavern portable ${input.operation} replacement failed: ${receipt.error.code}.`,
            receipt.error.retryable,
            'commit_unknown',
          )
        }
      }
    } catch (error) {
      if (error instanceof PortableImportFailure) throw error
      const reconciled = await reconcileExpected(input.expected)
      if (!reconciled) {
        throw new PortableImportFailure(
          'target_commit_failed',
          `The Tavern portable ${input.operation} replacement threw before its commit could be verified.`,
          true,
          'commit_unknown',
        )
      }
      cancellationObserved = Boolean(input.signal?.aborted)
    }

    const reloaded = await loadRepository(undefined, 'target')
    if (reloaded.exact !== input.expected.exact) {
      throw new PortableImportFailure(
        'target_mismatch',
        `The Tavern portable ${input.operation} repository reload did not exactly match the committed target.`,
        false,
        'commit_unknown',
      )
    }
    try {
      await verifyBackupStillExact(input.backup)
    } catch (error) {
      if (error instanceof PortableImportFailure) {
        throw new PortableImportFailure(error.code, error.message, error.retryable, 'committed_verified')
      }
      throw error
    }
    return outcome(
      input.status,
      input.backup,
      reloaded.snapshot.revision,
      true,
      input.signal,
      cancellationObserved,
    )
  }

  async function reconcileExpected(expected: PreparedRepository): Promise<boolean> {
    try {
      const reloaded = await loadRepository(undefined, 'target')
      return reloaded.exact === expected.exact
    } catch {
      return false
    }
  }

  async function verifyStableRepository(expectedExact: string): Promise<void> {
    const reloaded = await loadRepository(undefined, 'target')
    if (reloaded.exact !== expectedExact) {
      throw new PortableImportFailure(
        'target_mismatch',
        'The Tavern repository changed during exact reload verification.',
        false,
        'commit_unknown',
      )
    }
  }

  async function loadRepository(
    signal: AbortSignal | undefined,
    role: 'source' | 'target',
  ): Promise<PreparedRepository> {
    let loaded
    try {
      loaded = await dependencies.repository.load({ signal })
    } catch {
      if (signal?.aborted) throw cancellationFailure('none')
      throw new PortableImportFailure(
        role === 'source' ? 'source_load_failed' : 'target_mismatch',
        `The Tavern portable ${role} repository could not be loaded.`,
        true,
        role === 'target' ? 'commit_unknown' : 'none',
      )
    }
    if (!loaded.ok) {
      if (loaded.error.code === 'cancelled') throw cancellationFailure('none')
      if (loaded.error.code === 'corrupt_record' || loaded.error.code === 'validation_failed') {
        throw new PortableImportFailure(
          role === 'source' ? 'source_corrupt' : 'target_mismatch',
          `The Tavern portable ${role} repository is corrupt or non-canonical.`,
          false,
          role === 'target' ? 'commit_unknown' : 'none',
        )
      }
      throw new PortableImportFailure(
        role === 'source' ? 'source_load_failed' : 'target_mismatch',
        `The Tavern portable ${role} repository load failed: ${loaded.error.code}.`,
        loaded.error.retryable,
        role === 'target' ? 'commit_unknown' : 'none',
      )
    }
    try {
      return prepareRepository(loaded.value, maxRepositoryCharacters)
    } catch (error) {
      const oversized = error instanceof CanonicalDataFailure && error.oversized
      throw new PortableImportFailure(
        role === 'source' && oversized ? 'source_oversized' : role === 'source' ? 'source_corrupt' : 'target_mismatch',
        oversized
          ? `The Tavern portable ${role} repository exceeds its size limit.`
          : `The Tavern portable ${role} repository is invalid or non-canonical.`,
        false,
        role === 'target' ? 'commit_unknown' : 'none',
      )
    }
  }

  async function readBackupRaw(
    backupId: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    try {
      const raw = await dependencies.backups.read(backupId, signal)
      if (raw == null) return undefined
      if (typeof raw !== 'string') throw new Error()
      if (raw.length > maxBackupCharacters) {
        throw new PortableImportFailure('backup_oversized', 'The Tavern portable backup exceeds its size limit.')
      }
      return raw
    } catch (error) {
      if (error instanceof PortableImportFailure) throw error
      if (signal?.aborted) throw cancellationFailure('none')
      throw new PortableImportFailure('backup_store_failed', 'The Tavern portable backup could not be read.', true)
    }
  }

  async function createAndVerifyBackup(
    backupId: string,
    raw: string,
    signal?: AbortSignal,
  ): Promise<void> {
    let createResult: TavernPortableWorkspaceBackupCreateResult
    try {
      createResult = await dependencies.backups.create(backupId, raw, signal)
    } catch {
      const observed = await readBackupRaw(backupId)
      if (observed === raw) return
      if (signal?.aborted && observed === undefined) throw cancellationFailure('none')
      throw new PortableImportFailure('backup_store_failed', 'The Tavern portable backup could not be created.', true)
    }
    if (createResult !== 'created' && createResult !== 'exists') {
      throw new PortableImportFailure('backup_store_failed', 'The Tavern portable backup store returned an invalid create result.')
    }
    const observed = await readBackupRaw(backupId)
    if (observed !== raw) {
      throw new PortableImportFailure(
        'backup_mismatch',
        'The Tavern portable backup could not be read back exactly after immutable creation.',
      )
    }
  }

  async function prepareBackup(
    backupId: string,
    raw: string,
    signal?: AbortSignal,
  ): Promise<PreparedBackup> {
    let envelope: PortableBackupEnvelope
    try {
      envelope = parseBackupEnvelope(raw, backupId, maxBackupCharacters)
    } catch (error) {
      throw new PortableImportFailure(
        error instanceof CanonicalDataFailure && error.oversized ? 'backup_oversized' : 'backup_corrupt',
        'The Tavern portable backup is invalid, non-canonical, or oversized.',
      )
    }
    let sourceIdentity: DigestIdentity
    let targetIdentity: DigestIdentity
    try {
      sourceIdentity = await identity(envelope.sourceExact, maxRepositoryCharacters, signal)
      targetIdentity = await identity(envelope.targetContents, maxRepositoryCharacters, signal)
    } catch (error) {
      if (error instanceof PortableImportFailure) throw error
      throw new PortableImportFailure(
        error instanceof CanonicalDataFailure && error.oversized ? 'backup_oversized' : 'backup_corrupt',
        'The Tavern portable backup payload exceeds its configured limit.',
      )
    }
    if (!sameIdentity(sourceIdentity, envelope.sourceIdentity) ||
        !sameIdentity(targetIdentity, envelope.targetIdentity)) {
      throw new PortableImportFailure('backup_mismatch', 'The Tavern portable backup content identity is invalid.')
    }
    let source: PreparedRepository
    let target: PreparedReplacement
    try {
      source = parseRepositoryExact(envelope.sourceExact, maxRepositoryCharacters)
      target = parseReplacementContents(envelope.targetContents, maxRepositoryCharacters)
    } catch (error) {
      throw new PortableImportFailure(
        error instanceof CanonicalDataFailure && error.oversized ? 'backup_oversized' : 'backup_corrupt',
        'The Tavern portable backup payload is invalid, non-canonical, or oversized.',
      )
    }
    let rawIdentity: DigestIdentity
    try {
      rawIdentity = await identity(raw, maxBackupCharacters, signal)
    } catch (error) {
      if (error instanceof PortableImportFailure) throw error
      throw new PortableImportFailure('backup_oversized', 'The Tavern portable backup exceeds its configured limit.')
    }
    return { envelope, raw, rawIdentity, source, target }
  }

  async function verifyBackupStillExact(
    backup: PreparedBackup,
    signal?: AbortSignal,
  ): Promise<void> {
    const raw = await readBackupRaw(backup.envelope.backupId, signal)
    if (raw !== backup.raw) {
      throw new PortableImportFailure(
        'backup_mismatch',
        'The Tavern portable backup changed after exact verification.',
        false,
        'backup',
      )
    }
  }

  async function identity(
    value: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<DigestIdentity> {
    if (value.length > limit) throw new CanonicalDataFailure(true)
    let digest: string
    try {
      digest = await dependencies.digest.digest(value, signal)
    } catch {
      if (signal?.aborted) throw cancellationFailure('none')
      throw new PortableImportFailure('digest_failed', 'The Tavern portable backup digest could not be calculated.', true)
    }
    if (!isBoundedText(digest, MAX_DIGEST_CHARACTERS)) {
      throw new PortableImportFailure('digest_failed', 'The Tavern portable backup digest is invalid.')
    }
    return { digest, characters: value.length }
  }

  return { importWorkspace, restore }
}

function preparePortableTarget(
  input: TavernPortableWorkspaceImportInput,
  operationTime: number,
  maxCharacters: number,
): PreparedReplacement {
  let normalized
  try {
    normalized = normalizeTavernWorkspaceImportState(
      input.entries,
      input.activeScopeLinks,
      input.activeScopeOptions,
      operationTime,
    )
  } catch {
    throw new PortableImportFailure('target_invalid', 'The Tavern portable import target is invalid.')
  }
  try {
    return prepareReplacement(normalized.scopes, normalized.activeScopeLinks, maxCharacters)
  } catch (error) {
    throw new PortableImportFailure(
      error instanceof CanonicalDataFailure && error.oversized ? 'target_oversized' : 'target_invalid',
      'The Tavern portable import target is invalid, non-canonical, or oversized.',
    )
  }
}

function prepareRepository(
  value: TavernWorkspaceRepositorySnapshot<TavernSnapshot>,
  maxCharacters: number,
): PreparedRepository {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, [
    'schema',
    'revision',
    'scopes',
    'activeScopeLinks',
    'updatedAt',
  ]) || value.schema !== TAVERN_WORKSPACE_REPOSITORY_SNAPSHOT_SCHEMA ||
      !isNonNegativeRevision(value.revision) || !isTimestamp(value.updatedAt) ||
      !Array.isArray(value.scopes) || value.scopes.length > MAX_SCOPE_COUNT ||
      !isPlainRecord(value.activeScopeLinks)) {
    throw new CanonicalDataFailure(false)
  }
  const scopeIds = new Set<string>()
  const scopes = value.scopes.map((scope): TavernWorkspaceScopeRecord<TavernSnapshot> => {
    if (!isPlainRecord(scope) || !hasOnlyKeys(scope, [
      'schema', 'scopeId', 'revision', 'snapshot', 'updatedAt',
    ]) || scope.schema !== TAVERN_WORKSPACE_SCOPE_RECORD_SCHEMA ||
        normalizeTavernWorkspaceScopeId(scope.scopeId) !== scope.scopeId ||
        !isPositiveRevision(scope.revision) || !isTimestamp(scope.updatedAt) ||
        scopeIds.has(scope.scopeId as string)) {
      throw new CanonicalDataFailure(false)
    }
    const snapshot = parsePortableCanonicalTavernSnapshot(scope.snapshot, maxCharacters)
    if (!snapshot) throw new CanonicalDataFailure(false)
    scopeIds.add(scope.scopeId as string)
    return {
      schema: TAVERN_WORKSPACE_SCOPE_RECORD_SCHEMA,
      scopeId: scope.scopeId as string,
      revision: scope.revision as number,
      snapshot,
      updatedAt: scope.updatedAt as number,
    }
  }).sort((left, right) => left.scopeId.localeCompare(right.scopeId))
  const activeScopeLinks = prepareLinks(value.activeScopeLinks, scopeIds)
  const snapshot: TavernWorkspaceRepositorySnapshot<TavernSnapshot> = {
    schema: TAVERN_WORKSPACE_REPOSITORY_SNAPSHOT_SCHEMA,
    revision: value.revision,
    scopes,
    activeScopeLinks,
    updatedAt: value.updatedAt,
  }
  const exact = serializeBounded(snapshot, maxCharacters)
  return {
    snapshot,
    exact,
    contents: serializeRepositoryContents(scopes, activeScopeLinks, maxCharacters),
  }
}

function prepareReplacement(
  rawScopes: readonly TavernWorkspaceReplacementScope<TavernSnapshot>[],
  rawLinks: Readonly<Record<string, string>>,
  maxCharacters: number,
): PreparedReplacement {
  if (!Array.isArray(rawScopes) || rawScopes.length > MAX_SCOPE_COUNT || !isPlainRecord(rawLinks)) {
    throw new CanonicalDataFailure(false)
  }
  const scopeIds = new Set<string>()
  const scopes = rawScopes.map((scope): TavernWorkspaceReplacementScope<TavernSnapshot> => {
    if (!isPlainRecord(scope) || !hasOnlyKeys(scope, ['scopeId', 'snapshot', 'updatedAt']) ||
        normalizeTavernWorkspaceScopeId(scope.scopeId) !== scope.scopeId ||
        !isTimestamp(scope.updatedAt) || scopeIds.has(scope.scopeId as string)) {
      throw new CanonicalDataFailure(false)
    }
    const snapshot = parsePortableCanonicalTavernSnapshot(scope.snapshot, maxCharacters)
    if (!snapshot) throw new CanonicalDataFailure(false)
    scopeIds.add(scope.scopeId as string)
    return {
      scopeId: scope.scopeId as string,
      snapshot,
      updatedAt: scope.updatedAt as number,
    }
  }).sort((left, right) => left.scopeId.localeCompare(right.scopeId))
  const activeScopeLinks = prepareLinks(rawLinks, scopeIds)
  return {
    scopes,
    activeScopeLinks,
    contents: serializeRepositoryContents(scopes, activeScopeLinks, maxCharacters),
  }
}

function prepareLinks(
  value: Readonly<Record<string, string>>,
  scopeIds: ReadonlySet<string>,
): Record<string, string> {
  const entries = Object.entries(value)
  if (entries.length > MAX_ACTIVE_SCOPE_LINK_COUNT) throw new CanonicalDataFailure(false)
  const links: Record<string, string> = {}
  for (const [conversationScopeId, activeScopeId] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    if (normalizeTavernWorkspaceScopeId(conversationScopeId) !== conversationScopeId ||
        normalizeTavernWorkspaceScopeId(activeScopeId) !== activeScopeId ||
        conversationScopeId === activeScopeId || !scopeIds.has(activeScopeId) ||
        Object.hasOwn(links, conversationScopeId)) {
      throw new CanonicalDataFailure(false)
    }
    links[conversationScopeId] = activeScopeId
  }
  return links
}

function buildExpectedRepository(
  replacement: PreparedReplacement,
  revision: number,
  updatedAt: number,
  maxCharacters: number,
): PreparedRepository {
  return prepareRepository({
    schema: TAVERN_WORKSPACE_REPOSITORY_SNAPSHOT_SCHEMA,
    revision,
    scopes: replacement.scopes.map((scope) => ({
      schema: TAVERN_WORKSPACE_SCOPE_RECORD_SCHEMA,
      scopeId: scope.scopeId,
      revision: 1,
      snapshot: scope.snapshot,
      updatedAt: scope.updatedAt ?? updatedAt,
    })),
    activeScopeLinks: replacement.activeScopeLinks,
    updatedAt,
  }, maxCharacters)
}

function replacementFromRepository(
  repository: PreparedRepository,
  maxCharacters: number,
): PreparedReplacement {
  return prepareReplacement(
    repository.snapshot.scopes.map((scope) => ({
      scopeId: scope.scopeId,
      snapshot: scope.snapshot,
      updatedAt: scope.updatedAt,
    })),
    repository.snapshot.activeScopeLinks,
    maxCharacters,
  )
}

function parseRepositoryExact(raw: string, maxCharacters: number): PreparedRepository {
  if (!isBoundedRaw(raw, maxCharacters)) throw new CanonicalDataFailure(raw.length > maxCharacters)
  const parsed = parseJson(raw) as TavernWorkspaceRepositorySnapshot<TavernSnapshot>
  const prepared = prepareRepository(parsed, maxCharacters)
  if (prepared.exact !== raw) throw new CanonicalDataFailure(false)
  return prepared
}

function parseReplacementContents(raw: string, maxCharacters: number): PreparedReplacement {
  if (!isBoundedRaw(raw, maxCharacters)) throw new CanonicalDataFailure(raw.length > maxCharacters)
  const parsed = parseJson(raw)
  if (!isPlainRecord(parsed) || !hasOnlyKeys(parsed, ['activeScopeLinks', 'scopes']) ||
      !Array.isArray(parsed.scopes) || !isPlainRecord(parsed.activeScopeLinks)) {
    throw new CanonicalDataFailure(false)
  }
  const prepared = prepareReplacement(
    parsed.scopes as TavernWorkspaceReplacementScope<TavernSnapshot>[],
    parsed.activeScopeLinks as Record<string, string>,
    maxCharacters,
  )
  if (prepared.contents !== raw) throw new CanonicalDataFailure(false)
  return prepared
}

function parsePortableCanonicalTavernSnapshot(
  value: unknown,
  maxCharacters: number,
): TavernSnapshot | undefined {
  if (!isPlainRecord(value) || value.schema !== TAVERN_SNAPSHOT_SCHEMA || !isTimestamp(value.updatedAt)) {
    return undefined
  }
  const normalized = normalizeTavernSnapshot(value, value.updatedAt as number)
  return serializeBounded(normalized, maxCharacters) === serializeBounded(value, maxCharacters)
    ? normalized
    : undefined
}

function parseBackupEnvelope(
  raw: string,
  expectedBackupId: string,
  maxCharacters: number,
): PortableBackupEnvelope {
  if (!isBoundedRaw(raw, maxCharacters)) throw new CanonicalDataFailure(raw.length > maxCharacters)
  const value = parseJson(raw)
  if (!isPlainRecord(value) || !hasOnlyKeys(value, [
    'backupId',
    'capturedAt',
    'mutationAt',
    'schema',
    'sourceExact',
    'sourceIdentity',
    'targetContents',
    'targetIdentity',
  ]) || value.schema !== TAVERN_PORTABLE_WORKSPACE_BACKUP_SCHEMA ||
      value.backupId !== expectedBackupId || !isTimestamp(value.capturedAt) ||
      !isTimestamp(value.mutationAt) || typeof value.sourceExact !== 'string' ||
      typeof value.targetContents !== 'string') {
    throw new CanonicalDataFailure(false)
  }
  const sourceIdentity = parseIdentity(value.sourceIdentity)
  const targetIdentity = parseIdentity(value.targetIdentity)
  if (!sourceIdentity || !targetIdentity ||
      sourceIdentity.characters !== value.sourceExact.length ||
      targetIdentity.characters !== value.targetContents.length) {
    throw new CanonicalDataFailure(false)
  }
  const envelope: PortableBackupEnvelope = {
    schema: TAVERN_PORTABLE_WORKSPACE_BACKUP_SCHEMA,
    backupId: expectedBackupId,
    capturedAt: value.capturedAt,
    mutationAt: value.mutationAt,
    sourceExact: value.sourceExact,
    sourceIdentity,
    targetContents: value.targetContents,
    targetIdentity,
  }
  if (serializeBounded(envelope, maxCharacters) !== raw) throw new CanonicalDataFailure(false)
  return envelope
}

function serializeRepositoryContents(
  scopes: readonly (TavernWorkspaceReplacementScope<TavernSnapshot> | TavernWorkspaceScopeRecord<TavernSnapshot>)[],
  activeScopeLinks: Readonly<Record<string, string>>,
  maxCharacters: number,
): string {
  return serializeBounded({
    scopes: [...scopes]
      .sort((left, right) => left.scopeId.localeCompare(right.scopeId))
      .map((scope) => ({
        scopeId: scope.scopeId,
        snapshot: scope.snapshot,
        updatedAt: scope.updatedAt,
      })),
    activeScopeLinks: Object.fromEntries(
      Object.entries(activeScopeLinks).sort(([left], [right]) => left.localeCompare(right)),
    ),
  }, maxCharacters)
}

function serializeBounded(value: unknown, maxCharacters: number): string {
  const seen = new Set<object>()
  const normalize = (candidate: unknown, depth: number): unknown => {
    if (depth > 64) throw new CanonicalDataFailure(false)
    if (candidate === null || typeof candidate === 'string' || typeof candidate === 'boolean') return candidate
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) throw new CanonicalDataFailure(false)
      return candidate
    }
    if (typeof candidate !== 'object' || seen.has(candidate)) throw new CanonicalDataFailure(false)
    seen.add(candidate)
    try {
      if (Array.isArray(candidate)) {
        const result: unknown[] = []
        for (let index = 0; index < candidate.length; index += 1) {
          if (!Object.hasOwn(candidate, index)) throw new CanonicalDataFailure(false)
          result.push(normalize(candidate[index], depth + 1))
        }
        return result
      }
      if (!isPlainRecord(candidate)) throw new CanonicalDataFailure(false)
      const result: Record<string, unknown> = {}
      for (const key of Object.keys(candidate).sort((left, right) => left.localeCompare(right))) {
        if (candidate[key] === undefined) continue
        result[key] = normalize(candidate[key], depth + 1)
      }
      return result
    } finally {
      seen.delete(candidate)
    }
  }
  const serialized = JSON.stringify(normalize(value, 0))
  if (!serialized) throw new CanonicalDataFailure(false)
  if (serialized.length > maxCharacters) throw new CanonicalDataFailure(true)
  return serialized
}

function outcome(
  status: TavernPortableWorkspaceImportStatus,
  backup: PreparedBackup,
  repositoryRevision: number,
  committed: boolean,
  signal?: AbortSignal,
  receiptFailed = false,
): TavernPortableWorkspaceImportResult {
  return ok({
    status,
    backupId: backup.envelope.backupId,
    backupDigest: backup.rawIdentity.digest,
    sourceRepositoryRevision: backup.source.snapshot.revision,
    repositoryRevision,
    effect: committed ? 'committed' : 'not_committed',
    cancellationObserved: Boolean(signal?.aborted || receiptFailed),
  })
}

function mapFailure(
  error: unknown,
  signal: AbortSignal | undefined,
  stage: EffectStage,
  backupId: string,
): TavernPortableWorkspaceImportResult {
  const resolved = error instanceof PortableImportFailure
    ? error.code === 'cancelled_before_effect' && stage !== 'none'
      ? cancellationFailure(stage)
      : error
    : signal?.aborted
      ? cancellationFailure(stage)
      : new PortableImportFailure('target_commit_failed', 'The Tavern portable workspace operation failed at an untrusted boundary.', true, stage)
  return err(resolved.code, resolved.message, {
    retryable: resolved.retryable,
    details: {
      backupId,
      effect: resolved.effect,
    },
  })
}

function cancellationFailure(stage: EffectStage): PortableImportFailure {
  return stage === 'none'
    ? new PortableImportFailure(
        'cancelled_before_effect',
        'The Tavern portable workspace operation was cancelled before any durable effect.',
        true,
      )
    : new PortableImportFailure(
        'cancelled_after_backup',
        'The Tavern portable workspace operation was cancelled after immutable backup persistence.',
        true,
        stage,
      )
}

function throwIfCancelled(signal: AbortSignal | undefined, stage: EffectStage): void {
  if (signal?.aborted) throw cancellationFailure(stage)
}

function failure(
  code: TavernPortableWorkspaceImportErrorCode,
  message: string,
): TavernPortableWorkspaceImportResult {
  return err(code, message, { retryable: false })
}

function readBackupId(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_BACKUP_ID_CHARACTERS) return undefined
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) ? value : undefined
}

function readTimestamp(now: () => number): number {
  let value: number
  try {
    value = now()
  } catch {
    throw new PortableImportFailure('clock_invalid', 'The Tavern portable workspace clock failed.')
  }
  if (!isTimestamp(value)) {
    throw new PortableImportFailure('clock_invalid', 'The Tavern portable workspace clock returned an invalid timestamp.')
  }
  return value
}

function checkedNextRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) {
    throw new PortableImportFailure('source_corrupt', 'The Tavern repository revision cannot be advanced safely.')
  }
  return value + 1
}

function parseIdentity(value: unknown): DigestIdentity | undefined {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ['characters', 'digest']) ||
      !isBoundedText(value.digest, MAX_DIGEST_CHARACTERS) ||
      !Number.isSafeInteger(value.characters) || (value.characters as number) < 0) {
    return undefined
  }
  return { digest: value.digest, characters: value.characters as number }
}

function sameIdentity(left: DigestIdentity, right: DigestIdentity): boolean {
  return left.digest === right.digest && left.characters === right.characters
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys)
  return Object.keys(value).length === expected.size && Object.keys(value).every((key) => expected.has(key))
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isBoundedRaw(value: string, maximum: number): boolean {
  return value.length > 0 && value.length <= maximum
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
}

function isTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function isNonNegativeRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function isPositiveRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function isPositiveLimit(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}
