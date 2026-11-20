import type { AIProvider } from '@/types/providerContracts'

/** Undefined preserves legacy choices; an empty list explicitly enables none. */
export function parseProviderEnabledModels(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(model => typeof model !== 'string' || !model.trim())) {
    throw new Error('Invalid provider model selection.')
  }
  return [...new Set((value as string[]).map(model => model.trim()))]
}

export function isProviderModelSelected(provider: Pick<AIProvider, 'enabledModels'>, model: string): boolean {
  return provider.enabledModels === undefined
    || provider.enabledModels.some(selected => selected.trim() === model.trim())
}

/** A selected alias also authorizes its resolved upstream ID during execution. */
export function isProviderModelEnabled(provider: Pick<AIProvider, 'enabledModels' | 'modelAliases'>, model: string): boolean {
  return isProviderModelSelected(provider, model) || (provider.modelAliases ?? []).some(alias =>
    alias.model.trim() === model.trim() && isProviderModelSelected(provider, alias.alias))
}
