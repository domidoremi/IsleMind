import { DEFAULT_USAGE_PRICING_ENTRIES } from './usagePricingCatalog'
import { calculateUsageCost, resolveUsagePricingEntry } from './usagePricing'
import { DEFAULT_MODELS, getModelConfig } from '@/types/modelCatalog'

const occurredAt = Date.parse('2026-10-31T12:00:00+08:00')

it.each([
  ['gpt-5', 11_250_000_000],
  ['gpt-5-mini', 2_250_000_000],
  ['gpt-5-mini-2025-08-07', 2_250_000_000],
  ['gpt-5-nano', 450_000_000],
])('estimates the exact direct OpenAI model %s without family price inheritance', (model, cost) => {
  const entry = resolveUsagePricingEntry(DEFAULT_USAGE_PRICING_ENTRIES, 'direct', model, occurredAt, 'openai')
  expect(calculateUsageCost({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, entry)).toMatchObject({
    totalCostNanodollars: cost, provenance: 'price-table-estimate',
  })
  expect(entry?.sourceUrl).toContain('developers.openai.com/api/docs/models/')
  expect(entry?.billingConditions).toContain('excludes')
})

it.each(['gpt-5-pro', 'gpt-5.2-pro', 'gpt-5-unreviewed', 'gpt-6-astra', 'gemini-2.5-flash-lite'])(
  'keeps an unpriced sibling %s unavailable', model => {
    const entry = resolveUsagePricingEntry(DEFAULT_USAGE_PRICING_ENTRIES, 'direct', model, occurredAt,
      model.startsWith('gemini') ? 'google' : 'openai')
    expect(calculateUsageCost({ inputTokens: 1_000_000 }, entry)).toEqual({ provenance: 'unavailable' })
  },
)

it('does not invent a reseller price or rewrite historical mini/nano usage', () => {
  expect(resolveUsagePricingEntry(DEFAULT_USAGE_PRICING_ENTRIES, 'relay', 'gpt-5-mini', occurredAt, 'openai-compatible')).toBeUndefined()
  expect(resolveUsagePricingEntry(DEFAULT_USAGE_PRICING_ENTRIES, 'direct', 'gpt-5-mini', 0, 'openai')).toBeUndefined()
  const manual = { ...DEFAULT_USAGE_PRICING_ENTRIES[1]!, id: 'custom', providerId: 'direct',
    modelPattern: 'gpt-5*', source: 'manual' as const }
  expect(resolveUsagePricingEntry([...DEFAULT_USAGE_PRICING_ENTRIES, manual], 'direct', 'gpt-5-mini', occurredAt, 'openai')?.id).toBe('custom')
})

it.each(['gpt-5-mini', 'gpt-5-nano'])('warns about deprecated %s without removing its configuration', id => {
  expect(DEFAULT_MODELS.some(model => model.id === id)).toBe(true)
  expect(getModelConfig(id)).toMatchObject({
    deprecated: true, verifiedAt: '2026-10-31',
    sourceUrl: `https://developers.openai.com/api/docs/models/${id}`,
  })
  expect(getModelConfig(id).chatCompatible).not.toBe(false)
})
