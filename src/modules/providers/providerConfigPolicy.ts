import type {
  AIProvider,
  ProviderCredentialMode,
  ProviderPresetId,
  ProviderRegion,
  ProviderWireProtocol,
} from '@/types/providerContracts'
import {
  detectProviderCredentialMode,
  getXiaomiMimoOfficialBaseUrl,
} from '@/types/providerBaseUrls'

export const DEFAULT_PROVIDER_PRESET_ID: ProviderPresetId = 'custom-endpoint'
export const DEFAULT_PROVIDER_WIRE_PROTOCOL: ProviderWireProtocol = 'openai-compatible'
export const PROVIDER_WIRE_PROTOCOL_OPTIONS: ProviderWireProtocol[] = [
  DEFAULT_PROVIDER_WIRE_PROTOCOL,
  'anthropic-compatible',
]

export function isProviderWireProtocol(value: unknown): value is ProviderWireProtocol {
  return typeof value === 'string'
    && PROVIDER_WIRE_PROTOCOL_OPTIONS.some((protocol) => protocol === value)
}

export interface ProviderWireRequestLike {
  provider: AIProvider
}

export function getWireProviderType(provider: AIProvider): AIProvider['type'] {
  return provider.wireProtocol === 'anthropic-compatible' ? 'anthropic' : provider.type
}

export function isAnthropicWireRequest(request: ProviderWireRequestLike): boolean {
  return request.provider.wireProtocol === 'anthropic-compatible' || request.provider.type === 'anthropic'
}

export interface ProviderConfigPresetDescriptor {
  type: AIProvider['type']
  baseUrl?: string
}

export interface ProviderConfigPolicyDependencies {
  resolvePreset(presetId: ProviderPresetId): ProviderConfigPresetDescriptor
}

export interface ProviderConfigDraftInput {
  provider: Pick<AIProvider, 'baseUrl' | 'credentialMode' | 'tokenPlanRegion' | 'wireProtocol'>
  presetId: ProviderPresetId
  baseUrl?: string
  wireProtocol?: ProviderWireProtocol
}

export interface ProviderConfigDraft {
  presetId: ProviderPresetId
  isProtocolSelectable: boolean
  baseUrl: string
  credentialMode?: ProviderCredentialMode
  tokenPlanRegion?: ProviderRegion
  wireProtocol?: ProviderWireProtocol
}

export interface ProviderConfigPolicy {
  resolveProviderConfigDraft(input: ProviderConfigDraftInput): ProviderConfigDraft
}

export function inferProviderWireProtocolFromBaseUrl(value?: string): ProviderWireProtocol {
  return /\/anthropic(?:\/v1)?(?:\/|$)/i.test(value ?? '')
    ? 'anthropic-compatible'
    : DEFAULT_PROVIDER_WIRE_PROTOCOL
}

export function inferProviderCredentialModeFromKeyOrBaseUrl(
  apiKeyText: string,
  baseUrl?: string,
): ProviderCredentialMode {
  return detectProviderCredentialMode(apiKeyText)
    ?? (baseUrl?.includes('api.xiaomimimo.com') ? 'payg' : 'token-plan')
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

export function normalizeProviderPresetId(
  presetId: ProviderPresetId | undefined,
): ProviderPresetId {
  return presetId ?? DEFAULT_PROVIDER_PRESET_ID
}

export function providerPresetSupportsWireProtocolSelection(
  presetId: ProviderPresetId | undefined,
): boolean {
  const normalized = normalizeProviderPresetId(presetId)
  return normalized === DEFAULT_PROVIDER_PRESET_ID || normalized === 'xiaomi-mimo'
}

export function normalizeProviderPresetSelection(input: {
  presetId?: ProviderPresetId
  detectedPresetId?: ProviderPresetId
  baseUrl?: string
  wireProtocol?: ProviderWireProtocol
}): { presetId: ProviderPresetId; wireProtocol?: ProviderWireProtocol } {
  const sourcePresetId = input.presetId ?? input.detectedPresetId
  const presetId = normalizeProviderPresetId(sourcePresetId)
  return {
    presetId,
    wireProtocol: providerPresetSupportsWireProtocolSelection(presetId)
      ? input.wireProtocol
        ?? inferProviderWireProtocolFromBaseUrl(input.baseUrl)
      : undefined,
  }
}

export function normalizeProviderIdentityMetadata<T extends {
  presetId?: ProviderPresetId
  detectedPresetId?: ProviderPresetId
  baseUrl?: string
  wireProtocol?: ProviderWireProtocol
}>(provider: T): T & {
  presetId: ProviderPresetId
  detectedPresetId: ProviderPresetId
  wireProtocol?: ProviderWireProtocol
} {
  const selection = normalizeProviderPresetSelection(provider)
  const detectedPresetId = provider.detectedPresetId
    ? normalizeProviderPresetId(provider.detectedPresetId)
    : selection.presetId
  return {
    ...provider,
    presetId: selection.presetId,
    detectedPresetId,
    wireProtocol: selection.wireProtocol,
  }
}

export function initialProviderPresetId(
  provider: Pick<AIProvider, 'presetId' | 'detectedPresetId'>,
): ProviderPresetId {
  return normalizeProviderPresetSelection(provider).presetId
}

export function initialProviderWireProtocol(
  provider: Pick<AIProvider, 'baseUrl' | 'wireProtocol' | 'presetId' | 'detectedPresetId'>,
): ProviderWireProtocol {
  return normalizeProviderPresetSelection(provider).wireProtocol ?? DEFAULT_PROVIDER_WIRE_PROTOCOL
}

export function shouldSyncWireProtocolFromBaseUrl(
  input: Pick<ProviderConfigDraft, 'isProtocolSelectable'>,
): boolean {
  return input.isProtocolSelectable
}

export function createProviderConfigPolicy(
  dependencies: ProviderConfigPolicyDependencies,
): ProviderConfigPolicy {
  function resolveProviderConfigDraft(input: ProviderConfigDraftInput): ProviderConfigDraft {
    const selection = normalizeProviderPresetSelection({
      presetId: input.presetId,
      baseUrl: input.baseUrl ?? input.provider.baseUrl,
      wireProtocol: input.wireProtocol ?? input.provider.wireProtocol,
    })
    const preset = dependencies.resolvePreset(selection.presetId)
    const nextWireProtocol = selection.wireProtocol ?? DEFAULT_PROVIDER_WIRE_PROTOCOL
    const isProtocolSelectable = providerPresetSupportsWireProtocolSelection(selection.presetId)
    const isXiaomiMimo = selection.presetId === 'xiaomi-mimo'
    const credentialMode = isXiaomiMimo
      ? defaultProviderCredentialMode(input.provider.credentialMode)
      : undefined
    const tokenPlanRegion = isXiaomiMimo
      ? defaultProviderTokenPlanRegion(input.provider.tokenPlanRegion)
      : undefined
    return {
      presetId: selection.presetId,
      isProtocolSelectable,
      baseUrl: resolveDraftBaseUrl({
        typedBaseUrl: input.baseUrl,
        presetBaseUrl: preset.baseUrl,
        useXiaomiMimoOfficialBaseUrl: isXiaomiMimo,
        credentialMode,
        tokenPlanRegion,
        wireProtocol: nextWireProtocol,
      }),
      credentialMode,
      tokenPlanRegion,
      wireProtocol: isProtocolSelectable ? nextWireProtocol : undefined,
    }
  }

  return {
    resolveProviderConfigDraft,
  }
}

function resolveDraftBaseUrl(input: {
  typedBaseUrl?: string
  presetBaseUrl?: string
  useXiaomiMimoOfficialBaseUrl: boolean
  credentialMode?: ProviderCredentialMode
  tokenPlanRegion?: ProviderRegion
  wireProtocol: ProviderWireProtocol
}): string {
  const typedBaseUrl = input.typedBaseUrl?.trim()
  if (typedBaseUrl && (!input.useXiaomiMimoOfficialBaseUrl || !isReplaceableOfficialBaseUrl(typedBaseUrl))) return typedBaseUrl
  if (input.useXiaomiMimoOfficialBaseUrl) {
    return getXiaomiMimoOfficialBaseUrl(
      input.credentialMode ?? 'token-plan',
      input.tokenPlanRegion ?? 'cn',
      input.wireProtocol,
    )
  }
  return typedBaseUrl || input.presetBaseUrl || ''
}

function isReplaceableOfficialBaseUrl(value?: string): boolean {
  const trimmed = value?.trim()
  if (!trimmed) return true
  return /^https:\/\/(?:api|token-plan-(?:cn|sgp|ams))\.xiaomimimo\.com(?:\/(?:v1|anthropic(?:\/v1)?))?\/?$/i.test(trimmed)
}
