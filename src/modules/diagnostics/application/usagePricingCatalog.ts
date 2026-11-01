import type { UsagePricingEntry } from '../contracts'

const VERSION = '2026-10-31'
const EFFECTIVE_FROM = Date.UTC(2026, 6, 26)
const REVIEW_EFFECTIVE_FROM = Date.parse('2026-10-31T00:00:00+08:00')

export const DEFAULT_USAGE_PRICING_ENTRIES: readonly UsagePricingEntry[] = [
  price('openai', 'openai:gpt-5', 'gpt-5', 'GPT-5', 1.25, 10, 0.125),
  price('openai', 'openai:gpt-5-mini', 'gpt-5-mini', 'GPT-5 Mini', 0.25, 2, 0.025, undefined, 'included-in-output', REVIEW_EFFECTIVE_FROM),
  price('openai', 'openai:gpt-5-nano', 'gpt-5-nano', 'GPT-5 Nano', 0.05, 0.4, 0.005, undefined, 'included-in-output', REVIEW_EFFECTIVE_FROM),
  price('openai', 'openai:gpt-5.1', 'gpt-5.1', 'GPT-5.1', 1.25, 10, 0.125),
  price('openai', 'openai:gpt-5.2', 'gpt-5.2', 'GPT-5.2', 1.75, 14, 0.175),
  price('anthropic', 'anthropic:claude-opus-4.5', 'claude-opus-4-5', 'Claude Opus 4.5', 5, 25, 0.5, 6.25),
  price('anthropic', 'anthropic:claude-sonnet-4.5', 'claude-sonnet-4-5', 'Claude Sonnet 4.5', 3, 15, 0.3, 3.75),
  price('anthropic', 'anthropic:claude-haiku-4.5', 'claude-haiku-4-5', 'Claude Haiku 4.5', 1, 5, 0.1, 1.25),
  price('google', 'google:gemini-2.5-flash', 'gemini-2.5-flash', 'Gemini 2.5 Flash', 0.3, 2.5, 0.03, undefined, 'additional-to-output'),
]

function price(
  providerType: string,
  id: string,
  modelPattern: string,
  displayName: string,
  inputUsdPerMillion: number,
  outputUsdPerMillion: number,
  cacheReadUsdPerMillion: number,
  cacheCreationUsdPerMillion?: number,
  reasoningBilling: UsagePricingEntry['rates']['reasoningBilling'] = 'included-in-output',
  effectiveFrom = EFFECTIVE_FROM,
): UsagePricingEntry {
  return {
    id,
    providerType,
    modelPattern,
    displayName,
    version: VERSION,
    effectiveFrom,
    source: 'built-in',
    sourceUrl: providerType === 'openai'
      ? `https://developers.openai.com/api/docs/models/${modelPattern}`
      : providerType === 'anthropic'
        ? 'https://platform.claude.com/docs/en/about-claude/pricing'
        : 'https://ai.google.dev/gemini-api/docs/pricing',
    verifiedAt: effectiveFrom === REVIEW_EFFECTIVE_FROM ? VERSION : '2026-07-26',
    billingConditions: 'Standard API token estimate; excludes batch and service-tier discounts, tool fees, taxes, and reseller prices. Historical recorded costs are not repriced.',
    rates: {
      inputNanodollarsPerMillionTokens: nanodollars(inputUsdPerMillion),
      outputNanodollarsPerMillionTokens: nanodollars(outputUsdPerMillion),
      cacheReadNanodollarsPerMillionTokens: nanodollars(cacheReadUsdPerMillion),
      cacheCreationNanodollarsPerMillionTokens: nanodollars(cacheCreationUsdPerMillion ?? inputUsdPerMillion),
      reasoningBilling,
    },
  }
}

function nanodollars(usd: number): number {
  return Math.round(usd * 1_000_000_000)
}
