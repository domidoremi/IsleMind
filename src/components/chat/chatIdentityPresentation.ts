import { getSettingsModelDisplayAlias, normalizeSettingsIdentityDisplayName } from '@/modules/settings'
import type { SettingsModelDisplayAlias } from '@/types/settingsContracts'
import type { AIProvider } from '@/types/providerContracts'
import { getProviderDisplayModel } from '@/utils/providerModels'

export function resolveChatAssistantDisplayName(assistantDisplayName: unknown): string | undefined {
  return normalizeSettingsIdentityDisplayName(assistantDisplayName)
}

export function resolveChatIdentityTitle(
  assistantDisplayName: unknown,
  fallback: string,
): string {
  return resolveChatAssistantDisplayName(assistantDisplayName) ?? fallback
}

export function resolveChatModelDisplayName(
  provider: AIProvider | undefined,
  modelId: string | null,
  aliases: readonly SettingsModelDisplayAlias[] | undefined,
): string {
  if (!modelId) return ''
  const alias = provider ? getSettingsModelDisplayAlias(aliases, provider.id, modelId) : undefined
  return alias ?? getProviderDisplayModel(provider, modelId)
}

export function getChatModelCanonicalDisplayName(provider: AIProvider | undefined, modelId: string | null): string {
  return getProviderDisplayModel(provider, modelId)
}
