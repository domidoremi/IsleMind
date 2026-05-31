import type { AIProvider, Settings } from '@/types'
import { getRuntimeLogInfo, type RuntimeLogInfo } from '@/services/runtimeLog'
import { listCompactUsageRecords } from '@/services/ai/compact/compactUsage'

export interface RuntimeDiagnosticsSummary {
  websocket: {
    mode: NonNullable<Settings['transportMode']>
    capableProviders: number
    readyProviders: number
    enabled: boolean
  }
  compact: {
    mode: NonNullable<Settings['remoteCompactMode']>
    capableProviders: number
    requestCount: number
    completedCount: number
    failureCount: number
    estimatedSavedTokens: number
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
}

export async function buildRuntimeDiagnosticsSummary(input: {
  providers: AIProvider[]
  settings: Settings
}): Promise<RuntimeDiagnosticsSummary> {
  const providers = input.providers
  const settings = input.settings
  const enabledProviders = providers.filter((provider) => provider.enabled)
  const compactRecords = listCompactUsageRecords()
  const logInfo = await getRuntimeLogInfo()
  return {
    websocket: {
      mode: settings.transportMode ?? 'auto',
      capableProviders: providers.filter((provider) => provider.capabilities?.responsesWebSocket === true && provider.capabilities?.responsesApi === true).length,
      readyProviders: enabledProviders.filter((provider) => provider.capabilities?.responsesWebSocket === true && provider.capabilities?.responsesApi === true).length,
      enabled: (settings.transportMode ?? 'auto') === 'websocket',
    },
    compact: {
      mode: settings.remoteCompactMode ?? 'off',
      capableProviders: providers.filter((provider) => provider.capabilities?.remoteCompact === true && provider.capabilities?.responsesApi === true).length,
      requestCount: compactRecords.length,
      completedCount: compactRecords.filter((record) => !record.failureCode).length,
      failureCount: compactRecords.filter((record) => !!record.failureCode).length,
      estimatedSavedTokens: compactRecords.reduce((sum, record) => sum + (record.estimatedSavedTokens ?? 0), 0),
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
  }
}

function buildProxySummary(settings: Settings): RuntimeDiagnosticsSummary['proxy'] {
  const mode = settings.proxyMode ?? 'off'
  if (mode === 'off') return { mode, applied: false, reason: 'off' }
  if (mode === 'system-detected') return { mode, applied: true, reason: 'system_proxy_platform_stack' }
  const target = settings.proxyBaseUrl?.trim()
  return target
    ? { mode, applied: true, target, reason: 'custom_base_url' }
    : { mode, applied: false, reason: 'invalid_custom_base_url' }
}
