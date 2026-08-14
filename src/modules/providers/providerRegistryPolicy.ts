import type { AIProvider, ProviderCapabilities, ProviderPresetId, ProviderType, ProviderWireProtocol } from '@/types/providerContracts'
import { getProviderRequestHeaders } from './providerHeaders'
import { isGitHubModelsProvider } from './providerIdentityPolicy'
import { resolveProviderModelDiscoveryEndpoint } from './providerModelDiscoveryAdapter'
import { defaultOpenAICompatibleBaseUrl } from './providerRouteAssembly'
import { normalizeProviderIdentityMetadata } from './providerConfigPolicy'

export interface ProviderPresetDescriptor {
  id: ProviderPresetId
  name: string
  type: ProviderType
  baseUrl?: string
  aliases: string[]
  hostPatterns: RegExp[]
  capabilities: ProviderCapabilities
  defaultModels: string[]
}
export interface ProviderDetectionInput { baseUrl?: string; apiKey?: string; name?: string }
export interface ProviderDetectionResult { presetId: ProviderPresetId; wireProtocol?: ProviderWireProtocol; confidence: 'high' | 'medium' | 'low'; reason: string }
export interface ProviderProbeResult extends ProviderDetectionResult { ok: boolean; endpoint?: string; status?: number }
export interface ProviderProbeOptions { fetch: typeof fetch; timeoutMs?: number; signal?: AbortSignal }
export interface ProviderRegistryMessages {
  detectedHost(value: string): string
  nameContains(name: string): string
  skCompatible(): string
  unknownCompatible(): string
  probeSkippedMissing(reason: string): string
  invalidConfiguration(messageKey: string, fallback: string): string
  probeSuccess(name: string): string
  probeMiss(reason: string): string
}
export interface ProviderRegistryPolicyDependencies {
  presets: readonly ProviderPresetDescriptor[]
  messages: ProviderRegistryMessages
  configurationIssue(baseUrl: string, apiKey: string): { code: string; message: string; messageKey?: string } | null
  normalizeSyncPolicy(policy: AIProvider['syncPolicy'] | undefined): NonNullable<AIProvider['syncPolicy']>
}

export function createProviderRegistryPolicy(dependencies: ProviderRegistryPolicyDependencies) {
  const fallbackPreset = () => dependencies.presets.find((item) => item.id === 'custom-endpoint')!
  function getPreset(id: ProviderPresetId | undefined): ProviderPresetDescriptor {
    return dependencies.presets.find((item) => item.id === id) ?? fallbackPreset()
  }
  function detect(input: ProviderDetectionInput): ProviderDetectionResult {
    const baseUrl = input.baseUrl?.trim() ?? ''
    const normalizedName = input.name?.toLowerCase() ?? ''
    const host = getHost(baseUrl)
    for (const item of dependencies.presets) {
      if (item.hostPatterns.some((pattern) => pattern.test(host) || pattern.test(baseUrl))) {
        return { presetId: item.id, confidence: 'high', reason: dependencies.messages.detectedHost(host || baseUrl) }
      }
    }
    for (const item of dependencies.presets) {
      if (item.aliases.some((alias) => normalizedName.includes(alias))) {
        return { presetId: item.id, confidence: 'medium', reason: dependencies.messages.nameContains(item.name) }
      }
    }
    const wireProtocol = /\/anthropic(?:\/v1)?(?:\/|$)/i.test(baseUrl)
      ? 'anthropic-compatible'
      : 'openai-compatible'
    return /^sk-[\w-]+/i.test(input.apiKey ?? '')
      ? { presetId: 'custom-endpoint', wireProtocol, confidence: 'low', reason: dependencies.messages.skCompatible() }
      : { presetId: 'custom-endpoint', wireProtocol, confidence: 'low', reason: dependencies.messages.unknownCompatible() }
  }
  function apply<T extends Partial<AIProvider>>(provider: T, presetId: ProviderPresetId): T & Pick<AIProvider, 'type' | 'name' | 'models'> {
    const identity = normalizeProviderIdentityMetadata({ ...provider, presetId })
    const target = getPreset(identity.presetId)
    return {
      ...identity,
      detectionStatus: provider.detectionStatus ?? 'detected',
      type: target.type,
      name: provider.name?.trim() || target.name,
      baseUrl: provider.baseUrl ?? target.baseUrl,
      capabilities: { ...target.capabilities, ...provider.capabilities },
      syncPolicy: dependencies.normalizeSyncPolicy(provider.syncPolicy),
      models: Array.isArray(provider.models) ? provider.models : [],
    }
  }
  async function probe(input: ProviderDetectionInput, options: ProviderProbeOptions): Promise<ProviderProbeResult> {
    const heuristic = detect(input); const baseUrl = input.baseUrl?.trim(); const apiKey = input.apiKey?.trim()
    if (!baseUrl || !apiKey) return { ...heuristic, ok: false, reason: dependencies.messages.probeSkippedMissing(heuristic.reason) }
    const issue = dependencies.configurationIssue(baseUrl, apiKey)
    if (issue?.code === 'bad_base_url') return { ...heuristic, ok: false, reason: dependencies.messages.invalidConfiguration(issue.messageKey ?? issue.message, issue.message) }
    const probeProvider = {
      id: 'probe',
      type: 'openai-compatible' as const,
      name: input.name?.trim() || 'Probe',
      apiKey,
      baseUrl: normalizeProbeBaseUrl(baseUrl),
      models: [],
      enabled: false,
      presetId: heuristic.presetId,
      detectedPresetId: heuristic.presetId,
    }
    const openAIBase = normalizeProbeBaseUrl(defaultOpenAICompatibleBaseUrl(probeProvider))
    const openAIHeaders = getProviderRequestHeaders(probeProvider)
    const openAICandidate = { presetId: 'custom-endpoint' as ProviderPresetId, wireProtocol: 'openai-compatible' as ProviderWireProtocol, endpoint: resolveProviderModelDiscoveryEndpoint(probeProvider, openAIBase), headers: openAIHeaders }
    const anthropicProvider = { ...probeProvider, wireProtocol: 'anthropic-compatible' as const }
    const anthropicCandidate = { presetId: 'custom-endpoint' as ProviderPresetId, wireProtocol: 'anthropic-compatible' as ProviderWireProtocol, endpoint: `${normalizeProbeBaseUrl(baseUrl)}/models`, headers: getProviderRequestHeaders(anthropicProvider) }
    const candidates: Array<{ presetId: ProviderPresetId; wireProtocol?: ProviderWireProtocol; endpoint: string; headers: Record<string, string> }> = [
      ...(heuristic.wireProtocol === 'anthropic-compatible' ? [anthropicCandidate, openAICandidate] : [openAICandidate, anthropicCandidate]),
      { presetId: 'google' as ProviderPresetId, endpoint: `${normalizeProbeBaseUrl(baseUrl)}/models`, headers: getProviderRequestHeaders({ ...probeProvider, type: 'google' as const, presetId: 'google' as const, detectedPresetId: 'google' as const }) },
    ]
    for (const candidate of candidates) {
      const result = await probeModelsEndpoint(options.fetch, candidate.endpoint, candidate.headers, options.timeoutMs ?? 6000, options.signal)
      if (!result.ok) continue
      const matched = mapProbePreset(candidate.presetId, baseUrl, heuristic, dependencies.presets, getPreset)
      return { presetId: matched, wireProtocol: matched === 'custom-endpoint' ? candidate.wireProtocol : undefined, confidence: candidate.wireProtocol === 'openai-compatible' && heuristic.confidence !== 'low' ? heuristic.confidence : 'medium', reason: dependencies.messages.probeSuccess(getPreset(matched).name), ok: true, endpoint: redactProbeEndpoint(candidate.endpoint), status: result.status }
    }
    return { ...heuristic, ok: false, reason: dependencies.messages.probeMiss(heuristic.reason) }
  }
  return { getPreset, detect, apply, probe }
}

async function probeModelsEndpoint(fetcher: typeof fetch, endpoint: string, headers: Record<string, string>, timeoutMs: number, signal?: AbortSignal): Promise<{ ok: boolean; status?: number }> {
  const controller = new AbortController(); const forwardAbort = () => controller.abort()
  if (signal?.aborted) controller.abort(); signal?.addEventListener('abort', forwardAbort, { once: true })
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetcher(endpoint, { method: 'GET', headers, signal: controller.signal })
    if (!response.ok) return { ok: false, status: response.status }
    const data = await response.json().catch(() => null)
    return { ok: Array.isArray((data as { data?: unknown[] } | null)?.data) || Array.isArray((data as { models?: unknown[] } | null)?.models), status: response.status }
  } catch { return { ok: false } }
  finally { clearTimeout(timeout); signal?.removeEventListener('abort', forwardAbort) }
}
function getHost(value: string): string { try { return new URL(value).host } catch { return value.replace(/^https?:\/\//i, '').split('/')[0] ?? '' } }
function normalizeProbeBaseUrl(value: string): string { const trimmed = value.trim().replace(/\/+$/, ''); return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}` }
function redactProbeEndpoint(endpoint: string): string { return endpoint.replace(/([?&][^=&#]*(?:api[_-]?key|key|token|secret|password)[^=&#]*=)[^&#]+/gi, '$1[redacted]') }
function mapProbePreset(id: ProviderPresetId, baseUrl: string, heuristic: ProviderDetectionResult, presets: readonly ProviderPresetDescriptor[], getPreset: (id: ProviderPresetId) => ProviderPresetDescriptor): ProviderPresetId {
  const candidate = getPreset(id)
  if (heuristic.confidence !== 'low') return heuristic.presetId
  return presets.find((item) => item.hostPatterns.some((pattern) => pattern.test(baseUrl)) && item.type === candidate.type)?.id ?? id
}
