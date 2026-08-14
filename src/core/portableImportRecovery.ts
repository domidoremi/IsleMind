import { err, ok, type Result } from './result'

export const PORTABLE_IMPORT_RECOVERY_ENVELOPE_SCHEMA =
  'islemind.portable-import-recovery.v1' as const

export const PORTABLE_IMPORT_RECOVERY_PHASES = [
  'preparing',
  'prepared',
  'applying',
  'rollback_required',
  'restored',
  'committed',
] as const

export type PortableImportRecoveryPhase =
  (typeof PORTABLE_IMPORT_RECOVERY_PHASES)[number]

export interface PortableImportRecoveryEnvelopeV1 {
  readonly schema: typeof PORTABLE_IMPORT_RECOVERY_ENVELOPE_SCHEMA
  readonly operationId: string
  readonly sourceDigest: string
  readonly revision: number
  readonly phase: PortableImportRecoveryPhase
  readonly participants: readonly string[]
  readonly preparedBackups: readonly PortableImportRecoveryBackupReference[]
  readonly appliedParticipantCount: number
  readonly activeParticipantIndex?: number
  readonly restoreParticipantIndex?: number
  readonly createdAt: number
  readonly updatedAt: number
}

export interface PortableImportRecoveryBackupReference {
  readonly participantId: string
  readonly digest: string
}

export type PortableImportRecoveryEnvelopeParseErrorCode =
  'invalid_portable_import_recovery_envelope'

export interface CreatePortableImportRecoveryEnvelopeInput {
  readonly operationId: string
  readonly sourceDigest: string
  readonly participants: readonly string[]
  readonly now: number
}

const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
const MAX_PARTICIPANTS = 32

export function createPortableImportRecoveryEnvelope(
  input: CreatePortableImportRecoveryEnvelopeInput,
): PortableImportRecoveryEnvelopeV1 {
  const envelope: PortableImportRecoveryEnvelopeV1 = {
    schema: PORTABLE_IMPORT_RECOVERY_ENVELOPE_SCHEMA,
    operationId: input.operationId,
    sourceDigest: input.sourceDigest,
    revision: 1,
    phase: 'preparing',
    participants: [...input.participants],
    preparedBackups: [],
    appliedParticipantCount: 0,
    createdAt: input.now,
    updatedAt: input.now,
  }
  const parsed = validatePortableImportRecoveryEnvelope(envelope)
  if (!parsed.ok) throw new TypeError(parsed.error.message)
  return parsed.value
}

export function parsePortableImportRecoveryEnvelope(
  value: unknown,
): Result<PortableImportRecoveryEnvelopeV1, PortableImportRecoveryEnvelopeParseErrorCode> {
  return validatePortableImportRecoveryEnvelope(value)
}

export function markPortableImportParticipantPrepared(
  envelope: PortableImportRecoveryEnvelopeV1,
  participantId: string,
  backupDigest: string,
  now: number,
): PortableImportRecoveryEnvelopeV1 {
  assertCurrentEnvelope(envelope)
  if (envelope.phase !== 'preparing') {
    throw new TypeError('Portable import participants can be prepared only during preparation.')
  }
  const expected = envelope.participants[envelope.preparedBackups.length]
  if (expected !== participantId || !SHA256_DIGEST_PATTERN.test(backupDigest)) {
    throw new TypeError('Portable import participants must be prepared in their declared order.')
  }
  return transition(envelope, {
    preparedBackups: [
      ...envelope.preparedBackups,
      Object.freeze({ participantId, digest: backupDigest }),
    ],
  }, now)
}

export function markPortableImportPrepared(
  envelope: PortableImportRecoveryEnvelopeV1,
  now: number,
): PortableImportRecoveryEnvelopeV1 {
  assertCurrentEnvelope(envelope)
  if (
    envelope.phase !== 'preparing' ||
    envelope.preparedBackups.length !== envelope.participants.length
  ) {
    throw new TypeError('Portable import preparation is incomplete.')
  }
  return transition(envelope, { phase: 'prepared' }, now)
}

export function beginPortableImportParticipant(
  envelope: PortableImportRecoveryEnvelopeV1,
  participantIndex: number,
  now: number,
): PortableImportRecoveryEnvelopeV1 {
  assertCurrentEnvelope(envelope)
  const expectedPhase = participantIndex === 0 ? 'prepared' : 'applying'
  if (
    envelope.phase !== expectedPhase ||
    envelope.activeParticipantIndex !== undefined ||
    envelope.appliedParticipantCount !== participantIndex ||
    participantIndex < 0 ||
    participantIndex >= envelope.participants.length
  ) {
    throw new TypeError('Portable import participant application is out of order.')
  }
  return transition(envelope, {
    phase: 'applying',
    activeParticipantIndex: participantIndex,
  }, now)
}

export function completePortableImportParticipant(
  envelope: PortableImportRecoveryEnvelopeV1,
  participantIndex: number,
  now: number,
): PortableImportRecoveryEnvelopeV1 {
  assertCurrentEnvelope(envelope)
  if (
    envelope.phase !== 'applying' ||
    envelope.activeParticipantIndex !== participantIndex ||
    envelope.appliedParticipantCount !== participantIndex
  ) {
    throw new TypeError('Portable import participant completion is out of order.')
  }
  return transition(envelope, {
    activeParticipantIndex: undefined,
    appliedParticipantCount: participantIndex + 1,
  }, now)
}

export function requirePortableImportRollback(
  envelope: PortableImportRecoveryEnvelopeV1,
  restoreParticipantIndex: number,
  now: number,
): PortableImportRecoveryEnvelopeV1 {
  assertCurrentEnvelope(envelope)
  if (
    (envelope.phase !== 'prepared' && envelope.phase !== 'applying') ||
    !Number.isSafeInteger(restoreParticipantIndex) ||
    restoreParticipantIndex < 0 ||
    restoreParticipantIndex >= envelope.participants.length
  ) {
    throw new TypeError('Portable import rollback target is invalid.')
  }
  const possibleEffectIndex = envelope.activeParticipantIndex ?? envelope.appliedParticipantCount - 1
  if (restoreParticipantIndex > possibleEffectIndex) {
    throw new TypeError('Portable import rollback cannot include an untouched participant.')
  }
  return transition(envelope, {
    phase: 'rollback_required',
    activeParticipantIndex: undefined,
    restoreParticipantIndex,
  }, now)
}

export function markPortableImportRestoredWithoutEffects(
  envelope: PortableImportRecoveryEnvelopeV1,
  now: number,
): PortableImportRecoveryEnvelopeV1 {
  assertCurrentEnvelope(envelope)
  if (
    (
      envelope.phase !== 'preparing' &&
      envelope.phase !== 'prepared' &&
      envelope.phase !== 'applying'
    ) ||
    envelope.appliedParticipantCount !== 0
  ) {
    throw new TypeError('Portable import cannot be restored without effects from this state.')
  }
  return transition(envelope, {
    phase: 'restored',
    activeParticipantIndex: undefined,
  }, now)
}

export function completePortableImportRestoreParticipant(
  envelope: PortableImportRecoveryEnvelopeV1,
  participantIndex: number,
  now: number,
): PortableImportRecoveryEnvelopeV1 {
  assertCurrentEnvelope(envelope)
  if (
    envelope.phase !== 'rollback_required' ||
    envelope.restoreParticipantIndex !== participantIndex
  ) {
    throw new TypeError('Portable import participant restoration is out of order.')
  }
  if (participantIndex === 0) {
    return transition(envelope, {
      phase: 'restored',
      appliedParticipantCount: 0,
      restoreParticipantIndex: undefined,
    }, now)
  }
  return transition(envelope, {
    appliedParticipantCount: Math.min(envelope.appliedParticipantCount, participantIndex),
    restoreParticipantIndex: participantIndex - 1,
  }, now)
}

export function markPortableImportCommitted(
  envelope: PortableImportRecoveryEnvelopeV1,
  now: number,
): PortableImportRecoveryEnvelopeV1 {
  assertCurrentEnvelope(envelope)
  if (
    envelope.phase !== 'applying' ||
    envelope.activeParticipantIndex !== undefined ||
    envelope.appliedParticipantCount !== envelope.participants.length
  ) {
    throw new TypeError('Portable import cannot commit before every participant is verified.')
  }
  return transition(envelope, { phase: 'committed' }, now)
}

function transition(
  envelope: PortableImportRecoveryEnvelopeV1,
  updates: Partial<PortableImportRecoveryEnvelopeV1>,
  now: number,
): PortableImportRecoveryEnvelopeV1 {
  const next = {
    ...envelope,
    ...updates,
    revision: envelope.revision + 1,
    updatedAt: now,
  }
  if (updates.activeParticipantIndex === undefined) delete next.activeParticipantIndex
  if (updates.restoreParticipantIndex === undefined) delete next.restoreParticipantIndex
  const parsed = validatePortableImportRecoveryEnvelope(next)
  if (!parsed.ok) throw new TypeError(parsed.error.message)
  return parsed.value
}

function assertCurrentEnvelope(envelope: PortableImportRecoveryEnvelopeV1): void {
  const parsed = validatePortableImportRecoveryEnvelope(envelope)
  if (!parsed.ok) throw new TypeError(parsed.error.message)
}

function validatePortableImportRecoveryEnvelope(
  value: unknown,
): Result<PortableImportRecoveryEnvelopeV1, PortableImportRecoveryEnvelopeParseErrorCode> {
  if (!isPlainRecord(value)) return invalidEnvelope()
  const candidate = value as Record<string, unknown>
  if (
    candidate.schema !== PORTABLE_IMPORT_RECOVERY_ENVELOPE_SCHEMA ||
    !isIdentifier(candidate.operationId) ||
    typeof candidate.sourceDigest !== 'string' ||
    !SHA256_DIGEST_PATTERN.test(candidate.sourceDigest) ||
    !isPositiveSafeInteger(candidate.revision) ||
    !isRecoveryPhase(candidate.phase) ||
    !isIdentifierArray(candidate.participants) ||
    candidate.participants.length === 0 ||
    candidate.participants.length > MAX_PARTICIPANTS ||
    new Set(candidate.participants).size !== candidate.participants.length ||
    !isBackupReferenceArray(candidate.preparedBackups) ||
    !isNonNegativeSafeInteger(candidate.appliedParticipantCount) ||
    candidate.appliedParticipantCount > candidate.participants.length ||
    !isTimestamp(candidate.createdAt) ||
    !isTimestamp(candidate.updatedAt) ||
    candidate.updatedAt < candidate.createdAt ||
    !isOptionalParticipantIndex(candidate.activeParticipantIndex, candidate.participants.length) ||
    !isOptionalParticipantIndex(candidate.restoreParticipantIndex, candidate.participants.length)
  ) {
    return invalidEnvelope()
  }

  const participants = candidate.participants as string[]
  const preparedBackups = candidate.preparedBackups as PortableImportRecoveryBackupReference[]
  if (
    preparedBackups.length > participants.length ||
    preparedBackups.some((backup, index) => backup.participantId !== participants[index])
  ) {
    return invalidEnvelope()
  }

  const appliedParticipantCount = candidate.appliedParticipantCount as number
  const activeParticipantIndex = candidate.activeParticipantIndex as number | undefined
  const restoreParticipantIndex = candidate.restoreParticipantIndex as number | undefined
  const phase = candidate.phase as PortableImportRecoveryPhase
  const fullyPrepared = preparedBackups.length === participants.length

  if (
    (phase === 'preparing' && (
      appliedParticipantCount !== 0 ||
      activeParticipantIndex !== undefined ||
      restoreParticipantIndex !== undefined
    )) ||
    (phase === 'prepared' && (
      !fullyPrepared ||
      appliedParticipantCount !== 0 ||
      activeParticipantIndex !== undefined ||
      restoreParticipantIndex !== undefined
    )) ||
    (phase === 'applying' && (
      !fullyPrepared ||
      restoreParticipantIndex !== undefined ||
      (activeParticipantIndex !== undefined && activeParticipantIndex !== appliedParticipantCount)
    )) ||
    (phase === 'rollback_required' && (
      !fullyPrepared ||
      activeParticipantIndex !== undefined ||
      restoreParticipantIndex === undefined ||
      restoreParticipantIndex > Math.max(0, appliedParticipantCount)
    )) ||
    (phase === 'restored' && (
      activeParticipantIndex !== undefined ||
      restoreParticipantIndex !== undefined ||
      appliedParticipantCount !== 0
    )) ||
    (phase === 'committed' && (
      !fullyPrepared ||
      activeParticipantIndex !== undefined ||
      restoreParticipantIndex !== undefined ||
      appliedParticipantCount !== participants.length
    ))
  ) {
    return invalidEnvelope()
  }

  return ok(Object.freeze({
    schema: PORTABLE_IMPORT_RECOVERY_ENVELOPE_SCHEMA,
    operationId: candidate.operationId as string,
    sourceDigest: candidate.sourceDigest as string,
    revision: candidate.revision as number,
    phase,
    participants: Object.freeze([...participants]),
    preparedBackups: Object.freeze(preparedBackups.map((backup) => Object.freeze({ ...backup }))),
    appliedParticipantCount,
    ...(activeParticipantIndex === undefined ? {} : { activeParticipantIndex }),
    ...(restoreParticipantIndex === undefined ? {} : { restoreParticipantIndex }),
    createdAt: candidate.createdAt as number,
    updatedAt: candidate.updatedAt as number,
  }))
}

function invalidEnvelope(): Result<never, PortableImportRecoveryEnvelopeParseErrorCode> {
  return err(
    'invalid_portable_import_recovery_envelope',
    'The portable import recovery envelope is invalid.',
  )
}

function isRecoveryPhase(value: unknown): value is PortableImportRecoveryPhase {
  return typeof value === 'string' &&
    (PORTABLE_IMPORT_RECOVERY_PHASES as readonly string[]).includes(value)
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value)
}

function isIdentifierArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isIdentifier)
}

function isBackupReferenceArray(
  value: unknown,
): value is PortableImportRecoveryBackupReference[] {
  return Array.isArray(value) && value.every((item) => (
    isPlainRecord(item) &&
    isIdentifier(item.participantId) &&
    typeof item.digest === 'string' &&
    SHA256_DIGEST_PATTERN.test(item.digest)
  ))
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function isTimestamp(value: unknown): value is number {
  return isNonNegativeSafeInteger(value)
}

function isOptionalParticipantIndex(value: unknown, participantCount: number): boolean {
  return value === undefined || (
    isNonNegativeSafeInteger(value) && value < participantCount
  )
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
