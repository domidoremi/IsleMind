import type { UsagePricingEntry } from '../contracts'

const VERSION = '2026-07-26'
const EFFECTIVE_FROM = Date.UTC(2026, 6, 26)

export const DEFAULT_USAGE_PRICING_ENTRIES: readonly UsagePricingEntry[] = [
  price('openai', 'openai:gpt-5', 'gpt-5*', 'GPT-5 family', 1.25, 10, 0.125),
  price('openai', 'openai:gpt-5.1', 'gpt-5.1*', 'GPT-5.1 family', 1.25, 10, 0.125),
  price('openai', 'openai:gpt-5.2', 'gpt-5.2*', 'GPT-5.2 family', 1.75, 14, 0.175),
  price('anthropic', 'anthropic:claude-opus-4.5', 'claude-opus-4-5*', 'Claude Opus 4.5', 5, 25, 0.5, 6.25),
  price('anthropic', 'anthropic:claude-sonnet-4.5', 'claude-sonnet-4-5*', 'Claude Sonnet 4.5', 3, 15, 0.3, 3.75),
  price('anthropic', 'anthropic:claude-haiku-4.5', 'claude-haiku-4-5*', 'Claude Haiku 4.5', 1, 5, 0.1, 1.25),
  price('google', 'google:gemini-2.5-flash', 'gemini-2.5-flash*', 'Gemini 2.5 Flash', 0.3, 2.5, 0.03, undefined, 'additional-to-output'),
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
): UsagePricingEntry {
  return {
    id,
    providerType,
    modelPattern,
    displayName,
    version: VERSION,
    effectiveFrom: EFFECTIVE_FROM,
    source: 'built-in',
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
