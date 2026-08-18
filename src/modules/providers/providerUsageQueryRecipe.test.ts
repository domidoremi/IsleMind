import {
  createProviderUsageQueryConfiguration,
  normalizeProviderUsageQueryConfiguration,
  parseProviderUsageQueryRecipesText,
  providerUsageQueryConfigurationFingerprint,
  PROVIDER_USAGE_QUERY_CONFIGURATION_SCHEMA,
  PROVIDER_USAGE_QUERY_EXAMPLE,
  PROVIDER_USAGE_QUERY_EXAMPLE_RECIPE,
} from './providerUsageQueryRecipe'

describe('provider usage query configuration', () => {
  it('keeps custom usage queries disabled for legacy provider records', () => {
    expect(normalizeProviderUsageQueryConfiguration(undefined)).toEqual({
      schema: PROVIDER_USAGE_QUERY_CONFIGURATION_SCHEMA,
      enabled: false,
      recipes: [],
    })
  })

  it('parses and canonicalizes the safe data-only JSON recipe', () => {
    const recipes = parseProviderUsageQueryRecipesText(JSON.stringify(PROVIDER_USAGE_QUERY_EXAMPLE_RECIPE))
    const configuration = createProviderUsageQueryConfiguration(true, recipes)

    expect(configuration.enabled).toBe(true)
    expect(configuration.recipes).toHaveLength(1)
    expect(configuration.recipes[0]).toEqual(PROVIDER_USAGE_QUERY_EXAMPLE_RECIPE)
    expect(providerUsageQueryConfigurationFingerprint(configuration)).toMatch(/^1:1:/)
  })

  it('fails closed for absolute endpoints and malformed persisted recipes', () => {
    const absoluteRecipe = {
      ...PROVIDER_USAGE_QUERY_EXAMPLE_RECIPE,
      path: 'https://billing.example.com/v1/usage',
    }
    expect(() => parseProviderUsageQueryRecipesText(JSON.stringify(absoluteRecipe))).toThrow()
    expect(normalizeProviderUsageQueryConfiguration({
      schema: PROVIDER_USAGE_QUERY_CONFIGURATION_SCHEMA,
      enabled: true,
      recipes: [absoluteRecipe],
    }).enabled).toBe(false)
  })

  it('never accepts the JavaScript compatibility example as executable configuration', () => {
    expect(PROVIDER_USAGE_QUERY_EXAMPLE).toContain('extractor": function(response)')
    expect(() => parseProviderUsageQueryRecipesText(PROVIDER_USAGE_QUERY_EXAMPLE)).toThrow()
  })
})
