import type { UsagePricingEntry, UsageRecord } from '../contracts'
import { calculateUsageCost, resolveUsagePricingEntry } from './usagePricing'
import { summarizeUsageRecords } from './usageStatistics'

function usageRecord(overrides: Partial<UsageRecord>): UsageRecord {
  return {
    schema: 'islemind.usage-record.v1',
    id: 'usage-record',
    occurredAt: 1,
    completedAt: 2,
    providerId: 'provider',
    providerName: 'Provider',
    requestedModel: 'model',
    upstreamModel: 'model',
    operationSource: 'chat',
    dataSource: 'live-provider',
    measurementSource: 'provider',
    status: 'failed',
    durationMs: 1,
    attempt: 0,
    attemptReason: 'initial',
    tokens: {},
    costProvenance: 'unavailable',
    ...overrides,
  }
}

describe('usage statistics retry attribution', () => {
  it('counts retry attempts instead of summing retry ordinals', () => {
    const summary = summarizeUsageRecords([
      usageRecord({ id: 'initial', attempt: 0, attemptReason: 'initial', retryCount: 0 }),
      usageRecord({ id: 'retry-1', attempt: 1, attemptReason: 'retry', retryCount: 1 }),
      usageRecord({ id: 'retry-2', attempt: 2, attemptReason: 'retry', retryCount: 2 }),
    ], [])

    expect(summary.retryCount).toBe(2)
  })
})

describe('usage pricing', () => {
  const directOpenAiPrice: UsagePricingEntry = {
    id: 'openai:gpt-5',
    providerType: 'openai',
    modelPattern: 'gpt-5*',
    displayName: 'GPT-5',
    version: 'test',
    effectiveFrom: 0,
    source: 'built-in',
    rates: {
      inputNanodollarsPerMillionTokens: 1_000_000_000,
      outputNanodollarsPerMillionTokens: 2_000_000_000,
      cacheReadNanodollarsPerMillionTokens: 100_000_000,
      cacheCreationNanodollarsPerMillionTokens: 1_250_000_000,
      reasoningNanodollarsPerMillionTokens: 3_000_000_000,
      reasoningBilling: 'separate',
    },
  }

  it('does not apply direct-provider pricing to an aggregator with the same model id', () => {
    expect(resolveUsagePricingEntry(
      [directOpenAiPrice],
      'provider-instance',
      'gpt-5.2',
      1,
      'openai-compatible',
    )).toBeUndefined()
    expect(resolveUsagePricingEntry(
      [directOpenAiPrice],
      'provider-instance',
      'gpt-5.2',
      1,
      'openai',
    )?.id).toBe(directOpenAiPrice.id)
  })

  it('prices uncached, cached, cache-write, and separately billed reasoning tokens once', () => {
    expect(calculateUsageCost({
      inputTokens: 1_000,
      outputTokens: 500,
      cacheReadInputTokens: 400,
      cacheCreationInputTokens: 100,
      reasoningTokens: 200,
    }, directOpenAiPrice)).toMatchObject({
      totalCostNanodollars: 1_865_000,
      provenance: 'price-table-estimate',
    })
  })

  it('charges reasoning tokens that a provider reports outside outputTokens', () => {
    const additionalReasoningPrice: UsagePricingEntry = {
      ...directOpenAiPrice,
      id: 'google:reasoning-output',
      rates: {
        ...directOpenAiPrice.rates,
        reasoningBilling: 'additional-to-output',
      },
    }
    expect(calculateUsageCost({
      inputTokens: 1_000,
      outputTokens: 500,
      reasoningTokens: 200,
    }, additionalReasoningPrice)).toMatchObject({
      totalCostNanodollars: 2_600_000,
      provenance: 'price-table-estimate',
    })
  })
})
