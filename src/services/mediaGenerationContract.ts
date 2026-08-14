import {
  MEDIA_GENERATION_ADAPTER_GATE_IDS,
  MEDIA_GENERATION_ADAPTER_IMPLEMENTED,
  MEDIA_GENERATION_ARTIFACT_MANIFEST_SCHEMA,
  MEDIA_GENERATION_ARTIFACT_MAX_BYTES,
  MEDIA_GENERATION_DEFAULT_ENABLEMENT_AUDIT_SCHEMA,
  MEDIA_GENERATION_VIDEO_DURATION_MAX_MS,
  auditMediaGenerationDefaultEnablement,
  type MediaGenerationAdapterGateId,
  type MediaGenerationAdapterProofWorklistSummary,
  type MediaGenerationCancellationState,
  type MediaGenerationDefaultEnablementAudit,
  type MediaGenerationGateEvidence,
} from '@/core/mediaGenerationContracts'
import type { AIModel, AIProvider } from '@/types/providerContracts'
export const MEDIA_GENERATION_DISABLED_ADAPTER_PLAN_SCHEMA = 'islemind.media-generation-disabled-adapter-plan.v1'
export {
  MEDIA_GENERATION_ADAPTER_GATE_IDS,
  MEDIA_GENERATION_ADAPTER_IMPLEMENTED,
  MEDIA_GENERATION_ADAPTER_PROOF_WORKLIST_SCHEMA,
  MEDIA_GENERATION_ARTIFACT_MANIFEST_SCHEMA,
  MEDIA_GENERATION_ARTIFACT_MAX_BYTES,
  MEDIA_GENERATION_CANCELLATION_CLEANUP_CONTRACT_SCHEMA,
  MEDIA_GENERATION_DEFAULT_ENABLEMENT_AUDIT_SCHEMA,
  MEDIA_GENERATION_STREAM_CLEANUP_SCOPE,
  MEDIA_GENERATION_VIDEO_DURATION_MAX_MS,
  auditMediaGenerationDefaultEnablement,
  buildMediaGenerationCancellationCleanupContract,
  summarizeMediaGenerationAdapterProofWorklist,
  type MediaGenerationAdapterGateId,
  type MediaGenerationAdapterProofWorklistSummary,
  type MediaGenerationAdapterProofWorklistStatus,
  type MediaGenerationCancellationCleanupContract,
  type MediaGenerationCancellationState,
  type MediaGenerationDefaultEnablementAudit,
  type MediaGenerationDefaultEnablementStatus,
  type MediaGenerationGateEvidence,
} from '@/core/mediaGenerationContracts'

export type MediaGenerationArtifactKind = 'image' | 'video'
export type MediaGenerationArtifactRetentionClass = 'ephemeral-cache' | 'user-saved'
export type MediaGenerationArtifactCleanupState = 'scheduled' | 'completed' | 'not-required'
export type MediaGenerationProviderCapabilityKind = 'image-generation' | 'video-generation'
export type MediaGenerationProviderCapabilityEvidenceSource =
  | 'source-backed-model-metadata'
  | 'unsafe-provider-wide-declaration'
  | 'inferred-only'
  | 'missing'
export type MediaGenerationAdapterBlockedReason =
  | 'provider-capability-missing'
  | 'artifact-manifest-missing'
  | 'artifact-manifest-invalid'
  | 'adapter-not-implemented'
  | 'retention-cleanup-not-proven'
  | 'cancellation-semantics-not-proven'
  | 'native-proof-missing'
  | 'default-enable-gates-blocked'
export type MediaGenerationArtifactManifestIssue =
  | 'schema-mismatch'
  | 'unsupported-kind'
  | 'mime-kind-mismatch'
  | 'missing-local-uri'
  | 'raw-provider-uri-persisted'
  | 'raw-prompt-persisted'
  | 'base64-payload-persisted'
  | 'invalid-byte-size'
  | 'missing-dimensions'
  | 'invalid-video-duration'
  | 'missing-prompt-digest'
  | 'unsafe-retention'
  | 'missing-cleanup-state'
  | 'missing-cancellation-link'
  | 'missing-audit-event'
  | 'missing-native-proof'
  | 'missing-default-enable-gates'

export interface MediaGenerationArtifactManifest {
  schema: typeof MEDIA_GENERATION_ARTIFACT_MANIFEST_SCHEMA
  artifactId: string
  kind: MediaGenerationArtifactKind
  mimeType: string
  byteSize: number
  width: number
  height: number
  durationMs?: number
  localUri: string
  providerId: string
  model: string
  createdAt: string
  promptDigest: string
  sourceConversationId?: string
  sourceMessageId?: string
  retention: {
    class: MediaGenerationArtifactRetentionClass
    cleanupState: MediaGenerationArtifactCleanupState
    expiresAt?: string
  }
  cancellation: {
    requestId: string
    state: MediaGenerationCancellationState
    abortControllerLinked: boolean
  }
  audit: {
    eventId: string
    nativeProofId?: string
    gateIds: readonly MediaGenerationAdapterGateId[]
  }
}

export interface MediaGenerationArtifactManifestValidation {
  safeForDefaultEnablement: boolean
  issues: MediaGenerationArtifactManifestIssue[]
}

export interface MediaGenerationProviderCapabilityEvidence {
  kind: MediaGenerationProviderCapabilityKind
  providerId: string
  providerName: string
  model: string
  supported: boolean
  source: MediaGenerationProviderCapabilityEvidenceSource
  reason: string
  sourceUrl?: string
  verifiedAt?: string
}

export interface DisabledMediaGenerationAdapterPlan {
  schema: typeof MEDIA_GENERATION_DISABLED_ADAPTER_PLAN_SCHEMA
  kind: MediaGenerationProviderCapabilityKind
  providerId: string
  model: string
  canExecute: false
  executionDisabled: true
  capabilityEvidence: MediaGenerationProviderCapabilityEvidence
  artifactManifestValidation: MediaGenerationArtifactManifestValidation
  gateEvidence: MediaGenerationGateEvidence
  defaultEnablementAudit: MediaGenerationDefaultEnablementAudit
  blockedReasons: readonly MediaGenerationAdapterBlockedReason[]
}

interface MediaGenerationModelEvidence extends AIModel {
  supportsImageGeneration?: boolean
  supportsVideoGeneration?: boolean
  outputModalities?: string[]
  generation?: {
    image?: boolean
    video?: boolean
  }
}

export function collectMediaGenerationProviderGateEvidence(input: {
  provider: Pick<AIProvider, 'id' | 'name' | 'capabilities' | 'modelConfigs'>
  model: string
  kind: MediaGenerationProviderCapabilityKind
}): MediaGenerationGateEvidence {
  const capabilityEvidence = resolveMediaGenerationProviderCapabilityEvidence(input)
  return {
    'provider-capability-evidence': capabilityEvidence.supported,
  }
}

export function resolveMediaGenerationProviderCapabilityEvidence(input: {
  provider: Pick<AIProvider, 'id' | 'name' | 'capabilities' | 'modelConfigs'>
  model: string
  kind: MediaGenerationProviderCapabilityKind
}): MediaGenerationProviderCapabilityEvidence {
  const model = input.model.trim()
  const modelMetadata = input.provider.modelConfigs?.find((item) => item.id === model) as MediaGenerationModelEvidence | undefined
  const sourceBacked = !!modelMetadata?.sourceUrl && !!modelMetadata.verifiedAt && modelMetadata.source !== 'inferred'
  const declaredByModel = modelMetadataSupportsGeneration(modelMetadata, input.kind)
  if (declaredByModel && sourceBacked) {
    return {
      kind: input.kind,
      providerId: input.provider.id,
      providerName: input.provider.name,
      model,
      supported: true,
      source: 'source-backed-model-metadata',
      reason: 'generation output is declared by source-backed provider/model metadata',
      sourceUrl: modelMetadata.sourceUrl,
      verifiedAt: modelMetadata.verifiedAt,
    }
  }
  if (declaredByModel) {
    return {
      kind: input.kind,
      providerId: input.provider.id,
      providerName: input.provider.name,
      model,
      supported: false,
      source: 'inferred-only',
      reason: 'generation output was declared without source URL and verification date',
      sourceUrl: modelMetadata?.sourceUrl,
      verifiedAt: modelMetadata?.verifiedAt,
    }
  }

  const providerCapabilities = input.provider.capabilities as Record<string, unknown> | undefined
  const providerWideDeclaration = input.kind === 'image-generation'
    ? providerCapabilities?.imageGeneration === true
    : providerCapabilities?.videoGeneration === true
  if (providerWideDeclaration) {
    return {
      kind: input.kind,
      providerId: input.provider.id,
      providerName: input.provider.name,
      model,
      supported: false,
      source: 'unsafe-provider-wide-declaration',
      reason: 'provider-wide generation declaration is not enough without source-backed model metadata',
    }
  }

  return {
    kind: input.kind,
    providerId: input.provider.id,
    providerName: input.provider.name,
    model,
    supported: false,
    source: 'missing',
    reason: 'no source-backed provider/model generation metadata exists',
  }
}

export function buildDisabledMediaGenerationAdapterPlan(input: {
  provider: Pick<AIProvider, 'id' | 'name' | 'capabilities' | 'modelConfigs'>
  model: string
  kind: MediaGenerationProviderCapabilityKind
  artifactManifest?: unknown
  retentionCleanupProofId?: string
  cancellationSemanticsProofId?: string
  nativeProofId?: string
}): DisabledMediaGenerationAdapterPlan {
  const capabilityEvidence = resolveMediaGenerationProviderCapabilityEvidence(input)
  const artifactManifestValidation = input.artifactManifest === undefined
    ? { safeForDefaultEnablement: false, issues: ['schema-mismatch'] as MediaGenerationArtifactManifestIssue[] }
    : validateMediaGenerationArtifactManifest(input.artifactManifest)
  const gateEvidence: MediaGenerationGateEvidence = {
    'provider-capability-evidence': capabilityEvidence.supported,
    'generation-adapter': MEDIA_GENERATION_ADAPTER_IMPLEMENTED,
    'artifact-manifest': artifactManifestValidation.safeForDefaultEnablement,
    'retention-cleanup': artifactManifestValidation.safeForDefaultEnablement && !!input.retentionCleanupProofId,
    'cancellation-semantics': artifactManifestValidation.safeForDefaultEnablement && !!input.cancellationSemanticsProofId,
    'native-mobile-proof': artifactManifestValidation.safeForDefaultEnablement && !!input.nativeProofId,
  }
  const defaultEnablementAudit = auditMediaGenerationDefaultEnablement(gateEvidence)
  return {
    schema: MEDIA_GENERATION_DISABLED_ADAPTER_PLAN_SCHEMA,
    kind: input.kind,
    providerId: input.provider.id,
    model: input.model.trim(),
    canExecute: false,
    executionDisabled: true,
    capabilityEvidence,
    artifactManifestValidation,
    gateEvidence,
    defaultEnablementAudit,
    blockedReasons: resolveDisabledMediaGenerationAdapterBlockedReasons({
      capabilityEvidence,
      artifactManifestProvided: input.artifactManifest !== undefined,
      artifactManifestValidation,
      defaultEnablementAudit,
      retentionCleanupProofId: input.retentionCleanupProofId,
      cancellationSemanticsProofId: input.cancellationSemanticsProofId,
      nativeProofId: input.nativeProofId,
    }),
  }
}

export function validateMediaGenerationArtifactManifest(input: unknown): MediaGenerationArtifactManifestValidation {
  const manifest = input as Partial<MediaGenerationArtifactManifest> & Record<string, unknown>
  const issues: MediaGenerationArtifactManifestIssue[] = []

  if (!manifest || typeof manifest !== 'object') {
    return {
      safeForDefaultEnablement: false,
      issues: ['schema-mismatch'],
    }
  }

  if (manifest.schema !== MEDIA_GENERATION_ARTIFACT_MANIFEST_SCHEMA) issues.push('schema-mismatch')
  if (manifest.kind !== 'image' && manifest.kind !== 'video') issues.push('unsupported-kind')
  if (!mimeMatchesKind(manifest.mimeType, manifest.kind)) issues.push('mime-kind-mismatch')
  if (!isLocalArtifactUri(manifest.localUri)) issues.push('missing-local-uri')
  if (typeof manifest.providerUri === 'string' && manifest.providerUri.trim()) issues.push('raw-provider-uri-persisted')
  if (typeof manifest.rawPrompt === 'string' && manifest.rawPrompt.trim()) issues.push('raw-prompt-persisted')
  if (typeof manifest.base64Data === 'string' && manifest.base64Data.trim()) issues.push('base64-payload-persisted')
  if (!Number.isFinite(manifest.byteSize) || Number(manifest.byteSize) <= 0 || Number(manifest.byteSize) > MEDIA_GENERATION_ARTIFACT_MAX_BYTES) {
    issues.push('invalid-byte-size')
  }
  if (!Number.isFinite(manifest.width) || Number(manifest.width) <= 0 || !Number.isFinite(manifest.height) || Number(manifest.height) <= 0) {
    issues.push('missing-dimensions')
  }
  if (manifest.kind === 'video' && (!Number.isFinite(manifest.durationMs) || Number(manifest.durationMs) <= 0 || Number(manifest.durationMs) > MEDIA_GENERATION_VIDEO_DURATION_MAX_MS)) {
    issues.push('invalid-video-duration')
  }
  if (!isPromptDigest(manifest.promptDigest)) issues.push('missing-prompt-digest')
  if (!manifest.audit?.eventId) issues.push('missing-audit-event')
  if (!manifest.audit?.nativeProofId) issues.push('missing-native-proof')
  if (!manifest.audit?.gateIds || !MEDIA_GENERATION_ADAPTER_GATE_IDS.every((gateId) => manifest.audit?.gateIds?.includes(gateId))) {
    issues.push('missing-default-enable-gates')
  }

  const retentionClass = manifest.retention?.class
  if (retentionClass !== 'ephemeral-cache' && retentionClass !== 'user-saved') issues.push('unsafe-retention')
  if (retentionClass === 'ephemeral-cache') {
    if (!manifest.retention?.expiresAt || !['scheduled', 'completed'].includes(String(manifest.retention?.cleanupState))) {
      issues.push('missing-cleanup-state')
    }
  }
  if (retentionClass === 'user-saved' && manifest.retention?.cleanupState !== 'not-required') {
    issues.push('missing-cleanup-state')
  }

  if (!manifest.cancellation?.requestId || manifest.cancellation.abortControllerLinked !== true) {
    issues.push('missing-cancellation-link')
  }

  return {
    safeForDefaultEnablement: issues.length === 0,
    issues: unique(issues),
  }
}

function resolveDisabledMediaGenerationAdapterBlockedReasons(input: {
  capabilityEvidence: MediaGenerationProviderCapabilityEvidence
  artifactManifestProvided: boolean
  artifactManifestValidation: MediaGenerationArtifactManifestValidation
  defaultEnablementAudit: MediaGenerationDefaultEnablementAudit
  retentionCleanupProofId?: string
  cancellationSemanticsProofId?: string
  nativeProofId?: string
}): MediaGenerationAdapterBlockedReason[] {
  const reasons: MediaGenerationAdapterBlockedReason[] = []
  if (!input.capabilityEvidence.supported) reasons.push('provider-capability-missing')
  if (!MEDIA_GENERATION_ADAPTER_IMPLEMENTED) reasons.push('adapter-not-implemented')
  if (!input.artifactManifestProvided) reasons.push('artifact-manifest-missing')
  else if (!input.artifactManifestValidation.safeForDefaultEnablement) reasons.push('artifact-manifest-invalid')
  if (!input.retentionCleanupProofId) reasons.push('retention-cleanup-not-proven')
  if (!input.cancellationSemanticsProofId) reasons.push('cancellation-semantics-not-proven')
  if (!input.nativeProofId) reasons.push('native-proof-missing')
  if (input.defaultEnablementAudit.status !== 'ready-for-default-enable') reasons.push('default-enable-gates-blocked')
  return unique(reasons)
}

function mimeMatchesKind(mimeType: unknown, kind: unknown): boolean {
  if (typeof mimeType !== 'string') return false
  if (kind === 'image') return /^image\/[a-z0-9.+-]+$/i.test(mimeType)
  if (kind === 'video') return /^video\/[a-z0-9.+-]+$/i.test(mimeType)
  return false
}

function isLocalArtifactUri(value: unknown): boolean {
  return typeof value === 'string' && /^(file|content):\/\//.test(value)
}

function isPromptDigest(value: unknown): boolean {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/i.test(value)
}

function modelMetadataSupportsGeneration(modelMetadata: MediaGenerationModelEvidence | undefined, kind: MediaGenerationProviderCapabilityKind): boolean {
  if (!modelMetadata) return false
  if (kind === 'image-generation') {
    return modelMetadata.supportsImageGeneration === true ||
      modelMetadata.generation?.image === true ||
      modalityListIncludes(modelMetadata.outputModalities, ['image', 'images', 'image_generation', 'image-generation'])
  }
  return modelMetadata.supportsVideoGeneration === true ||
    modelMetadata.generation?.video === true ||
    modalityListIncludes(modelMetadata.outputModalities, ['video', 'videos', 'video_generation', 'video-generation'])
}

function modalityListIncludes(values: unknown, candidates: string[]): boolean {
  if (!Array.isArray(values)) return false
  const normalized = new Set(values.filter((item): item is string => typeof item === 'string').map((item) => item.toLowerCase()))
  return candidates.some((candidate) => normalized.has(candidate))
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items))
}
