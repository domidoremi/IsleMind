import { st } from '@/i18n/service'
import { createProviderRegistry, PROVIDER_PRESETS, PROVIDER_VENDOR_PRESETS } from '@/modules/providers'
import { resolveProviderModelAliasAccess } from '@/bootstrap/providerModelAccess'
import { getProviderConfigIssue } from '@/types/providerBaseUrls'

const registry = createProviderRegistry({
  translate: st,
  configurationIssue(baseUrl, apiKey) {
    return getProviderConfigIssue({ type: 'openai-compatible', baseUrl }, apiKey)
  },
  resolveModelAccess: resolveProviderModelAliasAccess,
  fetch,
})

export { PROVIDER_PRESETS, PROVIDER_VENDOR_PRESETS }
export type {
  ProviderDetectionInput,
  ProviderDetectionResult,
  ProviderImportDraft,
  ProviderImportDraftOptions,
  ProviderImportOptions,
  ProviderImportResult,
  ProviderPreset,
  ProviderProbeResult,
} from '@/modules/providers'
export const getProviderPreset = registry.getProviderPreset
export const detectProviderPreset = registry.detectProviderPreset
export const probeProviderPreset = registry.probeProviderPreset
export const applyProviderPreset = registry.applyProviderPreset
export const parseCredentialGroups = registry.parseCredentialGroups
export const parseProviderImportText = registry.parseProviderImportText
export const parseProviderImportDraft = registry.parseProviderImportDraft
export const countDetectedProviderImports = registry.countDetectedProviderImports
export const formatProviderNameList = registry.formatProviderNameList
export const looksLikeProviderImportConnectionText = registry.looksLikeProviderImportConnectionText
export const maskSecret = registry.maskSecret
export const normalizeProviderSyncPolicy = registry.normalizeProviderSyncPolicy
export const defaultProviderSyncPolicy = registry.defaultProviderSyncPolicy
