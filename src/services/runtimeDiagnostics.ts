import type { AIProvider, Settings } from '@/types'
import { getRuntimeLogInfo, readRuntimeLogText, type RuntimeLogEntry, type RuntimeLogInfo } from '@/services/runtimeLog'
import { listCompactUsageRecords } from '@/services/ai/compact/compactUsage'
import { safeHttpUrl } from '@/utils/networkUrlSafety'
import {
  buildProviderCapabilityMatrix,
  buildProviderCoverageBuckets,
  buildProviderModelCapabilityMatrix,
  getProviderModelCapabilityModelIds,
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
  proxy: {
    mode: NonNullable<Settings['proxyMode']>
    applied: boolean
    target?: string
    reason: 'off' | 'custom_base_url' | 'system_proxy_platform_stack' | 'invalid_custom_base_url'
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
  const providers = input.providers
  const settings = input.settings
  const enabledProviders = providers.filter((provider) => provider.enabled)
  const compactRecords = listCompactUsageRecords()
  const localCompressionRecords = compactRecords.filter((record) => hasLocalCompressionRecord(record))
  const localCompactRecords = compactRecords.filter((record) => record.fallbackLocal === true)
  const logInfo = await getRuntimeLogInfo()
  const logEntries = parseRuntimeLogEntries(await readRuntimeLogText())
  const routeProtocolCounts = summarizeRouteProtocols(logEntries)
  const websocketFallbackCount = countRuntimeLogEntries(logEntries, 'transport.fallback')
  const requestRectificationSummary = summarizeRequestRectifications(logEntries)
  const providerMatrices = providers.map((provider) => ({
    provider,
    matrix: buildProviderCapabilityMatrix(provider),
    evidence: getProviderCompatibilityEvidenceForProvider(provider),
  }))
  const providerModelCapabilitySummaries = providers.map((provider) => summarizeProviderModelCapabilityProvider(provider))
  const compatibilityEvidence = providers.map((provider) => getProviderCompatibilityEvidenceForProvider(provider))
  const compatibilityAuditStates = summarizeCompatibilityAuditStates(compatibilityEvidence.map((evidence) => evidence.auditState))
  const compatibilityCapabilityStatuses = summarizeCompatibilityCapabilityStatuses(compatibilityEvidence.map((evidence) => evidence.id))
  const compatibilityCapabilityStatusExamples = summarizeCompatibilityCapabilityStatusExamples(providers)
  const compatibilityCapabilitySendSources = summarizeCompatibilityCapabilitySendSources(providers)
  const compatibilityCapabilitySendPolicyExamples = summarizeCompatibilityCapabilitySendPolicyExamples(providers)
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
    capabilityMatrix: {
      hostingProfiles: buildProviderCoverageBuckets(providers),
      supportLevels: summarizeSupportLevels(providerMatrices.map((entry) => entry.matrix)),
      statusExamples: summarizeCapabilityMatrixStatusExamples(providerMatrices),
      partialProviders: providerMatrices.filter((entry) => entry.matrix.summaryLevel === 'partial').length,
      plannedProviders: providerMatrices.filter((entry) => entry.matrix.summaryLevel === 'planned').length,
      hostedGapProviders: providerMatrices.filter((entry) => entry.matrix.hostingProfile === 'cloud-hosted' && entry.matrix.summaryLevel === 'planned').length,
      genericModelListSuppressedProviders: providerMatrices.filter((entry) => entry.matrix.statuses.some((status) => status.area === 'modelCatalog' && status.reason.includes('generic model-list sync is intentionally disabled'))).length,
      modelCapabilityProviders: providerModelCapabilitySummaries.filter((summary) => summary.modelCount > 0).length,
      modelCapabilityModels: providerModelCapabilitySummaries.reduce((sum, summary) => sum + summary.modelCount, 0),
      modelCapabilityStatuses: summarizeProviderModelCapabilityStatuses(providerModelCapabilitySummaries),
      modelCapabilityStatusExamples: summarizeProviderModelCapabilityStatusExamples(providers),
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

function summarizeRouteProtocols(entries: RuntimeLogEntry[]): Record<string, number> {
  return entries.reduce<Record<string, number>>((acc, entry) => {
    if (entry.event !== 'provider.conformance') return acc
    const protocol = typeof entry.protocol === 'string' ? entry.protocol : undefined
    if (!protocol) return acc
    acc[protocol] = (acc[protocol] ?? 0) + 1
    return acc
  }, {})
}

function parseRuntimeLogEntries(text: string): RuntimeLogEntry[] {
  if (!text.trim()) return []
  return text
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
}

function buildProxySummary(settings: Settings): RuntimeDiagnosticsSummary['proxy'] {
  const mode = settings.proxyMode ?? 'off'
  if (mode === 'off') return { mode, applied: false, reason: 'off' }
  if (mode === 'system-detected') return { mode, applied: true, reason: 'system_proxy_platform_stack' }
  const target = safeHttpUrl(settings.proxyBaseUrl)
  return target
    ? { mode, applied: true, target, reason: 'custom_base_url' }
    : { mode, applied: false, reason: 'invalid_custom_base_url' }
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
    for (const modelId of getProviderModelCapabilityModelIds(provider).slice(0, 8)) {
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
