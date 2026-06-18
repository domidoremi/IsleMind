import type { AIProvider, ProxyMode, Settings } from '@/types'
import { safeHttpUrl } from '@/utils/networkUrlSafety'

export interface ProxyPolicyDecision {
  mode: ProxyMode
  effectiveUrl: string
  endpointHost?: string
  applied: boolean
  reason: 'off' | 'custom_base_url' | 'system_proxy_platform_stack' | 'invalid_custom_base_url'
}

export interface ProxyPolicyInput {
  provider: AIProvider
  url: string
  settings?: Pick<Settings, 'proxyMode' | 'proxyBaseUrl'>
}

export function resolveProxyPolicy(input: ProxyPolicyInput): ProxyPolicyDecision {
  const mode = input.settings?.proxyMode ?? 'off'
  if (mode === 'off') return decision(mode, input.url, false, 'off')
  if (mode === 'system-detected') return decision(mode, input.url, true, 'system_proxy_platform_stack')
  const baseUrl = safeHttpUrl(input.settings?.proxyBaseUrl)
  if (!baseUrl) return decision(mode, input.url, false, 'invalid_custom_base_url')
  try {
    const original = new URL(input.url)
    const target = new URL(baseUrl)
    target.pathname = joinPaths(target.pathname, original.pathname)
    target.search = original.search
    target.hash = original.hash
    return decision(mode, target.toString(), true, 'custom_base_url')
  } catch {
    return decision(mode, input.url, false, 'invalid_custom_base_url')
  }
}

function decision(mode: ProxyMode, effectiveUrl: string, applied: boolean, reason: ProxyPolicyDecision['reason']): ProxyPolicyDecision {
  return { mode, effectiveUrl, applied, reason, endpointHost: endpointHost(effectiveUrl) }
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
