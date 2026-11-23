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

/** Display-only disambiguation. URL paths, credentials and provider IDs stay private. */
export function resolveProviderConnectionLabel(
  provider: ProviderIdentityInput & Pick<AIProvider, 'id'>,
  providers: readonly (ProviderIdentityInput & Pick<AIProvider, 'id'>)[],
  fallbackName: string,
): string {
  const name = resolveProviderDisplayName(provider, fallbackName)
  const peers = providers.filter(item => normalizedProviderName(resolveProviderDisplayName(item, fallbackName)) === normalizedProviderName(name))
  if (peers.length < 2) return name
  const host = resolveProviderEndpointHost(provider.baseUrl)
  const label = host && host !== name ? `${name} · ${host}` : name
  const sameHost = peers.filter(item => resolveProviderEndpointHost(item.baseUrl) === host).map(item => item.id).sort()
  return sameHost.length > 1 ? `${label} · ${sameHost.indexOf(provider.id) + 1}` : label
}

export function resolveProviderSupplierDisclosure(
  configurationCount: number,
  expanded: boolean,
  batchMode: boolean,
): { expandable: boolean; showConfigurations: boolean } {
  const expandable = configurationCount > 1
  return {
    expandable,
    showConfigurations: batchMode || (expandable && expanded),
  }
}
