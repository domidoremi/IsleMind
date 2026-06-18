import type {
  AIProvider,
  ChatErrorCode,
  ProviderCredentialMode,
  ProviderRegion,
  ProviderWireProtocol,
} from './index'

export const XIAOMI_MIMO_PAYG_BASE_URL = 'https://api.xiaomimimo.com/v1'
export const XIAOMI_MIMO_TOKEN_PLAN_BASE_URLS: Record<ProviderRegion, string> = {
  cn: 'https://token-plan-cn.xiaomimimo.com/v1',
  sgp: 'https://token-plan-sgp.xiaomimimo.com/v1',
  ams: 'https://token-plan-ams.xiaomimimo.com/v1',
}
export const XIAOMI_MIMO_TOKEN_PLAN_ANTHROPIC_BASE_URLS: Record<ProviderRegion, string> = {
  cn: 'https://token-plan-cn.xiaomimimo.com/anthropic',
  sgp: 'https://token-plan-sgp.xiaomimimo.com/anthropic',
  ams: 'https://token-plan-ams.xiaomimimo.com/anthropic',
}

export interface ProviderConfigIssue {
  code: ChatErrorCode
  message: string
  messageKey?: string
}

export function detectProviderCredentialMode(apiKey: string): ProviderCredentialMode | null {
  const key = apiKey.trim()
  if (/^tp-[\w-]+/i.test(key)) return 'token-plan'
  if (/^sk-[\w-]+/i.test(key)) return 'payg'
  return null
}

export function getXiaomiMimoOfficialBaseUrl(
  mode: ProviderCredentialMode = 'token-plan',
  region: ProviderRegion = 'cn',
  wireProtocol: ProviderWireProtocol = 'openai-compatible'
): string {
  if (wireProtocol === 'anthropic-compatible') {
    return mode === 'token-plan' ? XIAOMI_MIMO_TOKEN_PLAN_ANTHROPIC_BASE_URLS[region] : XIAOMI_MIMO_PAYG_BASE_URL.replace(/\/v1$/, '/anthropic')
  }
  return mode === 'token-plan' ? XIAOMI_MIMO_TOKEN_PLAN_BASE_URLS[region] : XIAOMI_MIMO_PAYG_BASE_URL
}

export function getProviderOfficialBaseUrl(provider: Pick<AIProvider, 'type' | 'credentialMode' | 'tokenPlanRegion' | 'wireProtocol'>): string {
  switch (provider.type) {
    case 'openai':
      return 'https://api.openai.com/v1'
    case 'anthropic':
      return 'https://api.anthropic.com/v1'
    case 'google':
      return 'https://generativelanguage.googleapis.com/v1beta'
    case 'xiaomi-mimo':
      return getXiaomiMimoOfficialBaseUrl(provider.credentialMode ?? 'token-plan', provider.tokenPlanRegion ?? 'cn', provider.wireProtocol ?? 'openai-compatible')
    case 'openai-compatible':
      return 'https://api.openai.com/v1'
  }
}

export function getProviderEffectiveBaseUrl(provider: Pick<AIProvider, 'type' | 'baseUrl' | 'credentialMode' | 'tokenPlanRegion' | 'wireProtocol'>): string {
  return provider.baseUrl?.trim() || getProviderOfficialBaseUrl(provider)
}

export function hasCustomProviderBaseUrl(provider: Pick<AIProvider, 'baseUrl'>): boolean {
  return !!provider.baseUrl?.trim()
}

export function sanitizeProviderBaseUrl(value: string | undefined): string | undefined {
  const baseUrl = value?.trim()
  if (!baseUrl) return undefined
  try {
    const parsed = new URL(baseUrl)
    if (parsed.username || parsed.password) return undefined
  } catch {
    return baseUrl
  }
  return baseUrl
}

export function isHttpProviderBaseUrl(provider: Pick<AIProvider, 'type' | 'baseUrl' | 'credentialMode' | 'tokenPlanRegion' | 'wireProtocol'>): boolean {
  const baseUrl = getProviderEffectiveBaseUrl(provider)
  try {
    const parsed = new URL(baseUrl)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.username && !parsed.password
  } catch {
    return !hasCustomProviderBaseUrl(provider)
  }
}

export function getProviderConfigIssue(provider: Pick<AIProvider, 'type' | 'baseUrl' | 'credentialMode' | 'tokenPlanRegion' | 'wireProtocol'>, apiKey = ''): ProviderConfigIssue | null {
  if (hasCustomProviderBaseUrl(provider) && !isHttpProviderBaseUrl(provider)) {
    return {
      code: 'bad_base_url',
      messageKey: 'providerIssue.invalidBaseUrl',
      message: 'providerIssue.invalidBaseUrl',
    }
  }
  if (provider.type !== 'xiaomi-mimo') return null
  const keyMode = detectProviderCredentialMode(apiKey)
  const selectedMode = provider.credentialMode ?? 'token-plan'
  const selectedProtocol = provider.wireProtocol ?? 'openai-compatible'
  const baseUrl = getProviderEffectiveBaseUrl(provider).toLowerCase()

  if (keyMode && keyMode !== selectedMode) {
    return {
      code: 'credential_mismatch',
      messageKey: keyMode === 'token-plan' ? 'providerIssue.mimoTpKeyWrongMode' : 'providerIssue.mimoSkKeyWrongMode',
      message: keyMode === 'token-plan' ? 'providerIssue.mimoTpKeyWrongMode' : 'providerIssue.mimoSkKeyWrongMode',
    }
  }

  if (keyMode === 'token-plan' && baseUrl.includes('api.xiaomimimo.com')) {
    return {
      code: 'credential_mismatch',
      messageKey: 'providerIssue.mimoTpKeyPaygUrl',
      message: 'providerIssue.mimoTpKeyPaygUrl',
    }
  }

  if (keyMode === 'payg' && baseUrl.includes('token-plan-')) {
    return {
      code: 'credential_mismatch',
      messageKey: 'providerIssue.mimoSkKeyTokenPlanUrl',
      message: 'providerIssue.mimoSkKeyTokenPlanUrl',
    }
  }

  if (selectedMode === 'token-plan' && provider.baseUrl && !baseUrl.includes('token-plan-')) {
    return {
      code: 'credential_mismatch',
      messageKey: 'providerIssue.mimoTokenPlanCustomUrl',
      message: 'providerIssue.mimoTokenPlanCustomUrl',
    }
  }

  if (selectedMode === 'payg' && provider.baseUrl && baseUrl.includes('token-plan-')) {
    return {
      code: 'credential_mismatch',
      messageKey: 'providerIssue.mimoPaygCustomUrl',
      message: 'providerIssue.mimoPaygCustomUrl',
    }
  }

  if (selectedProtocol === 'openai-compatible' && baseUrl.includes('/anthropic')) {
    return {
      code: 'credential_mismatch',
      messageKey: 'providerIssue.openaiProtocolAnthropicUrl',
      message: 'providerIssue.openaiProtocolAnthropicUrl',
    }
  }

  if (selectedProtocol === 'anthropic-compatible' && provider.baseUrl && !baseUrl.includes('/anthropic')) {
    return {
      code: 'credential_mismatch',
      messageKey: 'providerIssue.anthropicProtocolUrl',
      message: 'providerIssue.anthropicProtocolUrl',
    }
  }

  return null
}
