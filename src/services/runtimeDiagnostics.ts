import type { AIProvider, Settings } from '@/types'
import { getRuntimeLogInfo, readRuntimeLogText, type RuntimeLogEntry, type RuntimeLogInfo } from '@/services/runtimeLog'
import { RUNTIME_EVENT_HISTORY_LIMIT, RUNTIME_EVENT_SCHEMA, getRuntimeEventHistory, runtimeLogEventForRuntimeEvent, type RuntimeEventEnvelope } from '@/services/runtimeEvents'
import { buildRuntimeTimelineSnapshot, type RuntimeTimelineSnapshot } from '@/services/runtimeTimeline'
import { listCompactUsageRecords } from '@/services/ai/compact/compactUsage'
import {
  OBSERVABILITY_SINK_EXPORT_SCHEMA,
  OBSERVABILITY_SINK_PREVIEW_EVENT_LIMIT,
  buildObservabilitySinkExportPreview,
  evaluateObservabilitySinkPolicy,
  type ObservabilitySinkEndpointKind,
  type ObservabilitySinkExportPreviewStatus,
  type ObservabilitySinkHighFrequencyExportMode,
  type ObservabilitySinkMode,
  type ObservabilitySinkPolicyBlockReason,
  type ObservabilitySinkPolicyWarning,
  type ObservabilitySinkTarget,
} from '@/services/observabilityCompatibilityEvaluation'
import { safeHttpUrl } from '@/utils/networkUrlSafety'
import {
  buildProviderCapabilityMatrix,
  buildProviderCoverageBuckets,
  buildProviderModelCapabilityMatrix,
  summarizeProviderModelCapabilityProvider,
  type ProviderCapabilityArea,
  type ProviderHostingProfile,
  type ProviderModelCapabilityEvidenceSource,
  type ProviderModelCapabilityEvidenceStatus,
  type ProviderModelCapabilityKey,
  type ProviderModelCapabilityProviderSummary,
  type ProviderSupportLevel,
} from '@/services/ai/providerCapabilityMatrix'
import {
  buildProviderCompatibilityBehaviorStatusMap,
  explainProviderCompatibilityCapabilityStatus,
  getProviderCompatibilityEvidenceForProvider,
  getProviderCompatibilityLiveSmokeGates,
  providerCompatibilityCapabilityExplicitlyDeclaredByProvider,
  providerCompatibilityCapabilityCanBeSentForProvider,
  resolveProviderCompatibilityCapabilitySendPolicy,
  type ProviderCompatibilityAuditState,
  type ProviderCompatibilityBehavior,
  type ProviderCompatibilityCapabilitySendSource,
  type ProviderCompatibilityCapabilityStatus,
  type ProviderCompatibilityDegradationPath,
  type ProviderCompatibilityLimitationReason,
} from '@/services/ai/providerCompatibilityContract'

export const RUNTIME_DIAGNOSTICS_LOG_TAIL_BYTES = 12000
export const RUNTIME_DIAGNOSTICS_LOG_ENTRY_LIMIT = 120
export const RUNTIME_DIAGNOSTICS_TIMELINE_EVENT_LIMIT = 120
export const RUNTIME_DIAGNOSTICS_MEMORY_EVENT_LIMIT = RUNTIME_EVENT_HISTORY_LIMIT
export const RUNTIME_DIAGNOSTICS_OBSERVABILITY_PREVIEW_EVENT_LIMIT = OBSERVABILITY_SINK_PREVIEW_EVENT_LIMIT
const RUNTIME_DIAGNOSTICS_PROVIDER_HEAVY_LIMIT = 24
const RUNTIME_DIAGNOSTICS_MODEL_CAPABILITY_LIMIT = 32

export interface RuntimeDiagnosticsCapabilityStatusExample {
  providerId?: string
  providerName?: string
  compatibilityId: string
  capability: ProviderCompatibilityBehavior
  status: ProviderCompatibilityCapabilityStatus
  limitationReason: ProviderCompatibilityLimitationReason
  degradationPath: ProviderCompatibilityDegradationPath
  auditState: ProviderCompatibilityAuditState
  evidenceUrl?: string
  liveSmokeGates: string[]
}

export interface RuntimeDiagnosticsCapabilitySendPolicyExample {
  providerId?: string
  providerName?: string
  compatibilityId: string
  capability: ProviderCompatibilityBehavior
  status: ProviderCompatibilityCapabilityStatus
  allowed: boolean
  sendSource: ProviderCompatibilityCapabilitySendSource
  limitationReason: ProviderCompatibilityLimitationReason
  degradationPath: ProviderCompatibilityDegradationPath
  auditState: ProviderCompatibilityAuditState
  evidenceUrl?: string
}

export interface RuntimeDiagnosticsCapabilityMatrixExample {
  providerId?: string
  providerName?: string
  compatibilityId: string
  area: ProviderCapabilityArea
  level: ProviderSupportLevel
  reason: string
  contractStatus?: ProviderCompatibilityCapabilityStatus
  limitationReason?: ProviderCompatibilityLimitationReason
  degradationPath?: ProviderCompatibilityDegradationPath
}

export interface RuntimeDiagnosticsModelCapabilityExample {
  providerId?: string
  providerName?: string
  modelId: string
  capability: ProviderModelCapabilityKey
  status: ProviderModelCapabilityEvidenceStatus
  source: ProviderModelCapabilityEvidenceSource
  canSend: boolean
  reason: string
}

export interface RuntimeDiagnosticsRectificationExample {
  providerId?: string
  model?: string
  kind: string
  result: 'retrying' | 'success' | 'failed' | 'unknown'
  failedFields: string[]
  removedFields: string[]
  retainedFields: string[]
  status?: number
}

export type RuntimeDiagnosticsProviderHealthReason =
  | 'cooldown'
  | 'circuit_open'
  | 'quota_exhausted'
  | 'credential_unhealthy'

export interface RuntimeDiagnosticsProviderHealthExample {
  providerId?: string
  model?: string
  credentialGroupId?: string
  reason: RuntimeDiagnosticsProviderHealthReason
  trigger?: string
  status?: number
  cooldownUntilMs?: number
  circuitOpenUntilMs?: number
}

export interface RuntimeDiagnosticsSessionAffinityExample {
  providerId?: string
  model?: string
  credentialGroupId?: string
  status: 'resolved' | 'bound' | 'invalidated' | 'rotated' | 'unknown'
  trigger?: string
  upstreamStatus?: number
  fromGroupId?: string
  toGroupId?: string
  failoverCount?: number
}

export interface RuntimeDiagnosticsContextControlPlaneExample {
  providerId?: string
  model?: string
  event: 'context.planned' | 'context.compact.decided'
  contextManifestSchema?: string
  contextManifestFailureCodes?: string[]
  fragmentCount?: number
  cappedFragmentCount?: number
  cacheDiagnosticCount?: number
  compactMode?: string
  compactEnabled?: boolean
  compactReason?: string
  pressureRatio?: number
  tokensUntilCompaction?: number
}

export type RuntimeDiagnosticsRequestExampleKind =
  | 'route_snapshot'
  | 'fallback'
  | 'session_binding'
  | 'compact_decision'
  | 'conformance_block'

export interface RuntimeDiagnosticsRequestExample {
  kind: RuntimeDiagnosticsRequestExampleKind
  providerId?: string
  model?: string
  credentialGroupId?: string
  protocol?: string
  status?: string
  reason?: string
  trigger?: string
  selectedProviderId?: string
  selectedModel?: string
}

export type RuntimeDiagnosticsProviderUnavailableReason =
  | 'disabled'
  | 'sync_failed'
  | 'test_failed'
  | 'cooldown'
  | 'circuit_open'
  | 'quota_exhausted'
  | 'credential_unhealthy'
  | 'conformance_block'
  | 'fallback'

export interface RuntimeDiagnosticsProviderDetail {
  providerId: string
  declaredProtocol?: string
  readyProtocol?: string
  observedProtocol?: string
  credentialHealth: {
    total: number
    enabled: number
    healthy: number
    cooldown: number
    circuitOpen: number
    quotaExhausted: number
    credentialUnhealthy: number
  }
  sessionAffinity: {
    enabled: boolean
    status?: RuntimeDiagnosticsSessionAffinityExample['status']
    credentialGroupId?: string
    trigger?: string
  }
  lastUnavailableReason?: RuntimeDiagnosticsProviderUnavailableReason
  lastUnavailableDetail?: string
}

export type RuntimeDiagnosticsProxyWarning = 'custom_proxy_session_id_header'

export interface RuntimeDiagnosticsPerformanceSummary {
  logTailBytes: number
  logEntryLimit: number
  rawParsedLogEntries: number
  parsedLogEntries: number
  parsedLogEntryLimitApplied: boolean
  mergedLogEntries: number
  memoryEventLimit: number
  memoryEventEntries: number
  timelineEventLimit: number
  timelineInputEvents: number
  timelineOutputEvents: number
  buildDurationMs: number
}

export interface RuntimeDiagnosticsObservabilitySummary {
  schema: string
  mode: ObservabilitySinkMode
  target?: ObservabilitySinkTarget
  networkExportAllowed: boolean
  localDiagnosticsAllowed: boolean
  endpointKind: ObservabilitySinkEndpointKind
  effectiveAttributeLimit: number
  effectiveAttributeStringLimit: number
  highFrequencyExportMode: ObservabilitySinkHighFrequencyExportMode
  blockReasons: ObservabilitySinkPolicyBlockReason[]
  warnings: ObservabilitySinkPolicyWarning[]
  previewSchema: string
  previewStatus: ObservabilitySinkExportPreviewStatus
  previewExportable: boolean
  previewEventCount: number
  previewEventLimit: number
  previewEventLimitApplied: boolean
  previewSpanCount: number
  previewTraceId?: string
  previewFailureCodes: string[]
  previewAttributeLimitAppliedCount: number
  previewHighFrequencySuppressionCount: number
  previewSourceEventIdCount: number
}

export interface RuntimeDiagnosticsSummary {
  responses: {
    capableProviders: number
    readyProviders: number
    activeProtocols: Record<string, number>
  }
  websocket: {
    mode: NonNullable<Settings['transportMode']>
    capableProviders: number
    readyProviders: number
    enabled: boolean
    fallbackCount: number
  }
  compact: {
    mode: NonNullable<Settings['remoteCompactMode']>
    capableProviders: number
    readyProviders: number
    requestCount: number
    remoteRequestCount: number
    localCompressionCount: number
    localFallbackCount: number
    localEstimatedSavedTokens: number
    localAverageCompressionRatio: number
    completedCount: number
    failureCount: number
    estimatedSavedTokens: number
    fallbackReasons: {
      disabled: number
      belowThreshold: number
      providerCapabilityMissing: number
    }
  }
  policy: {
    payloadMode: NonNullable<Settings['payloadPolicyMode']>
    providerAllowRules: number
    providerBlockRules: number
    modelAllowRules: number
    modelBlockRules: number
  }
  rectification: {
    total: number
    retrying: number
    success: number
    failed: number
    unknown: number
    kindCounts: Record<string, number>
    recentExamples: RuntimeDiagnosticsRectificationExample[]
  }
  providerHealth: {
    cooldown: number
    circuitOpen: number
    quotaExhausted: number
    credentialUnhealthy: number
    recentExamples: RuntimeDiagnosticsProviderHealthExample[]
  }
  sessionAffinity: {
    resolved: number
    bound: number
    invalidated: number
    rotated: number
    recentExamples: RuntimeDiagnosticsSessionAffinityExample[]
  }
  contextControlPlane: {
    planned: number
    compactDecided: number
    fragmentIncluded: number
    fragmentExcluded: number
    cappedFragments: number
    cacheDiagnostics: number
    fullRewriteDetected: number
    unboundedBlocked: number
    manifests: number
    manifestIssues: number
    manifestFailureCodes: string[]
    recentExamples: RuntimeDiagnosticsContextControlPlaneExample[]
  }
  requestExamples: RuntimeDiagnosticsRequestExample[]
  timeline: RuntimeTimelineSnapshot
  performance: RuntimeDiagnosticsPerformanceSummary
  observability: RuntimeDiagnosticsObservabilitySummary
  proxy: {
    mode: NonNullable<Settings['proxyMode']>
    applied: boolean
    target?: string
    reason: 'off' | 'custom_base_url' | 'system_proxy_platform_stack' | 'invalid_custom_base_url'
    warnings: RuntimeDiagnosticsProxyWarning[]
  }
  log: RuntimeLogInfo & {
    enabled: boolean
    maxBytes: number
  }
  providers: {
    total: number
    enabled: number
    ready: number
    degraded: number
    manualModelProviders: number
    aliasProviders: number
  }
  providerDetails: RuntimeDiagnosticsProviderDetail[]
  capabilityMatrix: {
    hostingProfiles: Record<ProviderHostingProfile, number>
    supportLevels: Record<ProviderSupportLevel, number>
    statusExamples: Record<ProviderSupportLevel, RuntimeDiagnosticsCapabilityMatrixExample[]>
    partialProviders: number
    plannedProviders: number
    hostedGapProviders: number
    genericModelListSuppressedProviders: number
    modelCapabilityProviders: number
    modelCapabilityModels: number
    modelCapabilityStatuses: Record<ProviderModelCapabilityEvidenceStatus, number>
    modelCapabilityStatusExamples: Record<ProviderModelCapabilityEvidenceStatus, RuntimeDiagnosticsModelCapabilityExample[]>
    modelAdvancedSendableProviders: number
    modelAdvancedUnsupportedProviders: number
  }
  compatibility: {
    auditStates: Record<ProviderCompatibilityAuditState, number>
    capabilityStatuses: Record<ProviderCompatibilityCapabilityStatus, number>
    capabilityStatusExamples: Record<ProviderCompatibilityCapabilityStatus, RuntimeDiagnosticsCapabilityStatusExample[]>
    capabilityStatusTotal: number
    capabilitySendSources: Record<ProviderCompatibilityCapabilitySendSource, number>
    capabilitySendPolicyExamples: Record<ProviderCompatibilityCapabilitySendSource, RuntimeDiagnosticsCapabilitySendPolicyExample[]>
    capabilitySendPolicyTotal: number
    conformanceReadyProviders: number
    docsMappedProviders: number
    needsLiveSmokeProviders: number
    protocolReferenceProviders: number
    liveSmokeGateProviders: number
    liveSmokeGateCount: number
    loggedEvents: number
  }
}

export async function buildRuntimeDiagnosticsSummary(input: {
  providers: AIProvider[]
  settings: Settings
}): Promise<RuntimeDiagnosticsSummary> {
  const startedAt = Date.now()
  const providers = input.providers
  const settings = input.settings
  const enabledProviders = providers.filter((provider) => provider.enabled)
  const compactRecords = listCompactUsageRecords()
  const localCompressionRecords = compactRecords.filter((record) => hasLocalCompressionRecord(record))
  const localCompactRecords = compactRecords.filter((record) => record.fallbackLocal === true)
  const logInfo = await getRuntimeLogInfo()
  const parsedLog = parseRuntimeLogEntries(await readRuntimeLogText(RUNTIME_DIAGNOSTICS_LOG_TAIL_BYTES), RUNTIME_DIAGNOSTICS_LOG_ENTRY_LIMIT)
  const memoryEvents = getRuntimeEventHistory(RUNTIME_DIAGNOSTICS_MEMORY_EVENT_LIMIT)
  const logEntries = mergeRuntimeLogEntriesWithRuntimeEventHistory(parsedLog.entries, memoryEvents)
  const timelineEvents = runtimeEventsFromLogEntries(logEntries, RUNTIME_DIAGNOSTICS_TIMELINE_EVENT_LIMIT)
  const routeProtocolCounts = summarizeRouteProtocols(logEntries)
  const websocketFallbackCount = countRuntimeLogEntries(logEntries, 'transport.fallback')
  const requestRectificationSummary = summarizeRequestRectifications(logEntries)
  const providerHealthSummary = summarizeProviderHealthDiagnostics(logEntries)
  const sessionAffinitySummary = summarizeSessionAffinityDiagnostics(logEntries)
  const contextControlPlaneSummary = summarizeContextControlPlaneDiagnostics(logEntries)
  const requestExamples = summarizeRequestLevelExamples(logEntries)
  const timeline = buildRuntimeTimelineSnapshot(timelineEvents)
  const providerDetails = summarizeProviderRuntimeDetails(providers, settings, logEntries)
  const heavyProviders = providers.slice(0, RUNTIME_DIAGNOSTICS_PROVIDER_HEAVY_LIMIT)
  const providerMatrices = heavyProviders.map((provider) => ({
    provider,
    matrix: buildProviderCapabilityMatrix(provider),
    evidence: getProviderCompatibilityEvidenceForProvider(provider),
  }))
  const providerModelCapabilitySummaries = heavyProviders.map((provider) =>
    summarizeProviderModelCapabilityProvider(provider, runtimeDiagnosticsModelCapabilityIds(provider))
  )
  const compatibilityEvidence = heavyProviders.map((provider) => getProviderCompatibilityEvidenceForProvider(provider))
  const compatibilityAuditStates = summarizeCompatibilityAuditStates(compatibilityEvidence.map((evidence) => evidence.auditState))
  const compatibilityCapabilityStatuses = summarizeCompatibilityCapabilityStatuses(compatibilityEvidence.map((evidence) => evidence.id))
  const compatibilityCapabilityStatusExamples = summarizeCompatibilityCapabilityStatusExamples(heavyProviders)
  const compatibilityCapabilitySendSources = summarizeCompatibilityCapabilitySendSources(heavyProviders)
  const compatibilityCapabilitySendPolicyExamples = summarizeCompatibilityCapabilitySendPolicyExamples(heavyProviders)
  const compatibilityGateCounts = compatibilityEvidence.map((evidence) => getProviderCompatibilityLiveSmokeGates(evidence.id).length)
  return {
    responses: {
      capableProviders: providers.filter(providerSupportsResponsesApi).length,
      readyProviders: enabledProviders.filter(providerSupportsResponsesApi).length,
      activeProtocols: routeProtocolCounts,
    },
    websocket: {
      mode: settings.transportMode ?? 'auto',
      capableProviders: providers.filter(providerSupportsResponsesWebSocket).length,
      readyProviders: enabledProviders.filter(providerSupportsResponsesWebSocket).length,
      enabled: (settings.transportMode ?? 'auto') === 'websocket',
      fallbackCount: websocketFallbackCount,
    },
    compact: {
      mode: settings.remoteCompactMode ?? 'off',
      capableProviders: providers.filter(providerSupportsRemoteCompact).length,
      readyProviders: enabledProviders.filter(providerSupportsRemoteCompact).length,
      requestCount: compactRecords.length,
      remoteRequestCount: compactRecords.filter((record) => !record.fallbackLocal && !record.failureCode && typeof record.inputTokens === 'number' && typeof record.outputTokens !== 'number').length,
      localCompressionCount: localCompressionRecords.length,
      localFallbackCount: localCompactRecords.length,
      localEstimatedSavedTokens: sumFiniteNumbers(localCompressionRecords.map((record) => record.localEstimatedSavedTokens)),
      localAverageCompressionRatio: averageFiniteNumbers(localCompressionRecords.map((record) => record.localCompressionRatio)),
      completedCount: compactRecords.filter((record) => !record.failureCode && typeof record.outputTokens === 'number').length,
      failureCount: compactRecords.filter((record) => !!record.failureCode).length,
      estimatedSavedTokens: compactRecords.reduce((sum, record) => sum + (record.estimatedSavedTokens ?? 0), 0),
      fallbackReasons: {
        disabled: localCompactRecords.filter((record) => record.decisionReason === 'disabled').length,
        belowThreshold: localCompactRecords.filter((record) => record.decisionReason === 'below_threshold').length,
        providerCapabilityMissing: localCompactRecords.filter((record) => record.decisionReason === 'provider_capability_missing').length,
      },
    },
    policy: {
      payloadMode: settings.payloadPolicyMode ?? 'warn',
      providerAllowRules: settings.providerAllowlist?.length ?? 0,
      providerBlockRules: settings.providerBlocklist?.length ?? 0,
      modelAllowRules: settings.modelAllowlist?.length ?? 0,
      modelBlockRules: settings.modelBlocklist?.length ?? 0,
    },
    rectification: requestRectificationSummary,
    providerHealth: providerHealthSummary,
    sessionAffinity: sessionAffinitySummary,
    contextControlPlane: contextControlPlaneSummary,
    requestExamples,
    timeline,
    performance: {
      logTailBytes: RUNTIME_DIAGNOSTICS_LOG_TAIL_BYTES,
      logEntryLimit: RUNTIME_DIAGNOSTICS_LOG_ENTRY_LIMIT,
      rawParsedLogEntries: parsedLog.parsedCount,
      parsedLogEntries: parsedLog.entries.length,
      parsedLogEntryLimitApplied: parsedLog.limitApplied,
      mergedLogEntries: logEntries.length,
      memoryEventLimit: RUNTIME_DIAGNOSTICS_MEMORY_EVENT_LIMIT,
      memoryEventEntries: memoryEvents.length,
      timelineEventLimit: RUNTIME_DIAGNOSTICS_TIMELINE_EVENT_LIMIT,
      timelineInputEvents: timelineEvents.length,
      timelineOutputEvents: timeline.counts.total,
      buildDurationMs: Math.max(0, Date.now() - startedAt),
    },
    observability: buildRuntimeDiagnosticsObservabilitySummary(settings, timelineEvents),
    proxy: buildProxySummary(settings),
    log: {
      ...logInfo,
      enabled: settings.runtimeLogEnabled === true,
      maxBytes: settings.runtimeLogMaxBytes ?? 1048576,
    },
    providers: {
      total: providers.length,
      enabled: enabledProviders.length,
      ready: enabledProviders.filter((provider) => provider.lastTestStatus === 'ok' || provider.lastModelSyncStatus === 'ok').length,
      degraded: enabledProviders.filter((provider) => provider.lastTestStatus === 'bad' || provider.lastModelSyncStatus === 'bad').length,
      manualModelProviders: providers.filter((provider) => (provider.manualModels?.length ?? 0) > 0).length,
      aliasProviders: providers.filter((provider) => (provider.modelAliases?.length ?? 0) > 0).length,
    },
    providerDetails,
    capabilityMatrix: {
      hostingProfiles: buildProviderCoverageBuckets(heavyProviders),
      supportLevels: summarizeSupportLevels(providerMatrices.map((entry) => entry.matrix)),
      statusExamples: summarizeCapabilityMatrixStatusExamples(providerMatrices),
      partialProviders: providerMatrices.filter((entry) => entry.matrix.summaryLevel === 'partial').length,
      plannedProviders: providerMatrices.filter((entry) => entry.matrix.summaryLevel === 'planned').length,
      hostedGapProviders: providerMatrices.filter((entry) => entry.matrix.hostingProfile === 'cloud-hosted' && entry.matrix.summaryLevel === 'planned').length,
      genericModelListSuppressedProviders: providerMatrices.filter((entry) => entry.matrix.statuses.some((status) => status.area === 'modelCatalog' && status.reason.includes('generic model-list sync is intentionally disabled'))).length,
      modelCapabilityProviders: providerModelCapabilitySummaries.filter((summary) => summary.modelCount > 0).length,
      modelCapabilityModels: providerModelCapabilitySummaries.reduce((sum, summary) => sum + summary.modelCount, 0),
      modelCapabilityStatuses: summarizeProviderModelCapabilityStatuses(providerModelCapabilitySummaries),
      modelCapabilityStatusExamples: summarizeProviderModelCapabilityStatusExamples(heavyProviders),
      modelAdvancedSendableProviders: providerModelCapabilitySummaries.filter((summary) => summary.sendableAdvancedCapabilities.length > 0).length,
      modelAdvancedUnsupportedProviders: providerModelCapabilitySummaries.filter((summary) => summary.unsupportedAdvancedCapabilities.length > 0).length,
    },
    compatibility: {
      auditStates: compatibilityAuditStates,
      capabilityStatuses: compatibilityCapabilityStatuses,
      capabilityStatusExamples: compatibilityCapabilityStatusExamples,
      capabilityStatusTotal: Object.values(compatibilityCapabilityStatuses).reduce((sum, count) => sum + count, 0),
      capabilitySendSources: compatibilityCapabilitySendSources,
      capabilitySendPolicyExamples: compatibilityCapabilitySendPolicyExamples,
      capabilitySendPolicyTotal: Object.values(compatibilityCapabilitySendSources).reduce((sum, count) => sum + count, 0),
      conformanceReadyProviders: compatibilityAuditStates['conformance-ready'],
      docsMappedProviders: compatibilityAuditStates['docs-mapped'],
      needsLiveSmokeProviders: compatibilityAuditStates['needs-live-smoke'],
      protocolReferenceProviders: compatibilityAuditStates['protocol-reference'],
      liveSmokeGateProviders: compatibilityGateCounts.filter((count) => count > 0).length,
      liveSmokeGateCount: compatibilityGateCounts.reduce((sum, count) => sum + count, 0),
      loggedEvents: countRuntimeLogEntries(logEntries, 'provider.compatibility'),
    },
  }
}

function modelCapabilityCanBeSentFromStatus(capability: ProviderModelCapabilityKey, status: ProviderModelCapabilityEvidenceStatus): boolean {
  if (status === 'unsupported') return false
  if (capability === 'chat' || capability === 'streaming') return true
  return status === 'verified' || status === 'manual'
}

function buildRuntimeDiagnosticsObservabilitySummary(
  settings: Settings,
  events: RuntimeEventEnvelope[] = [],
): RuntimeDiagnosticsObservabilitySummary {
  const policyInput = {
    mode: settings.observabilitySinkMode ?? 'off',
    target: settings.observabilitySinkTarget,
    endpointUrl: settings.observabilitySinkEndpointUrl,
    apiKeyConfigured: settings.observabilitySinkApiKeyConfigured === true,
    userOptIn: settings.observabilitySinkUserOptIn === true,
    workspaceConsent: settings.observabilitySinkWorkspaceConsent === true,
    developmentOnly: settings.observabilitySinkDevelopmentOnly === true,
    allowRawPayloads: settings.observabilitySinkAllowRawPayloads === true,
    exportSchema: OBSERVABILITY_SINK_EXPORT_SCHEMA,
    redactionStrategy: 'observability-sink-redaction-v1',
    attributeLimit: settings.observabilitySinkAttributeLimit,
    attributeStringLimit: settings.observabilitySinkAttributeStringLimit,
    highFrequencyExportMode: settings.observabilitySinkHighFrequencyExportMode ?? 'coalesced',
  } as const
  const decision = evaluateObservabilitySinkPolicy(policyInput)
  const preview = buildObservabilitySinkExportPreview(events, {
    ...policyInput,
    eventLimit: RUNTIME_DIAGNOSTICS_OBSERVABILITY_PREVIEW_EVENT_LIMIT,
  })
  return {
    schema: decision.schema,
    mode: decision.mode,
    target: decision.target,
    networkExportAllowed: decision.networkExportAllowed,
    localDiagnosticsAllowed: decision.localDiagnosticsAllowed,
    endpointKind: decision.endpointKind,
    effectiveAttributeLimit: decision.effectiveAttributeLimit,
    effectiveAttributeStringLimit: decision.effectiveAttributeStringLimit,
    highFrequencyExportMode: decision.highFrequencyExportMode,
    blockReasons: decision.blockReasons,
    warnings: decision.warnings,
    previewSchema: preview.schema,
    previewStatus: preview.status,
    previewExportable: preview.exportable,
    previewEventCount: preview.eventCount,
    previewEventLimit: preview.eventLimit,
    previewEventLimitApplied: preview.eventLimitApplied,
    previewSpanCount: preview.spanCount,
    previewTraceId: preview.traceId,
    previewFailureCodes: preview.failureCodes,
    previewAttributeLimitAppliedCount: preview.diagnostic?.attributeLimitAppliedCount ?? 0,
    previewHighFrequencySuppressionCount: preview.diagnostic?.highFrequencySuppressionCount ?? 0,
    previewSourceEventIdCount: preview.diagnostic?.sourceEventIdCount ?? 0,
  }
}

function hasLocalCompressionRecord(record: ReturnType<typeof listCompactUsageRecords>[number]): boolean {
  return typeof record.localCompressedTokens === 'number' ||
    typeof record.localEstimatedSavedTokens === 'number' ||
    record.localCompressionStrategy === 'structured-v2' ||
    record.localCompressionStrategy === 'single-message-truncation'
}

function providerSupportsResponsesApi(provider: AIProvider): boolean {
  return provider.capabilities?.responsesApi === true &&
    providerCompatibilityCapabilityCanBeSentForProvider(provider, 'responsesApi', true)
}

function providerSupportsResponsesWebSocket(provider: AIProvider): boolean {
  return providerSupportsResponsesApi(provider) &&
    provider.capabilities?.responsesWebSocket === true &&
    providerCompatibilityCapabilityCanBeSentForProvider(provider, 'responsesWebSocket', true)
}

function providerSupportsRemoteCompact(provider: AIProvider): boolean {
  return providerSupportsResponsesApi(provider) &&
    provider.capabilities?.remoteCompact === true &&
    providerCompatibilityCapabilityCanBeSentForProvider(provider, 'remoteCompact', true)
}

function sumFiniteNumbers(values: Array<number | undefined>): number {
  return values.reduce<number>((sum, value) => Number.isFinite(value) ? sum + value! : sum, 0)
}

function averageFiniteNumbers(values: Array<number | undefined>): number {
  const finiteValues = values.filter((value): value is number => Number.isFinite(value))
  if (!finiteValues.length) return 0
  return Math.round((finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length) * 1000) / 1000
}

function countRuntimeLogEntries(entries: RuntimeLogEntry[], event: string): number {
  return entries.filter((entry) => entry.event === event).length
}

function summarizeRequestRectifications(entries: RuntimeLogEntry[]): RuntimeDiagnosticsSummary['rectification'] {
  const rectifications = entries.filter((entry) => entry.event === 'request.rectification')
  const summary: RuntimeDiagnosticsSummary['rectification'] = {
    total: rectifications.length,
    retrying: 0,
    success: 0,
    failed: 0,
    unknown: 0,
    kindCounts: {},
    recentExamples: [],
  }
  for (const entry of rectifications) {
    const result = normalizeRectificationResult(entry.result)
    summary[result] += 1
    const kind = typeof entry.kind === 'string' && entry.kind.trim() ? entry.kind : 'unknown'
    summary.kindCounts[kind] = (summary.kindCounts[kind] ?? 0) + 1
  }
  summary.recentExamples = rectifications.slice(-3).reverse().map((entry) => ({
    providerId: typeof entry.providerId === 'string' ? entry.providerId : undefined,
    model: typeof entry.model === 'string' ? entry.model : undefined,
    kind: typeof entry.kind === 'string' && entry.kind.trim() ? entry.kind : 'unknown',
    result: normalizeRectificationResult(entry.result),
    failedFields: runtimeLogStringArray(entry.failedFields),
    removedFields: runtimeLogStringArray(entry.removedFields),
    retainedFields: runtimeLogStringArray(entry.retainedFields),
    status: typeof entry.status === 'number' ? entry.status : undefined,
  }))
  return summary
}

function normalizeRectificationResult(value: unknown): RuntimeDiagnosticsRectificationExample['result'] {
  return value === 'retrying' || value === 'success' || value === 'failed' ? value : 'unknown'
}

function runtimeLogStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function uniqueRuntimeStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim()))).slice(0, 12)
}

function summarizeRouteProtocols(entries: RuntimeLogEntry[]): Record<string, number> {
  return entries.reduce<Record<string, number>>((acc, entry) => {
    if (entry.event !== 'provider.conformance') return acc
    const protocol = typeof entry.protocol === 'string' ? entry.protocol : undefined
    if (!protocol) return acc
    acc[protocol] = (acc[protocol] ?? 0) + 1
    return acc
  }, {})
}

interface RuntimeDiagnosticsParsedLogEntries {
  entries: RuntimeLogEntry[]
  parsedCount: number
  limitApplied: boolean
}

function parseRuntimeLogEntries(text: string, limit = RUNTIME_DIAGNOSTICS_LOG_ENTRY_LIMIT): RuntimeDiagnosticsParsedLogEntries {
  if (!text.trim()) return { entries: [], parsedCount: 0, limitApplied: false }
  const parsed = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as RuntimeLogEntry
      } catch {
        return null
      }
    })
    .filter((entry): entry is RuntimeLogEntry => !!entry && typeof entry.event === 'string')
  const normalizedLimit = normalizeDiagnosticsLimit(limit)
  return {
    entries: normalizedLimit === 0 ? [] : parsed.slice(-normalizedLimit),
    parsedCount: parsed.length,
    limitApplied: normalizedLimit > 0 && parsed.length > normalizedLimit,
  }
}

function mergeRuntimeLogEntriesWithRuntimeEventHistory(
  entries: RuntimeLogEntry[],
  history: RuntimeEventEnvelope[] = getRuntimeEventHistory(RUNTIME_DIAGNOSTICS_MEMORY_EVENT_LIMIT),
): RuntimeLogEntry[] {
  const seenRuntimeEventIds = new Set<string>()
  for (const entry of entries) {
    const id = runtimeString(runtimeObject(entry.runtimeEvent)?.id)
    if (id) seenRuntimeEventIds.add(id)
  }
  const historyEntries = history
    .filter((event) => !seenRuntimeEventIds.has(event.id))
    .map(runtimeEventEnvelopeToLogEntry)
  return [...entries, ...historyEntries]
}

function runtimeEventEnvelopeToLogEntry(envelope: RuntimeEventEnvelope): RuntimeLogEntry {
  return {
    schema: 'islemind.runtime-log.v1',
    ts: envelope.ts,
    event: runtimeLogEventForRuntimeEvent(envelope.event),
    conversationId: envelope.conversationId,
    providerId: envelope.providerId,
    credentialGroupId: envelope.credentialGroupId,
    model: envelope.model,
    runtimeEvent: envelope,
  }
}

function runtimeEventsFromLogEntries(entries: RuntimeLogEntry[], limit = RUNTIME_DIAGNOSTICS_TIMELINE_EVENT_LIMIT): RuntimeEventEnvelope[] {
  const events = entries
    .map((entry) => entry.runtimeEvent)
    .filter((event): event is RuntimeEventEnvelope => isRuntimeEventEnvelope(event))
  const normalizedLimit = normalizeDiagnosticsLimit(limit)
  return normalizedLimit === 0 ? [] : events.slice(-normalizedLimit)
}

function isRuntimeEventEnvelope(value: unknown): value is RuntimeEventEnvelope {
  const record = runtimeObject(value)
  return runtimeString(record?.schema) === RUNTIME_EVENT_SCHEMA &&
    typeof record?.id === 'string' &&
    typeof record?.ts === 'string' &&
    typeof record?.event === 'string' &&
    Boolean(runtimeObject(record?.data))
}

function buildProxySummary(settings: Settings): RuntimeDiagnosticsSummary['proxy'] {
  const mode = settings.proxyMode ?? 'off'
  const warnings = buildProxyWarnings(settings)
  if (mode === 'off') return { mode, applied: false, reason: 'off', warnings }
  if (mode === 'system-detected') return { mode, applied: true, reason: 'system_proxy_platform_stack', warnings }
  const target = safeHttpUrl(settings.proxyBaseUrl)
  return target
    ? { mode, applied: true, target, reason: 'custom_base_url', warnings }
    : { mode, applied: false, reason: 'invalid_custom_base_url', warnings }
}

function buildProxyWarnings(settings: Settings): RuntimeDiagnosticsProxyWarning[] {
  const mode = settings.proxyMode ?? 'off'
  if (mode !== 'custom-base-url') return []
  if (settings.sessionAffinityEnabled !== true) return []
  if (!safeHttpUrl(settings.proxyBaseUrl)) return []
  return ['custom_proxy_session_id_header']
}

function normalizeDiagnosticsLimit(limit: unknown): number {
  return typeof limit === 'number' && Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0
}

function summarizeProviderHealthDiagnostics(entries: RuntimeLogEntry[]): RuntimeDiagnosticsSummary['providerHealth'] {
  const summary: RuntimeDiagnosticsSummary['providerHealth'] = {
    cooldown: 0,
    circuitOpen: 0,
    quotaExhausted: 0,
    credentialUnhealthy: 0,
    recentExamples: [],
  }
  const examples: RuntimeDiagnosticsProviderHealthExample[] = []
  for (const entry of entries) {
    const runtimeEventData = runtimeObject(runtimeObject(entry.runtimeEvent)?.data)
    const routeSnapshot = runtimeObject(entry.routeDecisionSnapshot) ?? runtimeObject(runtimeEventData?.snapshot)
    const routeHealth = runtimeObject(routeSnapshot?.health)
    const routeExampleBase = healthExampleBase(entry, routeSnapshot)
    const healthStatus = runtimeString(routeHealth?.status)
    if (healthStatus === 'cooldown') {
      summary.cooldown += 1
      examples.push({
        ...routeExampleBase,
        reason: 'cooldown',
        cooldownUntilMs: runtimeNumber(routeHealth?.cooldownUntilMs),
      })
    }
    if (healthStatus === 'circuit-open') {
      summary.circuitOpen += 1
      examples.push({
        ...routeExampleBase,
        reason: 'circuit_open',
        circuitOpenUntilMs: runtimeNumber(routeHealth?.circuitOpenUntilMs),
      })
    }

    const trigger = runtimeString(entry.trigger) ?? runtimeString(runtimeEventData?.trigger)
    const status = runtimeNumber(entry.upstreamStatus) ?? runtimeNumber(entry.status) ?? runtimeNumber(runtimeEventData?.status)
    const affinityBase = healthExampleBase(entry)
    if (trigger === 'rate_limited' || status === 429) {
      summary.quotaExhausted += 1
      examples.push({ ...affinityBase, reason: 'quota_exhausted', trigger, status })
    }
    if (trigger === 'credential_unhealthy' || status === 401 || status === 403) {
      summary.credentialUnhealthy += 1
      examples.push({ ...affinityBase, reason: 'credential_unhealthy', trigger, status })
    }
  }
  summary.recentExamples = examples.slice(-5).reverse()
  return summary
}

function summarizeSessionAffinityDiagnostics(entries: RuntimeLogEntry[]): RuntimeDiagnosticsSummary['sessionAffinity'] {
  const summary: RuntimeDiagnosticsSummary['sessionAffinity'] = {
    resolved: 0,
    bound: 0,
    invalidated: 0,
    rotated: 0,
    recentExamples: [],
  }
  const examples: RuntimeDiagnosticsSessionAffinityExample[] = []
  for (const entry of entries.filter((item) => item.event === 'session.affinity')) {
    const status = normalizeSessionAffinityStatus(entry.status)
    if (status === 'resolved') summary.resolved += 1
    if (status === 'bound') summary.bound += 1
    if (status === 'invalidated') summary.invalidated += 1
    if (status === 'rotated') summary.rotated += 1
    examples.push({
      providerId: runtimeString(entry.providerId),
      model: runtimeString(entry.model),
      credentialGroupId: runtimeString(entry.credentialGroupId),
      status,
      trigger: runtimeString(entry.trigger),
      upstreamStatus: runtimeNumber(entry.upstreamStatus),
      fromGroupId: runtimeString(entry.fromGroupId),
      toGroupId: runtimeString(entry.toGroupId),
      failoverCount: runtimeNumber(entry.failoverCount),
    })
  }
  summary.recentExamples = examples.slice(-5).reverse()
  return summary
}

function summarizeContextControlPlaneDiagnostics(entries: RuntimeLogEntry[]): RuntimeDiagnosticsSummary['contextControlPlane'] {
  const summary: RuntimeDiagnosticsSummary['contextControlPlane'] = {
    planned: 0,
    compactDecided: 0,
    fragmentIncluded: 0,
    fragmentExcluded: 0,
    cappedFragments: 0,
    cacheDiagnostics: 0,
    fullRewriteDetected: 0,
    unboundedBlocked: 0,
    manifests: 0,
    manifestIssues: 0,
    manifestFailureCodes: [],
    recentExamples: [],
  }
  const examples: RuntimeDiagnosticsContextControlPlaneExample[] = []
  const manifestFailureCodes = new Set<string>()
  for (const entry of entries) {
    const envelope = runtimeObject(entry.runtimeEvent)
    const event = runtimeString(envelope?.event)
    const data = runtimeObject(envelope?.data)
    if (!event || !data) continue
    const providerId = runtimeString(envelope?.providerId) ?? runtimeString(entry.providerId)
    const model = runtimeString(envelope?.model) ?? runtimeString(entry.model)
    if (event === 'context.planned') {
      const cappedFragmentCount = runtimeNumber(data.cappedFragmentCount) ?? 0
      const cacheDiagnosticCount = runtimeNumber(data.cacheDiagnosticCount) ?? 0
      const contextManifestSchema = runtimeString(data.contextManifestSchema)
      const contextManifest = runtimeObject(data.contextManifest)
      const eventManifestFailureCodes = uniqueRuntimeStrings([
        ...runtimeLogStringArray(data.contextManifestFailureCodes),
        ...runtimeLogStringArray(contextManifest?.failureCodes),
      ])
      summary.planned += 1
      summary.cappedFragments += cappedFragmentCount
      summary.cacheDiagnostics += cacheDiagnosticCount
      if (contextManifestSchema) summary.manifests += 1
      summary.manifestIssues += eventManifestFailureCodes.length
      for (const code of eventManifestFailureCodes) manifestFailureCodes.add(code)
      for (const diagnostic of runtimeArray(data.cacheDiagnostics)) {
        const kind = runtimeString(runtimeObject(diagnostic)?.kind)
        if (kind === 'full_context_rewrite_detected') summary.fullRewriteDetected += 1
        if (kind === 'unbounded_fragment_blocked') summary.unboundedBlocked += 1
      }
      examples.push({
        providerId,
        model,
        event,
        contextManifestSchema,
        contextManifestFailureCodes: eventManifestFailureCodes,
        fragmentCount: runtimeNumber(data.fragmentCount),
        cappedFragmentCount,
        cacheDiagnosticCount,
        tokensUntilCompaction: runtimeNumber(data.tokensUntilCompaction),
      })
    } else if (event === 'context.fragment.included') {
      summary.fragmentIncluded += runtimeNumber(data.count) ?? 1
    } else if (event === 'context.fragment.excluded') {
      summary.fragmentExcluded += runtimeNumber(data.count) ?? 1
    } else if (event === 'context.compact.decided') {
      summary.compactDecided += 1
      examples.push({
        providerId,
        model,
        event,
        compactMode: runtimeString(data.mode),
        compactEnabled: runtimeBoolean(data.enabled),
        compactReason: runtimeString(data.reason),
        pressureRatio: runtimeNumber(data.pressureRatio),
        tokensUntilCompaction: runtimeNumber(data.tokensUntilCompaction),
      })
    }
  }
  summary.manifestFailureCodes = Array.from(manifestFailureCodes).slice(0, 8)
  summary.recentExamples = examples.slice(-5).reverse()
  return summary
}

function summarizeRequestLevelExamples(entries: RuntimeLogEntry[]): RuntimeDiagnosticsRequestExample[] {
  const latestByKind = new Map<RuntimeDiagnosticsRequestExampleKind, RuntimeDiagnosticsRequestExample>()
  const remember = (example: RuntimeDiagnosticsRequestExample) => {
    latestByKind.set(example.kind, example)
  }
  for (const entry of entries) {
    const envelope = runtimeObject(entry.runtimeEvent)
    const event = runtimeString(envelope?.event)
    const data = runtimeObject(envelope?.data)
    const providerId = runtimeString(envelope?.providerId) ?? runtimeString(entry.providerId)
    const model = runtimeString(envelope?.model) ?? runtimeString(entry.model)

    const snapshot = runtimeObject(entry.routeDecisionSnapshot) ?? runtimeObject(data?.snapshot)
    if (entry.event === 'route.snapshot' && snapshot) {
      const route = runtimeObject(snapshot.route)
      const health = runtimeObject(snapshot.health)
      const conformance = runtimeObject(snapshot.conformance)
      const routeBlockReason = runtimeLogStringArray(route?.blockReasons).join(',')
      remember({
        kind: 'route_snapshot',
        providerId: runtimeString(snapshot.providerId) ?? providerId,
        model: runtimeString(snapshot.upstreamModel) ?? runtimeString(snapshot.model) ?? model,
        credentialGroupId: runtimeString(snapshot.credentialGroupId),
        protocol: runtimeString(route?.protocol) ?? runtimeString(conformance?.protocol),
        status: runtimeString(health?.status),
        reason: runtimeString(runtimeObject(snapshot.proxy)?.reason) ?? (routeBlockReason || undefined),
      })
      const blockerCodes = runtimeLogStringArray(conformance?.blockerCodes)
      if (blockerCodes.length) {
        remember({
          kind: 'conformance_block',
          providerId: runtimeString(snapshot.providerId) ?? providerId,
          model: runtimeString(snapshot.upstreamModel) ?? runtimeString(snapshot.model) ?? model,
          protocol: runtimeString(conformance?.protocol),
          reason: blockerCodes.join(','),
        })
      }
      continue
    }

    if (entry.event === 'fallback.decision' || event === 'provider.fallback.decided') {
      const decision = runtimeObject(entry.decision) ?? runtimeObject(data?.decision)
      const classification = runtimeObject(entry.classification) ?? runtimeObject(data?.classification)
      const selected = runtimeObject(decision?.selected) ?? runtimeObject(data?.selected)
      remember({
        kind: 'fallback',
        providerId,
        model,
        trigger: runtimeString(classification?.trigger) ?? runtimeString(data?.trigger),
        reason: runtimeString(decision?.reason) ?? runtimeString(data?.reason),
        selectedProviderId: runtimeString(selected?.providerId),
        selectedModel: runtimeString(selected?.model),
      })
      continue
    }

    if (entry.event === 'session.affinity') {
      const status = normalizeSessionAffinityStatus(runtimeString(data?.status) ?? runtimeString(entry.status) ?? runtimeEventSessionAffinityStatus(event))
      if (status === 'bound' || status === 'rotated') {
        remember({
          kind: 'session_binding',
          providerId,
          model,
          credentialGroupId: runtimeString(data?.toGroupId) ?? runtimeString(entry.toGroupId) ?? runtimeString(data?.credentialGroupId) ?? runtimeString(entry.credentialGroupId),
          status,
          trigger: runtimeString(data?.trigger) ?? runtimeString(entry.trigger),
        })
      }
      continue
    }

    if (event === 'context.compact.decided') {
      remember({
        kind: 'compact_decision',
        providerId,
        model,
        status: runtimeBoolean(data?.enabled) === true ? 'enabled' : 'disabled',
        reason: runtimeString(data?.reason),
      })
      continue
    }

    if (entry.event === 'provider.conformance') {
      const issues = Array.isArray(data?.issues) ? runtimeArray(data?.issues) : runtimeArray(entry.issues)
      const blockers = issues
        .map((issue) => runtimeObject(issue))
        .filter((issue) => runtimeString(issue?.severity) === 'block')
        .map((issue) => runtimeString(issue?.code))
        .filter((code): code is string => Boolean(code))
      const blockerCodes = [
        ...runtimeLogStringArray(data?.blockerCodes),
        ...runtimeLogStringArray(entry.blockerCodes),
        ...blockers,
      ]
      if (blockerCodes.length) {
        remember({
          kind: 'conformance_block',
          providerId,
          model,
          protocol: runtimeString(data?.protocol) ?? runtimeString(entry.protocol),
          reason: Array.from(new Set(blockerCodes)).join(','),
        })
      }
    }
  }
  const order: RuntimeDiagnosticsRequestExampleKind[] = [
    'route_snapshot',
    'fallback',
    'session_binding',
    'compact_decision',
    'conformance_block',
  ]
  return order
    .map((kind) => latestByKind.get(kind))
    .filter((example): example is RuntimeDiagnosticsRequestExample => Boolean(example))
}

function runtimeEventSessionAffinityStatus(event: string | undefined): string | undefined {
  if (event === 'session.affinity.bound') return 'bound'
  if (event === 'session.affinity.rotated') return 'rotated'
  if (event === 'session.affinity.invalidated') return 'invalidated'
  if (event === 'session.affinity.resolved') return 'resolved'
  return undefined
}

function summarizeProviderRuntimeDetails(
  providers: AIProvider[],
  settings: Settings,
  entries: RuntimeLogEntry[],
): RuntimeDiagnosticsProviderDetail[] {
  const details = new Map<string, RuntimeDiagnosticsProviderDetail>()
  for (const provider of providers) {
    const credentialGroups = provider.credentialGroups ?? []
    const enabledGroups = credentialGroups.filter((group) => group.enabled)
    const healthyGroups = enabledGroups.filter((group) => group.lastModelSyncStatus !== 'bad' && !group.lastFailureAt)
    const declaredProtocol = provider.wireProtocol ?? (provider.type === 'anthropic' ? 'anthropic-compatible' : 'openai-compatible')
    details.set(provider.id, {
      providerId: provider.id,
      declaredProtocol,
      readyProtocol: provider.enabled && (provider.lastTestStatus === 'ok' || provider.lastModelSyncStatus === 'ok')
        ? providerSupportsResponsesApi(provider)
          ? 'openai-responses'
          : declaredProtocol
        : undefined,
      credentialHealth: {
        total: credentialGroups.length,
        enabled: enabledGroups.length,
        healthy: healthyGroups.length,
        cooldown: 0,
        circuitOpen: 0,
        quotaExhausted: 0,
        credentialUnhealthy: 0,
      },
      sessionAffinity: {
        enabled: settings.sessionAffinityEnabled === true,
      },
      lastUnavailableReason: provider.enabled
        ? provider.lastTestStatus === 'bad'
          ? 'test_failed'
          : provider.lastModelSyncStatus === 'bad'
            ? 'sync_failed'
            : undefined
        : 'disabled',
      lastUnavailableDetail: provider.lastTestStatus === 'bad'
        ? provider.lastTestCode ?? provider.lastTestMessage
        : provider.lastModelSyncStatus === 'bad'
          ? provider.lastModelSyncCode ?? provider.lastModelSyncMessage
          : provider.enabled
            ? undefined
            : 'disabled',
    })
  }

  for (const entry of entries) {
    const envelope = runtimeObject(entry.runtimeEvent)
    const event = runtimeString(envelope?.event)
    const data = runtimeObject(envelope?.data)
    const providerId = runtimeString(envelope?.providerId) ?? runtimeString(entry.providerId)
    if (!providerId) continue
    const detail = details.get(providerId)
    if (!detail) continue

    const snapshot = runtimeObject(entry.routeDecisionSnapshot) ?? runtimeObject(data?.snapshot)
    const snapshotProviderId = runtimeString(snapshot?.providerId)
    if (snapshotProviderId && snapshotProviderId !== providerId) continue
    if (entry.event === 'route.snapshot' && snapshot) {
      const route = runtimeObject(snapshot.route)
      const conformance = runtimeObject(snapshot.conformance)
      const health = runtimeObject(snapshot.health)
      const protocol = runtimeString(route?.protocol) ?? runtimeString(conformance?.protocol)
      if (protocol) detail.observedProtocol = protocol
      const credentialGroupId = runtimeString(snapshot.credentialGroupId)
      const healthStatus = runtimeString(health?.status)
      if (healthStatus === 'cooldown') {
        detail.credentialHealth.cooldown += 1
        setProviderUnavailable(detail, 'cooldown', credentialGroupId)
      } else if (healthStatus === 'circuit-open') {
        detail.credentialHealth.circuitOpen += 1
        setProviderUnavailable(detail, 'circuit_open', credentialGroupId)
      }
      const blockerCodes = runtimeLogStringArray(conformance?.blockerCodes)
      if (blockerCodes.length) {
        setProviderUnavailable(detail, 'conformance_block', blockerCodes.join(','))
      }
      continue
    }

    if (entry.event === 'provider.conformance') {
      const protocol = runtimeString(data?.protocol) ?? runtimeString(entry.protocol)
      if (protocol) detail.observedProtocol = protocol
      const issues = Array.isArray(data?.issues) ? runtimeArray(data?.issues) : runtimeArray(entry.issues)
      const blockerCodes = [
        ...runtimeLogStringArray(data?.blockerCodes),
        ...runtimeLogStringArray(entry.blockerCodes),
        ...issues
          .map((issue) => runtimeObject(issue))
          .filter((issue) => runtimeString(issue?.severity) === 'block')
          .map((issue) => runtimeString(issue?.code))
          .filter((code): code is string => Boolean(code)),
      ]
      if (blockerCodes.length) {
        setProviderUnavailable(detail, 'conformance_block', Array.from(new Set(blockerCodes)).join(','))
      }
      continue
    }

    if (entry.event === 'fallback.decision' || event === 'provider.fallback.decided') {
      const decision = runtimeObject(entry.decision) ?? runtimeObject(data?.decision)
      const classification = runtimeObject(entry.classification) ?? runtimeObject(data?.classification)
      const selected = runtimeObject(decision?.selected) ?? runtimeObject(data?.selected)
      const selectedProviderId = runtimeString(selected?.providerId)
      setProviderUnavailable(
        detail,
        'fallback',
        selectedProviderId ?? runtimeString(decision?.reason) ?? runtimeString(classification?.trigger) ?? runtimeString(data?.trigger),
      )
      continue
    }

    if (entry.event === 'session.affinity') {
      const status = normalizeSessionAffinityStatus(runtimeString(data?.status) ?? runtimeString(entry.status) ?? runtimeEventSessionAffinityStatus(event))
      const credentialGroupId = runtimeString(data?.toGroupId) ?? runtimeString(entry.toGroupId) ?? runtimeString(data?.credentialGroupId) ?? runtimeString(entry.credentialGroupId) ?? runtimeString(data?.fromGroupId) ?? runtimeString(entry.fromGroupId)
      detail.sessionAffinity = {
        enabled: settings.sessionAffinityEnabled === true,
        status,
        credentialGroupId,
        trigger: runtimeString(data?.trigger) ?? runtimeString(entry.trigger),
      }
      const trigger = detail.sessionAffinity.trigger
      const upstreamStatus = runtimeNumber(data?.upstreamStatus) ?? runtimeNumber(entry.upstreamStatus)
      if (trigger === 'rate_limited' || upstreamStatus === 429) {
        detail.credentialHealth.quotaExhausted += 1
        setProviderUnavailable(detail, 'quota_exhausted', credentialGroupId)
      } else if (trigger === 'credential_unhealthy' || upstreamStatus === 401 || upstreamStatus === 403) {
        detail.credentialHealth.credentialUnhealthy += 1
        setProviderUnavailable(detail, 'credential_unhealthy', credentialGroupId)
      }
    }
  }

  return providers.map((provider) => details.get(provider.id)).filter((detail): detail is RuntimeDiagnosticsProviderDetail => Boolean(detail))
}

function setProviderUnavailable(
  detail: RuntimeDiagnosticsProviderDetail,
  reason: RuntimeDiagnosticsProviderUnavailableReason,
  detailText?: string,
): void {
  detail.lastUnavailableReason = reason
  detail.lastUnavailableDetail = detailText
}

function normalizeSessionAffinityStatus(value: unknown): RuntimeDiagnosticsSessionAffinityExample['status'] {
  if (value === 'reused' || value === 'skipped') return 'resolved'
  if (value === 'resolved' || value === 'bound' || value === 'invalidated' || value === 'rotated') return value
  return 'unknown'
}

function healthExampleBase(
  entry: RuntimeLogEntry,
  snapshot?: Record<string, unknown>,
): Pick<RuntimeDiagnosticsProviderHealthExample, 'providerId' | 'model' | 'credentialGroupId'> {
  return {
    providerId: runtimeString(snapshot?.providerId) ?? runtimeString(entry.providerId),
    model: runtimeString(snapshot?.upstreamModel) ?? runtimeString(snapshot?.model) ?? runtimeString(entry.model),
    credentialGroupId: runtimeString(snapshot?.credentialGroupId) ?? runtimeString(entry.credentialGroupId),
  }
}

function runtimeObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function runtimeArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function runtimeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function runtimeBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function runtimeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function summarizeSupportLevels(matrices: ReturnType<typeof buildProviderCapabilityMatrix>[]): Record<ProviderSupportLevel, number> {
  return matrices.reduce<Record<ProviderSupportLevel, number>>((acc, matrix) => {
    acc[matrix.summaryLevel] = (acc[matrix.summaryLevel] ?? 0) + 1
    return acc
  }, {
    full: 0,
    partial: 0,
    planned: 0,
    unsupported: 0,
  })
}

function summarizeCapabilityMatrixStatusExamples(
  entries: Array<{
    provider: AIProvider
    matrix: ReturnType<typeof buildProviderCapabilityMatrix>
    evidence: ReturnType<typeof getProviderCompatibilityEvidenceForProvider>
  }>
): Record<ProviderSupportLevel, RuntimeDiagnosticsCapabilityMatrixExample[]> {
  const examples: Record<ProviderSupportLevel, RuntimeDiagnosticsCapabilityMatrixExample[]> = {
    full: [],
    partial: [],
    planned: [],
    unsupported: [],
  }
  for (const { provider, matrix, evidence } of entries) {
    for (const status of matrix.statuses) {
      if (examples[status.level].length >= 3) continue
      const explanation = status.contractStatus
        ? explainProviderCompatibilityCapabilityStatus(status.contractStatus, evidence.auditState)
        : undefined
      examples[status.level].push({
        providerId: provider.id,
        providerName: provider.name,
        compatibilityId: evidence.id,
        area: status.area,
        level: status.level,
        reason: status.reason,
        contractStatus: status.contractStatus,
        limitationReason: explanation?.limitationReason,
        degradationPath: explanation?.degradationPath,
      })
    }
  }
  return examples
}

function summarizeProviderModelCapabilityStatuses(
  summaries: ProviderModelCapabilityProviderSummary[],
): Record<ProviderModelCapabilityEvidenceStatus, number> {
  return summaries.reduce<Record<ProviderModelCapabilityEvidenceStatus, number>>((acc, summary) => {
    for (const [status, count] of Object.entries(summary.statusCounts) as Array<[ProviderModelCapabilityEvidenceStatus, number]>) {
      acc[status] = (acc[status] ?? 0) + count
    }
    return acc
  }, {
    verified: 0,
    inferred: 0,
    manual: 0,
    unsupported: 0,
  })
}

function summarizeProviderModelCapabilityStatusExamples(providers: AIProvider[]): Record<ProviderModelCapabilityEvidenceStatus, RuntimeDiagnosticsModelCapabilityExample[]> {
  const examples: Record<ProviderModelCapabilityEvidenceStatus, RuntimeDiagnosticsModelCapabilityExample[]> = {
    verified: [],
    inferred: [],
    manual: [],
    unsupported: [],
  }
  for (const provider of providers) {
    for (const modelId of runtimeDiagnosticsModelCapabilityIds(provider).slice(0, 8)) {
      const matrix = buildProviderModelCapabilityMatrix(provider, modelId)
      for (const capability of matrix.capabilities) {
        if (examples[capability.status].length >= 3) continue
        examples[capability.status].push({
          providerId: provider.id,
          providerName: provider.name,
          modelId,
          capability: capability.capability,
          status: capability.status,
          source: capability.source,
          canSend: modelCapabilityCanBeSentFromStatus(capability.capability, capability.status),
          reason: capability.reason,
        })
      }
    }
  }
  return examples
}

function runtimeDiagnosticsModelCapabilityIds(provider: AIProvider): string[] {
  return normalizeRuntimeDiagnosticsModelIds([
    provider.lastTestModel,
    ...provider.models,
    ...(provider.manualModels ?? []),
    ...(provider.modelConfigs ?? []).map((model) => model.id),
    ...(provider.modelAliases ?? []).map((alias) => alias.model),
  ]).slice(0, RUNTIME_DIAGNOSTICS_MODEL_CAPABILITY_LIMIT)
}

function normalizeRuntimeDiagnosticsModelIds(modelIds: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  return modelIds
    .map((model) => model?.trim() ?? '')
    .filter((model) => {
      if (!model || seen.has(model)) return false
      seen.add(model)
      return true
    })
}

function summarizeCompatibilityAuditStates(states: ProviderCompatibilityAuditState[]): Record<ProviderCompatibilityAuditState, number> {
  return states.reduce<Record<ProviderCompatibilityAuditState, number>>((acc, state) => {
    acc[state] = (acc[state] ?? 0) + 1
    return acc
  }, {
    'conformance-ready': 0,
    'docs-mapped': 0,
    'needs-live-smoke': 0,
    'protocol-reference': 0,
  })
}

function summarizeCompatibilityCapabilityStatuses(ids: Array<ReturnType<typeof getProviderCompatibilityEvidenceForProvider>['id']>): Record<ProviderCompatibilityCapabilityStatus, number> {
  return ids.reduce<Record<ProviderCompatibilityCapabilityStatus, number>>((acc, id) => {
    const statuses = buildProviderCompatibilityBehaviorStatusMap(id)
    for (const status of Object.values(statuses)) {
      acc[status] = (acc[status] ?? 0) + 1
    }
    return acc
  }, {
    supported: 0,
    partial: 0,
    unsupported: 0,
    requiresLiveKey: 0,
    docsChanged: 0,
  })
}

function summarizeCompatibilityCapabilityStatusExamples(providers: AIProvider[]): Record<ProviderCompatibilityCapabilityStatus, RuntimeDiagnosticsCapabilityStatusExample[]> {
  const examples: Record<ProviderCompatibilityCapabilityStatus, RuntimeDiagnosticsCapabilityStatusExample[]> = {
    supported: [],
    partial: [],
    unsupported: [],
    requiresLiveKey: [],
    docsChanged: [],
  }
  for (const provider of providers) {
    const evidence = getProviderCompatibilityEvidenceForProvider(provider)
    const liveSmokeGates = getProviderCompatibilityLiveSmokeGates(evidence.id)
    const statuses = buildProviderCompatibilityBehaviorStatusMap(evidence.id)
    for (const [capability, status] of Object.entries(statuses) as Array<[ProviderCompatibilityBehavior, ProviderCompatibilityCapabilityStatus]>) {
      if (examples[status].length >= 3) continue
      const explanation = explainProviderCompatibilityCapabilityStatus(status, evidence.auditState)
      examples[status].push({
        providerId: provider.id,
        providerName: provider.name,
        compatibilityId: evidence.id,
        capability,
        status,
        limitationReason: explanation.limitationReason,
        degradationPath: explanation.degradationPath,
        auditState: evidence.auditState,
        evidenceUrl: evidence.officialDocs[0],
        liveSmokeGates: liveSmokeGates
          .filter((gate) => gate.validates.includes(capability))
          .map((gate) => gate.id),
      })
    }
  }
  return examples
}

function summarizeCompatibilityCapabilitySendSources(providers: AIProvider[]): Record<ProviderCompatibilityCapabilitySendSource, number> {
  return providers.reduce<Record<ProviderCompatibilityCapabilitySendSource, number>>((acc, provider) => {
    const evidence = getProviderCompatibilityEvidenceForProvider(provider)
    const statuses = buildProviderCompatibilityBehaviorStatusMap(evidence.id)
    for (const capability of Object.keys(statuses) as ProviderCompatibilityBehavior[]) {
      const policy = resolveProviderCompatibilityCapabilitySendPolicy(
        provider,
        capability,
        providerCompatibilityCapabilityExplicitlyDeclaredByProvider(provider, capability),
      )
      acc[policy.sendSource] = (acc[policy.sendSource] ?? 0) + 1
    }
    return acc
  }, {
    contract: 0,
    provider_identity: 0,
    explicit_declaration: 0,
    blocked: 0,
  })
}

function summarizeCompatibilityCapabilitySendPolicyExamples(providers: AIProvider[]): Record<ProviderCompatibilityCapabilitySendSource, RuntimeDiagnosticsCapabilitySendPolicyExample[]> {
  const examples: Record<ProviderCompatibilityCapabilitySendSource, RuntimeDiagnosticsCapabilitySendPolicyExample[]> = {
    contract: [],
    provider_identity: [],
    explicit_declaration: [],
    blocked: [],
  }
  for (const provider of providers) {
    const evidence = getProviderCompatibilityEvidenceForProvider(provider)
    const statuses = buildProviderCompatibilityBehaviorStatusMap(evidence.id)
    for (const capability of Object.keys(statuses) as ProviderCompatibilityBehavior[]) {
      const policy = resolveProviderCompatibilityCapabilitySendPolicy(
        provider,
        capability,
        providerCompatibilityCapabilityExplicitlyDeclaredByProvider(provider, capability),
      )
      if (examples[policy.sendSource].length >= 3) continue
      examples[policy.sendSource].push({
        providerId: provider.id,
        providerName: provider.name,
        compatibilityId: evidence.id,
        capability,
        status: policy.status,
        allowed: policy.allowed,
        sendSource: policy.sendSource,
        limitationReason: policy.limitationReason,
        degradationPath: policy.degradationPath,
        auditState: evidence.auditState,
        evidenceUrl: evidence.officialDocs[0],
      })
    }
  }
  return examples
}
