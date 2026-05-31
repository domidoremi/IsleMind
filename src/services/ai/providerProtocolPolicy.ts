import type { ProviderCredentialMode, ProviderRegion, ProviderWireProtocol } from '@/types'
import { detectProviderCredentialMode } from '@/types'

export const DEFAULT_PROVIDER_WIRE_PROTOCOL: ProviderWireProtocol = 'openai-compatible'

export const PROVIDER_WIRE_PROTOCOL_OPTIONS: ProviderWireProtocol[] = [DEFAULT_PROVIDER_WIRE_PROTOCOL, 'anthropic-compatible']

export function inferProviderWireProtocolFromBaseUrl(value?: string): ProviderWireProtocol {
  return /\/anthropic(?:\/v1)?(?:\/|$)/i.test(value ?? '') ? 'anthropic-compatible' : DEFAULT_PROVIDER_WIRE_PROTOCOL
}

export function inferProviderCredentialModeFromKeyOrBaseUrl(apiKeyText: string, baseUrl?: string): ProviderCredentialMode {
  return detectProviderCredentialMode(apiKeyText) ?? (baseUrl?.includes('api.xiaomimimo.com') ? 'payg' : 'token-plan')
}

export function inferProviderTokenPlanRegionFromBaseUrl(baseUrl?: string): ProviderRegion {
  const normalized = baseUrl?.toLowerCase() ?? ''
  if (normalized.includes('token-plan-sgp.')) return 'sgp'
  if (normalized.includes('token-plan-ams.')) return 'ams'
  return 'cn'
}

export function defaultProviderCredentialMode(value?: ProviderCredentialMode): ProviderCredentialMode {
  return value ?? 'token-plan'
}

export function defaultProviderTokenPlanRegion(value?: ProviderRegion): ProviderRegion {
  return value ?? 'cn'
}

export function defaultProviderWireProtocol(value?: ProviderWireProtocol): ProviderWireProtocol {
  return value ?? DEFAULT_PROVIDER_WIRE_PROTOCOL
}
