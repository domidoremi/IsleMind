import type { AIProvider } from '@/types'
import { getProviderEffectiveBaseUrl } from '@/types'

const AZURE_OPENAI_HOST_PATTERN = /(^|\.)openai\.azure\.com$|(^|\.)services\.ai\.azure\.com$/i
const AZURE_OPENAI_TEXT_PATTERN = /azure[-_ ]?openai|azure openai|microsoft foundry/i
const AZURE_OPENAI_V1_PATH_PATTERN = /\/openai\/v1(?:\/|$)/i
const AZURE_OPENAI_LEGACY_DEPLOYMENT_PATTERN = /\/openai\/deployments\//i

export function isAzureOpenAIProvider(provider: AIProvider): boolean {
  if (provider.presetId === 'azure-openai' || provider.detectedPresetId === 'azure-openai') return true
  if (AZURE_OPENAI_TEXT_PATTERN.test(providerIdentityText(provider))) return true
  try {
    return AZURE_OPENAI_HOST_PATTERN.test(new URL(getProviderEffectiveBaseUrl(provider)).hostname)
  } catch {
    return /openai\.azure\.com|services\.ai\.azure\.com/i.test(getProviderEffectiveBaseUrl(provider))
  }
}

export function isAzureOpenAIV1Provider(provider: AIProvider): boolean {
  if (!isAzureOpenAIProvider(provider)) return false
  return isAzureOpenAIV1CompatibleBaseUrl(getProviderEffectiveBaseUrl(provider))
}

export function isAzureOpenAILegacyDeploymentProvider(provider: AIProvider): boolean {
  if (!isAzureOpenAIProvider(provider)) return false
  try {
    return AZURE_OPENAI_LEGACY_DEPLOYMENT_PATTERN.test(new URL(getProviderEffectiveBaseUrl(provider)).pathname)
  } catch {
    return AZURE_OPENAI_LEGACY_DEPLOYMENT_PATTERN.test(getProviderEffectiveBaseUrl(provider))
  }
}

export function normalizeAzureOpenAIBaseUrl(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl.trim())
    if (!AZURE_OPENAI_HOST_PATTERN.test(parsed.hostname)) return baseUrl
    if (AZURE_OPENAI_LEGACY_DEPLOYMENT_PATTERN.test(parsed.pathname)) return baseUrl

    const path = parsed.pathname.replace(/\/+$/, '')
    if (!path || path === '/') {
      parsed.pathname = '/openai/v1'
    } else if (/\/openai$/i.test(path)) {
      parsed.pathname = `${path}/v1`
    } else if (AZURE_OPENAI_V1_PATH_PATTERN.test(path)) {
      parsed.pathname = path.replace(/(\/openai\/v1)(?:\/.*)?$/i, '$1')
    }
    return trimUrl(parsed)
  } catch {
    return baseUrl
  }
}

function isAzureOpenAIV1CompatibleBaseUrl(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl.trim())
    if (!AZURE_OPENAI_HOST_PATTERN.test(parsed.hostname)) return false
    if (AZURE_OPENAI_LEGACY_DEPLOYMENT_PATTERN.test(parsed.pathname)) return false
    const path = parsed.pathname.replace(/\/+$/, '')
    return !path || path === '/' || /\/openai$/i.test(path) || AZURE_OPENAI_V1_PATH_PATTERN.test(path)
  } catch {
    return false
  }
}

function trimUrl(url: URL): string {
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/+$/, '')
}

function providerIdentityText(provider: AIProvider): string {
  return [provider.id, provider.name, provider.baseUrl, provider.models?.join(' '), provider.presetId, provider.detectedPresetId]
    .filter(Boolean)
    .join(' ')
}
