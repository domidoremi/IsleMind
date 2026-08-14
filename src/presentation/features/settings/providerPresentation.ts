import type { AIProvider } from '@/types/providerContracts'

type ProviderIdentityInput = Pick<AIProvider, 'name' | 'baseUrl' | 'presetId' | 'detectedPresetId'>

const GENERIC_PROVIDER_NAMES = new Set([
  'openai compatible',
  'openai-compatible',
  'custom openai compatible',
  'custom openai-compatible',
  'openai 兼容',
  'anthropic compatible',
  'anthropic-compatible',
  'custom anthropic compatible',
  'custom anthropic-compatible',
  'anthropic 兼容',
  'openai 互換',
  'anthropic 互換',
])

function normalizedProviderName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

export function resolveProviderEndpointHost(baseUrl?: string): string | undefined {
  const value = baseUrl?.trim()
  if (!value) return undefined

  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
    return url.host || undefined
  } catch {
    return undefined
  }
}

export function hasGenericProviderName(provider: ProviderIdentityInput): boolean {
  const name = normalizedProviderName(provider.name)
  if (!name) return true
  if (GENERIC_PROVIDER_NAMES.has(name)) return true

  const presetId = provider.detectedPresetId ?? provider.presetId
  if (presetId === 'custom-endpoint' && normalizedProviderName(name) === 'custom endpoint') return true
  return presetId === 'custom-endpoint' && name === 'custom-endpoint'
}

export function resolveProviderDisplayName(provider: ProviderIdentityInput, fallbackName: string): string {
  const configuredName = provider.name.trim()
  if (configuredName && !hasGenericProviderName(provider)) return configuredName
  return resolveProviderEndpointHost(provider.baseUrl) ?? fallbackName
}
