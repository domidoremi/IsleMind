import { createInstance, type TFunction } from 'i18next'
import type { UsageRecord } from '@/modules/diagnostics'
import { summarizeUsageRecords } from '@/modules/diagnostics/application/usageSummary'
import zhCN from '@/i18n/resources/zh-CN.json'
import en from '@/i18n/resources/en.json'
import ja from '@/i18n/resources/ja.json'
import { usageKnownCost } from './usageExecutionPresentation'

function attempt(index: number, cost: number | undefined): UsageRecord {
  return {
    schema: 'islemind.usage-record.v1', id: `attempt-${index}`, attemptIdentity: `attempt-${index}`,
    occurredAt: index, completedAt: index + 1, providerId: 'connection', providerName: 'Connection',
    requestedModel: 'model', upstreamModel: 'model', operationSource: 'chat', dataSource: 'live-provider',
    measurementSource: 'provider', status: 'success', durationMs: 1, attempt: index,
    attemptReason: index ? 'retry' : 'initial', tokens: { totalTokens: 30 },
    costProvenance: cost === undefined ? 'unavailable' : 'supplier-known',
    ...(cost === undefined ? {} : { totalCostNanodollars: cost }),
  }
}

describe.each([
  ['zh-CN', zhCN], ['en', en], ['ja', ja],
] as const)('usage cost presentation in %s', (language, resource) => {
  let t: TFunction
  beforeAll(async () => {
    const translation = createInstance()
    await translation.init({ lng: language, fallbackLng: false, resources: { [language]: { translation: resource } },
      interpolation: { escapeValue: false } })
    t = translation.t.bind(translation)
  })
  const present = (costs: (number | undefined)[]) => usageKnownCost(summarizeUsageRecords(costs.map((cost, index) => attempt(index, cost))), t)

  it.each([1, 3])('reports wholly unavailable costs once across %i attempts', count => {
    expect(present(Array.from({ length: count }, () => undefined))).toBe(resource.usage.costNotReported)
  })

  it('keeps a reported zero distinct from an unavailable cost', () => {
    expect(present([0])).toBe('$0.00000')
    expect(present([undefined])).toBe(resource.usage.costNotReported)
  })

  it.each([1, 2])('preserves the known subtotal and %i missing costs', count => {
    expect(present([123450, ...Array.from({ length: count }, () => undefined)]))
      .toBe(t('usage.knownCostWithUnknown', { known: '$0.00012', count }))
    expect(present([0, ...Array.from({ length: count }, () => undefined)]))
      .toBe(t('usage.knownCostWithUnknown', { known: '$0.00000', count }))
  })

  it('preserves overflow and missing-cost states together', () => {
    expect(present([Number.MAX_SAFE_INTEGER, 1])).toBe(resource.usage.totalsOverflowed)
    expect(present([Number.MAX_SAFE_INTEGER, 1, undefined]))
      .toBe(t('usage.knownCostWithUnknown', { known: resource.usage.totalsOverflowed, count: 1 }))
  })

  it('shows no reported cost for an empty history', () => {
    expect(present([])).toBe(resource.usage.costNotReported)
  })
})
