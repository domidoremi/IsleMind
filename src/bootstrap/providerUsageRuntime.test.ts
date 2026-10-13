import { invalidateProviderUsage, queryProviderUsage } from './providerUsageRuntime'
import { createProviderUsageQueryConfiguration, PROVIDER_USAGE_QUERY_EXAMPLE_RECIPE } from '@/modules/providers'
import type { AIProvider } from '@/types/providerContracts'

const mockRequest = jest.fn()
jest.mock('./providerTransport', () => ({ providerTransport: { request: (...args: unknown[]) => mockRequest(...args) } }))
jest.mock('./secureCredentialStorage', () => ({
  providerCredentialStorage: {
    getProviderCredential: async () => 'fixture-primary',
    getCredentialGroupCredential: async () => 'fixture-alternate',
  },
}))
const provider: AIProvider = {
  id: 'usage-fixture', name: 'Fixture', type: 'openai-compatible', enabled: true,
  apiKey: '', baseUrl: 'https://example.test/v1', models: ['fixture-model'],
  credentialGroups: [{ id: 'alternate', label: 'Alternate', enabled: true, apiKey: '' }],
  usageQueryConfiguration: createProviderUsageQueryConfiguration(true, [
    { ...PROVIDER_USAGE_QUERY_EXAMPLE_RECIPE, path: '/usage-a' },
    { ...PROVIDER_USAGE_QUERY_EXAMPLE_RECIPE, path: '/usage-b' },
  ]),
}
beforeEach(() => { invalidateProviderUsage(); mockRequest.mockReset() })

it('bounds actual transport attempts across all recipes and credentials', async () => {
  mockRequest.mockRejectedValue(new Error('fixture network failure'))
  expect(await queryProviderUsage(provider, { maxAttempts: 1 })).toBeNull()
  expect(mockRequest).toHaveBeenCalledTimes(1)
  expect(String(mockRequest.mock.calls[0][0])).toBe('https://example.test/usage-a')
})

it('returns the real numeric quota without making an additional request', async () => {
  mockRequest.mockResolvedValue(new Response('{"remaining":12.5,"unit":"USD"}', { status: 200 }))
  expect(await queryProviderUsage(provider, { forceRefresh: true, maxAttempts: 1 })).toMatchObject({ remaining: 12.5, unit: 'USD' })
  expect(mockRequest).toHaveBeenCalledTimes(1)
})
