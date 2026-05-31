import type { AIProvider, ProviderCredentialMode, ProviderPresetId, ProviderRegion, ProviderWireProtocol } from '@/types'
import { getXiaomiMimoOfficialBaseUrl } from '@/types'
import { getProviderPreset } from '@/services/ai/providerRegistry'
import {
  DEFAULT_PROVIDER_WIRE_PROTOCOL,
  PROVIDER_WIRE_PROTOCOL_OPTIONS,
  defaultProviderCredentialMode,
  defaultProviderTokenPlanRegion,
  defaultProviderWireProtocol,
  inferProviderCredentialModeFromKeyOrBaseUrl,
  inferProviderTokenPlanRegionFromBaseUrl,
  inferProviderWireProtocolFromBaseUrl,
} from '@/services/ai/providerProtocolPolicy'

export const DEFAULT_PROVIDER_PRESET_ID: ProviderPresetId = 'custom-openai-compatible'

export {
  DEFAULT_PROVIDER_WIRE_PROTOCOL,
  PROVIDER_WIRE_PROTOCOL_OPTIONS,
  defaultProviderCredentialMode,
  defaultProviderTokenPlanRegion,
  defaultProviderWireProtocol,
  inferProviderCredentialModeFromKeyOrBaseUrl,
  inferProviderTokenPlanRegionFromBaseUrl,
  inferProviderWireProtocolFromBaseUrl,
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

export function initialProviderPresetId(provider: Pick<AIProvider, 'presetId' | 'detectedPresetId'>): ProviderPresetId {
  return provider.presetId ?? provider.detectedPresetId ?? DEFAULT_PROVIDER_PRESET_ID
}

export function initialProviderWireProtocol(provider: Pick<AIProvider, 'baseUrl' | 'wireProtocol'>): ProviderWireProtocol {
  return provider.wireProtocol ?? inferProviderWireProtocolFromBaseUrl(provider.baseUrl)
}

export function resolveProviderConfigDraft(input: ProviderConfigDraftInput): ProviderConfigDraft {
  const preset = getProviderPreset(input.presetId)
  const nextWireProtocol = input.wireProtocol ?? input.provider.wireProtocol ?? inferProviderWireProtocolFromBaseUrl(input.baseUrl ?? input.provider.baseUrl)
  const isProtocolSelectable = preset.type === 'xiaomi-mimo'
  const credentialMode = isProtocolSelectable ? defaultProviderCredentialMode(input.provider.credentialMode) : undefined
  const tokenPlanRegion = isProtocolSelectable ? defaultProviderTokenPlanRegion(input.provider.tokenPlanRegion) : undefined
  return {
    presetId: input.presetId,
    isProtocolSelectable,
    baseUrl: resolveDraftBaseUrl({
      presetId: input.presetId,
      typedBaseUrl: input.baseUrl,
      presetBaseUrl: preset.baseUrl,
      credentialMode,
      tokenPlanRegion,
      wireProtocol: nextWireProtocol,
    }),
    credentialMode,
    tokenPlanRegion,
    wireProtocol: isProtocolSelectable ? nextWireProtocol : undefined,
  }
}

export function shouldSyncWireProtocolFromBaseUrl(input: Pick<ProviderConfigDraft, 'isProtocolSelectable'>): boolean {
  return input.isProtocolSelectable
}

function resolveDraftBaseUrl(input: {
  presetId: ProviderPresetId
  typedBaseUrl?: string
  presetBaseUrl?: string
  credentialMode?: ProviderCredentialMode
  tokenPlanRegion?: ProviderRegion
  wireProtocol: ProviderWireProtocol
}): string {
  const typedBaseUrl = input.typedBaseUrl?.trim()
  if (typedBaseUrl && !isReplaceableOfficialBaseUrl(typedBaseUrl)) return typedBaseUrl
  if (isProviderProtocolPreset(input.presetId)) {
    return getXiaomiMimoOfficialBaseUrl(input.credentialMode ?? 'token-plan', input.tokenPlanRegion ?? 'cn', input.wireProtocol)
  }
  return typedBaseUrl || input.presetBaseUrl || ''
}

function isProviderProtocolPreset(presetId: ProviderPresetId): boolean {
  return getProviderPreset(presetId).type === 'xiaomi-mimo'
}

function isReplaceableOfficialBaseUrl(value?: string): boolean {
  const trimmed = value?.trim()
  if (!trimmed) return true
  return /^https:\/\/(?:api|token-plan-(?:cn|sgp|ams))\.xiaomimimo\.com(?:\/(?:v1|anthropic(?:\/v1)?))?\/?$/i.test(trimmed)
}
