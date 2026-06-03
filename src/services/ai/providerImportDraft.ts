import type { AIProvider, ProviderCredentialGroup, ProviderPresetId, ProviderWireProtocol } from '@/types'
import { DEFAULT_PROVIDER_PRESET_ID, DEFAULT_PROVIDER_WIRE_PROTOCOL, inferProviderWireProtocolFromBaseUrl } from '@/services/ai/providerConfigPolicy'
import { parseProviderImportText, type ProviderImportResult } from '@/services/ai/providerRegistry'

export interface ProviderImportDraft {
  provider: AIProvider
  result: ProviderImportResult
  count: number
  presetId: ProviderPresetId
  baseUrl: string
  wireProtocol: ProviderWireProtocol
  credentialText: string
  modelText: string
}

export interface ProviderImportDraftOptions {
  requireConnection?: boolean
  preferredWireProtocol?: ProviderWireProtocol
}

export function parseProviderImportDraft(input: string, options: ProviderImportDraftOptions = {}): ProviderImportDraft | null {
  const result = parseProviderImportText(input)
  const candidates = result.providers.filter((item) => isProviderImportDraftCandidate(item, options.requireConnection))
  const provider = selectProviderImportDraftCandidate(candidates, options)
  if (!provider) return null
  const credentialText = providerCredentialGroupsToText(provider.credentialGroups, provider.apiKey)
  const baseUrl = provider.baseUrl?.trim() ?? ''
  const presetId = provider.presetId ?? provider.detectedPresetId ?? DEFAULT_PROVIDER_PRESET_ID
  const wireProtocol = provider.wireProtocol ?? (baseUrl ? inferProviderWireProtocolFromBaseUrl(baseUrl) : DEFAULT_PROVIDER_WIRE_PROTOCOL)
  return {
    provider,
    result,
    count: result.providers.length,
    presetId,
    baseUrl,
    wireProtocol,
    credentialText,
    modelText: provider.models.join('\n'),
  }
}

function selectProviderImportDraftCandidate(providers: AIProvider[], options: ProviderImportDraftOptions): AIProvider | undefined {
  if (!options.preferredWireProtocol) return providers[0]
  return providers.find((provider) => providerImportWireProtocol(provider) === options.preferredWireProtocol) ?? providers[0]
}

function providerImportWireProtocol(provider: AIProvider): ProviderWireProtocol {
  const baseUrl = provider.baseUrl?.trim() ?? ''
  return provider.wireProtocol ?? (baseUrl ? inferProviderWireProtocolFromBaseUrl(baseUrl) : DEFAULT_PROVIDER_WIRE_PROTOCOL)
}

export function looksLikeProviderImportConnectionText(input: string): boolean {
  const trimmed = input.trim()
  if (!trimmed) return false
  if (/^[\[{]/.test(trimmed)) return true
  return /https?:\/\//i.test(trimmed) && /(?:sk|tp|ak|rk|pk|key|token)-[A-Za-z0-9._:-]+|[A-Za-z0-9_-]{24,}/i.test(trimmed)
}

export function providerCredentialGroupsToText(groups: ProviderCredentialGroup[] | undefined, apiKey = ''): string {
  const seen = new Set<string>()
  return [
    apiKey,
    ...(groups ?? []).map((group) => group.apiKey ?? ''),
  ]
    .map((key) => key.trim())
    .filter((key) => {
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .join('\n')
}

function isProviderImportDraftCandidate(provider: AIProvider, requireConnection = false): boolean {
  const hasCredential = !!provider.apiKey.trim() || !!provider.credentialGroups?.some((group) => group.apiKey?.trim())
  if (!hasCredential) return false
  return !requireConnection || !!provider.baseUrl?.trim()
}
