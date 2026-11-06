import { createProviderRegistry } from './providerRegistry'

const registry = createProviderRegistry({
  translate: (_key, _variables, fallback) => fallback ?? 'local fixture',
  configurationIssue: () => null,
  resolveModelAccess: () => ({ allowed: true }),
  fetch: jest.fn() as unknown as typeof fetch,
})

const gatewayKey = 'sk-local-magpie-gateway-fixture'
const models = [
  'auto/deepseek-v4.1-flash',
  'relay/sk-this-is-a-model-name',
  'cloudflare-workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast',
]

it('preserves supplier prefixes and nested paths when importing gateway models from JSON', () => {
  const result = registry.parseProviderImportText(JSON.stringify({
    name: 'Magpie',
    baseUrl: 'http://127.0.0.1:3425/v1',
    apiKey: gatewayKey,
    models,
  }))

  expect(result.providers).toHaveLength(1)
  expect(result.providers[0].models).toEqual(models)
})

it.each(['Models', '模型列表'])('does not extract credentials from a %s field containing model names', label => {
  const result = registry.parseProviderImportText([
    'Name: Magpie',
    'Base URL: http://127.0.0.1:3425/v1',
    `Key: ${gatewayKey}`,
    `${label}: ${models.join('|')}`,
  ].join('\n'))

  expect(result.providers).toHaveLength(1)
  expect(result.providers[0].credentialGroups?.map(group => group.apiKey)).toEqual([gatewayKey])
})

it('keeps named extra credentials alongside an explicit key and a prefixed model list', () => {
  const backupKey = 'sk-local-magpie-backup-fixture'
  const result = registry.parseProviderImportText([
    'Name: Magpie',
    'Base URL: http://127.0.0.1:3425/v1',
    `Key: ${gatewayKey}`,
    `backup ${backupKey}`,
    `Models: ${models.join('|')}`,
  ].join('\n'))

  expect(result.providers[0].credentialGroups?.map(group => group.apiKey)).toEqual([gatewayKey, backupKey])
  expect(result.providers[0].credentialGroups?.[1].label).toBe('backup')
})
