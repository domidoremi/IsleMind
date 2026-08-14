export const MEDIA_GENERATION_ADAPTER_GATE_IDS = [
  'provider-capability-evidence',
  'generation-adapter',
  'artifact-manifest',
  'retention-cleanup',
  'cancellation-semantics',
  'native-mobile-proof',
] as const

export const MEDIA_GENERATION_ARTIFACT_MANIFEST_SCHEMA = 'islemind.media-generation-artifact-manifest.v1'
export const MEDIA_GENERATION_DEFAULT_ENABLEMENT_AUDIT_SCHEMA = 'islemind.media-generation-default-enablement-audit.v1'
export const MEDIA_GENERATION_ADAPTER_PROOF_WORKLIST_SCHEMA = 'islemind.media-generation-adapter-proof-worklist.v1'
export const MEDIA_GENERATION_CANCELLATION_CLEANUP_CONTRACT_SCHEMA = 'islemind.media-generation-cancellation-cleanup-contract.v1'
export const MEDIA_GENERATION_STREAM_CLEANUP_SCOPE = 'media-generation'
export const MEDIA_GENERATION_ARTIFACT_MAX_BYTES = 32 * 1024 * 1024
export const MEDIA_GENERATION_VIDEO_DURATION_MAX_MS = 600_000
export const MEDIA_GENERATION_ADAPTER_IMPLEMENTED = false

export type MediaGenerationAdapterGateId = typeof MEDIA_GENERATION_ADAPTER_GATE_IDS[number]
export type MediaGenerationAdapterProofWorklistStatus = 'pending' | 'blocked' | 'captured'
export type MediaGenerationCancellationState = 'cancellable' | 'cancelled' | 'completed'
export type MediaGenerationDefaultEnablementStatus = 'locked' | 'ready-for-default-enable'
export type MediaGenerationGateEvidence = Partial<Record<MediaGenerationAdapterGateId, boolean>>

export interface MediaGenerationDefaultEnablementAudit {
  schema: typeof MEDIA_GENERATION_DEFAULT_ENABLEMENT_AUDIT_SCHEMA
  status: MediaGenerationDefaultEnablementStatus
  ready: number
  total: number
  gateIds: readonly MediaGenerationAdapterGateId[]
  blockedGateIds: readonly MediaGenerationAdapterGateId[]
}

export interface MediaGenerationAdapterProofWorklistSummary {
  schema: typeof MEDIA_GENERATION_ADAPTER_PROOF_WORKLIST_SCHEMA
  status: MediaGenerationAdapterProofWorklistStatus
  gateCount: number
  rowCount: number
  pendingRows: number
  blockedRows: number
  capturedRows: number
  adapterImplemented: boolean
  composerExecutionActionAllowed: boolean
  defaultEnablementBlocked: boolean
}

export interface MediaGenerationCancellationCleanupContract {
  schema: typeof MEDIA_GENERATION_CANCELLATION_CLEANUP_CONTRACT_SCHEMA
  streamCleanupScope: typeof MEDIA_GENERATION_STREAM_CLEANUP_SCOPE
  artifactManifestSchema: typeof MEDIA_GENERATION_ARTIFACT_MANIFEST_SCHEMA
  cancellationGateId: Extract<MediaGenerationAdapterGateId, 'cancellation-semantics'>
  abortControllerRequired: true
  partialArtifactCleanupRequired: true
  cancellationManifestStateRequired: readonly MediaGenerationCancellationState[]
  adapterImplemented: boolean
  executionDisabled: boolean
}

const MEDIA_GENERATION_ADAPTER_PROOF_ROW_STATUSES: Record<
  MediaGenerationAdapterGateId,
  MediaGenerationAdapterProofWorklistStatus
> = {
  'provider-capability-evidence': 'pending',
  'generation-adapter': 'blocked',
  'artifact-manifest': 'pending',
  'retention-cleanup': 'pending',
  'cancellation-semantics': 'pending',
  'native-mobile-proof': 'pending',
}

export function auditMediaGenerationDefaultEnablement(
  evidence: MediaGenerationGateEvidence,
): MediaGenerationDefaultEnablementAudit {
  const blockedGateIds = MEDIA_GENERATION_ADAPTER_GATE_IDS.filter(
    (gateId) => evidence[gateId] !== true,
  )
  return {
    schema: MEDIA_GENERATION_DEFAULT_ENABLEMENT_AUDIT_SCHEMA,
    status: blockedGateIds.length > 0 ? 'locked' : 'ready-for-default-enable',
    ready: MEDIA_GENERATION_ADAPTER_GATE_IDS.length - blockedGateIds.length,
    total: MEDIA_GENERATION_ADAPTER_GATE_IDS.length,
    gateIds: MEDIA_GENERATION_ADAPTER_GATE_IDS,
    blockedGateIds,
  }
}

export function buildMediaGenerationCancellationCleanupContract(): MediaGenerationCancellationCleanupContract {
  return {
    schema: MEDIA_GENERATION_CANCELLATION_CLEANUP_CONTRACT_SCHEMA,
    streamCleanupScope: MEDIA_GENERATION_STREAM_CLEANUP_SCOPE,
    artifactManifestSchema: MEDIA_GENERATION_ARTIFACT_MANIFEST_SCHEMA,
    cancellationGateId: 'cancellation-semantics',
    abortControllerRequired: true,
    partialArtifactCleanupRequired: true,
    cancellationManifestStateRequired: ['cancellable', 'cancelled', 'completed'],
    adapterImplemented: MEDIA_GENERATION_ADAPTER_IMPLEMENTED,
    executionDisabled: !MEDIA_GENERATION_ADAPTER_IMPLEMENTED,
  }
}

export function summarizeMediaGenerationAdapterProofWorklist(): MediaGenerationAdapterProofWorklistSummary {
  const rowStatuses = MEDIA_GENERATION_ADAPTER_GATE_IDS.map(
    (gateId) => MEDIA_GENERATION_ADAPTER_PROOF_ROW_STATUSES[gateId],
  )
  const pendingRows = rowStatuses.filter((status) => status === 'pending').length
  const blockedRows = rowStatuses.filter((status) => status === 'blocked').length
  const capturedRows = rowStatuses.filter((status) => status === 'captured').length
  return {
    schema: MEDIA_GENERATION_ADAPTER_PROOF_WORKLIST_SCHEMA,
    status: 'pending',
    gateCount: MEDIA_GENERATION_ADAPTER_GATE_IDS.length,
    rowCount: rowStatuses.length,
    pendingRows,
    blockedRows,
    capturedRows,
    adapterImplemented: MEDIA_GENERATION_ADAPTER_IMPLEMENTED,
    composerExecutionActionAllowed: false,
    defaultEnablementBlocked:
      !MEDIA_GENERATION_ADAPTER_IMPLEMENTED
      || capturedRows !== rowStatuses.length
      || blockedRows > 0
      || pendingRows > 0,
  }
}
