import type { ModelOperationPermission } from './workflowSearchToolAdmissionPolicy'

const MODEL_OPERATION_AUTHORIZATION_ATTESTATION = Symbol('model-operation-authorization-attestation')

export type ModelOperationConfirmationStatus = 'not-required' | 'pending' | 'confirmed' | 'denied'

export interface ModelOperationCallCandidate {
  callId: string
  operationId: string
  arguments: unknown
}

/** Inputs supplied by bootstrap after resolving a trusted run, catalog, and confirmation. */
export interface TrustedModelOperationAuthorizationContext {
  runId: string
  catalogRevision: string
  permissionCeiling: ModelOperationPermission
  confirmationStatus: ModelOperationConfirmationStatus
}

export interface TrustedModelOperationDescriptor {
  id: string
  permission: ModelOperationPermission
  available: boolean
}

export interface ModelOperationAuthorizationAttestation {
  readonly [MODEL_OPERATION_AUTHORIZATION_ATTESTATION]: true
  readonly runId: string
  readonly callId: string
  readonly operationId: string
  readonly catalogRevision: string
  readonly argumentDigest: string
  readonly permissionCeiling: ModelOperationPermission
  readonly confirmationStatus: ModelOperationConfirmationStatus
  readonly idempotencyKey: string
}

export type ModelOperationAuthorizationFailureCode =
  | 'invalid_call'
  | 'operation_unavailable'
  | 'permission_denied'
  | 'confirmation_required'

export type ModelOperationAuthorizationResult =
  | { ok: true; value: ModelOperationAuthorizationAttestation }
  | { ok: false; code: ModelOperationAuthorizationFailureCode }

export interface ModelOperationAuthorizationVerification {
  runId: string
  callId: string
  operationId: string
  catalogRevision: string
  arguments: unknown
  permissionCeiling: ModelOperationPermission
  confirmationStatus: ModelOperationConfirmationStatus
}

export interface ModelOperationAuthorizationPolicyDependencies {
  resolveOperation(
    operationId: string,
    catalogRevision: string,
  ): TrustedModelOperationDescriptor | undefined
  digestArguments(argumentsValue: unknown): string
  buildIdempotencyKey(input: {
    runId: string
    callId: string
    operationId: string
    catalogRevision: string
    argumentDigest: string
  }): string
}

export interface ModelOperationAuthorizationPolicy {
  attest(
    context: TrustedModelOperationAuthorizationContext,
    candidate: ModelOperationCallCandidate,
  ): ModelOperationAuthorizationResult
  verify(
    attestation: ModelOperationAuthorizationAttestation,
    expected: ModelOperationAuthorizationVerification,
  ): boolean
}

/**
 * Binds model-proposed call data to catalog and user-confirmation facts that
 * are resolved outside model output. Callers must retain the opaque result;
 * verification rejects structurally forged objects.
 */
export function createModelOperationAuthorizationPolicy(
  dependencies: ModelOperationAuthorizationPolicyDependencies,
): ModelOperationAuthorizationPolicy {
  const issuedAttestations = new WeakSet<object>()

  return {
    attest(context, candidate) {
      const normalizedRunId = normalizeIdentifier(context.runId)
      const normalizedCallId = normalizeIdentifier(candidate.callId)
      const normalizedOperationId = normalizeIdentifier(candidate.operationId)
      const normalizedCatalogRevision = normalizeIdentifier(context.catalogRevision)
      if (!normalizedRunId || !normalizedCallId || !normalizedOperationId || !normalizedCatalogRevision) {
        return { ok: false, code: 'invalid_call' }
      }
      if (!isModelOperationPermission(context.permissionCeiling) ||
        !isConfirmationStatus(context.confirmationStatus)) {
        return { ok: false, code: 'permission_denied' }
      }

      const operation = dependencies.resolveOperation(normalizedOperationId, normalizedCatalogRevision)
      if (!operation || operation.id !== normalizedOperationId || !operation.available ||
        !isModelOperationPermission(operation.permission)) {
        return { ok: false, code: 'operation_unavailable' }
      }
      if (!permissionWithinCeiling(operation.permission, context.permissionCeiling)) {
        return { ok: false, code: 'permission_denied' }
      }
      if (context.confirmationStatus === 'denied') return { ok: false, code: 'permission_denied' }
      if (operation.permission === 'destructive' &&
        context.confirmationStatus !== 'pending' && context.confirmationStatus !== 'confirmed') {
        return { ok: false, code: 'confirmation_required' }
      }

      const argumentDigest = dependencies.digestArguments(candidate.arguments)
      if (!isBoundedText(argumentDigest, 256)) return { ok: false, code: 'invalid_call' }
      const idempotencyKey = dependencies.buildIdempotencyKey({
        runId: normalizedRunId,
        callId: normalizedCallId,
        operationId: normalizedOperationId,
        catalogRevision: normalizedCatalogRevision,
        argumentDigest,
      })
      if (!isBoundedText(idempotencyKey, 512)) return { ok: false, code: 'invalid_call' }

      const attestation: ModelOperationAuthorizationAttestation = Object.freeze({
        [MODEL_OPERATION_AUTHORIZATION_ATTESTATION]: true as const,
        runId: normalizedRunId,
        callId: normalizedCallId,
        operationId: normalizedOperationId,
        catalogRevision: normalizedCatalogRevision,
        argumentDigest,
        permissionCeiling: context.permissionCeiling,
        confirmationStatus: context.confirmationStatus,
        idempotencyKey,
      })
      issuedAttestations.add(attestation)
      return { ok: true, value: attestation }
    },

    verify(attestation, expected) {
      if (!issuedAttestations.has(attestation)) return false
      const runId = normalizeIdentifier(expected.runId)
      const callId = normalizeIdentifier(expected.callId)
      const operationId = normalizeIdentifier(expected.operationId)
      const catalogRevision = normalizeIdentifier(expected.catalogRevision)
      if (!runId || !callId || !operationId || !catalogRevision) return false
      if (!isModelOperationPermission(expected.permissionCeiling) ||
        !isConfirmationStatus(expected.confirmationStatus)) return false
      if (attestation.runId !== runId || attestation.callId !== callId ||
        attestation.operationId !== operationId || attestation.catalogRevision !== catalogRevision ||
        attestation.permissionCeiling !== expected.permissionCeiling ||
        attestation.confirmationStatus !== expected.confirmationStatus) {
        return false
      }
      const argumentDigest = dependencies.digestArguments(expected.arguments)
      if (attestation.argumentDigest !== argumentDigest) return false
      return attestation.idempotencyKey === dependencies.buildIdempotencyKey({
        runId,
        callId,
        operationId,
        catalogRevision,
        argumentDigest,
      })
    },
  }
}

function normalizeIdentifier(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (!isBoundedText(normalized, 160) || /[\u0000-\u001f\u007f]/.test(normalized)) return undefined
  return normalized
}

function isBoundedText(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximumLength
}

function isModelOperationPermission(value: unknown): value is ModelOperationPermission {
  return value === 'read-only' || value === 'read-write' || value === 'destructive'
}

function isConfirmationStatus(value: unknown): value is ModelOperationConfirmationStatus {
  return value === 'not-required' || value === 'pending' || value === 'confirmed' || value === 'denied'
}

function permissionWithinCeiling(
  permission: ModelOperationPermission,
  ceiling: ModelOperationPermission,
): boolean {
  return permissionRank(permission) <= permissionRank(ceiling)
}

function permissionRank(permission: ModelOperationPermission): number {
  switch (permission) {
    case 'read-only': return 0
    case 'read-write': return 1
    case 'destructive': return 2
  }
}
