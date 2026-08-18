import {
  getProviderConfigIssue,
  getProviderEffectiveBaseUrl,
  getProviderOfficialBaseUrl,
  isHttpProviderBaseUrl,
} from '../providerBaseUrls'

describe('provider base URL identity boundaries', () => {
  it('does not treat the OpenAI-compatible protocol as the OpenAI supplier', () => {
    expect(getProviderOfficialBaseUrl({ type: 'openai-compatible' })).toBeUndefined()
    expect(getProviderEffectiveBaseUrl({ type: 'openai-compatible' })).toBe('')
    expect(isHttpProviderBaseUrl({ type: 'openai-compatible' })).toBe(false)
    expect(getProviderConfigIssue({ type: 'openai-compatible' })?.messageKey).toBe('providerIssue.missingBaseUrl')
  })

  it('keeps actual first-party suppliers on their official endpoints', () => {
    expect(getProviderOfficialBaseUrl({ type: 'openai' })).toBe('https://api.openai.com/v1')
    expect(getProviderEffectiveBaseUrl({ type: 'anthropic' })).toBe('https://api.anthropic.com/v1')
    expect(isHttpProviderBaseUrl({ type: 'google' })).toBe(true)
  })

  it('rejects invalid custom endpoints before a provider can be saved', () => {
    expect(getProviderConfigIssue({ type: 'openai-compatible', baseUrl: 'ftp://example.test' })?.messageKey).toBe('providerIssue.invalidBaseUrl')
    expect(getProviderConfigIssue({ type: 'openai-compatible', baseUrl: 'https://example.test/v1' })).toBeNull()
  })
})
