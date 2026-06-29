import type { AIProvider, ProxyMode, Settings } from '@/types'
import type { ProviderFailoverDecision, ProviderFailoverRoute } from '@/services/ai/providerFailover'
import type { ProviderHealthStatus } from '@/services/ai/providerHealth'
import { safeHttpUrl } from '@/utils/networkUrlSafety'

export interface ProviderProxyPlanRoute extends ProviderFailoverRoute {
  endpointHost?: string
}

export interface ProviderProxyPlanHealth {
  status: ProviderHealthStatus
  cooldownUntilMs?: number
  circuitOpenUntilMs?: number
  failures?: number
  successes?: number
}

export interface ProviderProxyPlan {
  mode: ProxyMode
  effectiveUrl: string
  endpointHost?: string
  applied: boolean
  reason: 'off' | 'custom_base_url' | 'system_proxy_platform_stack' | 'invalid_custom_base_url'
  route: ProviderProxyPlanRoute
  failover: {
    enabled: boolean
    decision?: ProviderFailoverDecision
  }
  health?: ProviderProxyPlanHealth
  evidence: {
    source: 'proxy-policy'
    originalUrl: string
    proxyBaseUrl?: string
  }
}

export type ProxyPolicyDecision = ProviderProxyPlan

export interface ProxyPolicyInput {
  provider: AIProvider
  model?: string
  credentialGroupId?: string
  url: string
  settings?: Pick<Settings, 'proxyMode' | 'proxyBaseUrl'>
  failoverDecision?: ProviderFailoverDecision
  health?: ProviderProxyPlanHealth
}

export function resolveProxyPolicy(input: ProxyPolicyInput): ProxyPolicyDecision {
  const mode = input.settings?.proxyMode ?? 'off'
  if (mode === 'off') return decision(mode, input.url, false, 'off', input)
  if (mode === 'system-detected') return decision(mode, input.url, true, 'system_proxy_platform_stack', input)
  const baseUrl = safeHttpUrl(input.settings?.proxyBaseUrl)
  if (!baseUrl) return decision(mode, input.url, false, 'invalid_custom_base_url', input)
  try {
    const original = new URL(input.url)
    const target = new URL(baseUrl)
    target.pathname = joinPaths(target.pathname, original.pathname)
    target.search = original.search
    target.hash = original.hash
    return decision(mode, target.toString(), true, 'custom_base_url', input)
  } catch {
    return decision(mode, input.url, false, 'invalid_custom_base_url', input)
  }
}

function decision(mode: ProxyMode, effectiveUrl: string, applied: boolean, reason: ProxyPolicyDecision['reason'], input: ProxyPolicyInput): ProxyPolicyDecision {
  return {
    mode,
    effectiveUrl,
    applied,
    reason,
    endpointHost: endpointHost(effectiveUrl),
    route: {
      providerId: input.provider.id,
      model: input.model ?? input.provider.models[0],
      credentialGroupId: input.credentialGroupId,
      region: input.provider.tokenPlanRegion,
      endpointHost: endpointHost(input.url),
    },
    failover: {
      enabled: input.failoverDecision?.eligible === true,
      decision: input.failoverDecision,
    },
    health: input.health,
    evidence: {
      source: 'proxy-policy',
      originalUrl: input.url,
      proxyBaseUrl: input.settings?.proxyBaseUrl,
    },
  }
}

function endpointHost(url: string): string | undefined {
  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}

function joinPaths(basePath: string, endpointPath: string): string {
  const base = basePath.replace(/\/+$/, '')
  const endpoint = endpointPath.replace(/^\/+/, '')
  return `${base}/${endpoint}`.replace(/^\/\//, '/')
}
