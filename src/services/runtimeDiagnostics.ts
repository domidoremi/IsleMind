import type { AIProvider, Settings } from '@/types'
import { getRuntimeLogInfo, readRuntimeLogText, type RuntimeLogEntry, type RuntimeLogInfo } from '@/services/runtimeLog'
import { listCompactUsageRecords } from '@/services/ai/compact/compactUsage'
import { safeHttpUrl } from '@/utils/networkUrlSafety'
import { buildProviderCapabilityMatrix, buildProviderCoverageBuckets, type ProviderHostingProfile, type ProviderSupportLevel } from '@/services/ai/providerCapabilityMatrix'

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
    partialProviders: number
    plannedProviders: number
    hostedGapProviders: number
    genericModelListSuppressedProviders: number
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
  const providerMatrices = providers.map(buildProviderCapabilityMatrix)
  return {
    responses: {
      capableProviders: providers.filter((provider) => provider.capabilities?.responsesApi === true).length,
      readyProviders: enabledProviders.filter((provider) => provider.capabilities?.responsesApi === true).length,
      activeProtocols: routeProtocolCounts,
    },
    websocket: {
      mode: settings.transportMode ?? 'auto',
      capableProviders: providers.filter((provider) => provider.capabilities?.responsesWebSocket === true && provider.capabilities?.responsesApi === true).length,
      readyProviders: enabledProviders.filter((provider) => provider.capabilities?.responsesWebSocket === true && provider.capabilities?.responsesApi === true).length,
      enabled: (settings.transportMode ?? 'auto') === 'websocket',
      fallbackCount: websocketFallbackCount,
    },
    compact: {
      mode: settings.remoteCompactMode ?? 'off',
      capableProviders: providers.filter((provider) => provider.capabilities?.remoteCompact === true && provider.capabilities?.responsesApi === true).length,
      readyProviders: enabledProviders.filter((provider) => provider.capabilities?.remoteCompact === true && provider.capabilities?.responsesApi === true).length,
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
      supportLevels: summarizeSupportLevels(providerMatrices),
      partialProviders: providerMatrices.filter((matrix) => matrix.summaryLevel === 'partial').length,
      plannedProviders: providerMatrices.filter((matrix) => matrix.summaryLevel === 'planned').length,
      hostedGapProviders: providerMatrices.filter((matrix) => matrix.hostingProfile === 'cloud-hosted' && matrix.summaryLevel === 'planned').length,
      genericModelListSuppressedProviders: providerMatrices.filter((matrix) => matrix.statuses.some((status) => status.area === 'modelCatalog' && status.reason.includes('generic model-list sync is intentionally disabled'))).length,
    },
  }
}

function hasLocalCompressionRecord(record: ReturnType<typeof listCompactUsageRecords>[number]): boolean {
  return typeof record.localCompressedTokens === 'number' ||
    typeof record.localEstimatedSavedTokens === 'number' ||
    record.localCompressionStrategy === 'structured-v2' ||
    record.localCompressionStrategy === 'single-message-truncation'
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
