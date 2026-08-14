import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { TFunction } from 'i18next'

import type { Conversation } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'

import { resolveConversationHealth, type ConversationHealth } from './conversationHealth'
import {
  MODEL_QUICK_OPTION_PROVIDER_LIMIT as CHAT_MODEL_QUICK_OPTION_PROVIDER_LIMIT,
  getPolicyAllowedProviderModels,
  type ModelAccessSettings,
} from './chatModelSelection'

interface ChatWorkspaceProviderHealthStateOptions {
  active: boolean
  conversationId?: string
  hydrateProviderKey: (id: string) => Promise<AIProvider | null>
  modelAccessSettings: ModelAccessSettings
  provider?: AIProvider
  providers: AIProvider[]
  runtimeConversation: Conversation | null
  t: TFunction
}

export interface ChatWorkspaceProviderHealthState {
  providerHealth: ConversationHealth | null
  setProviderHealth: Dispatch<SetStateAction<ConversationHealth | null>>
}

export function buildProviderHealthCacheKey({
  modelAccessSettings,
  provider,
  runtimeConversation,
}: {
  modelAccessSettings: ModelAccessSettings
  provider?: AIProvider
  runtimeConversation: Conversation | null
}): string {
  if (!provider) return runtimeConversation?.providerId ?? 'none'
  return [
    provider.id,
    provider.enabled ? 'on' : 'off',
    getPolicyAllowedProviderModels(provider, modelAccessSettings, { limit: CHAT_MODEL_QUICK_OPTION_PROVIDER_LIMIT }).join(','),
    provider.baseUrl ?? '',
    provider.credentialMode ?? '',
    provider.tokenPlanRegion ?? '',
    provider.wireProtocol ?? '',
    provider.lastTestStatus ?? '',
    provider.lastTestCode ?? '',
    provider.lastTestModel ?? '',
    provider.lastTestMessage ?? '',
  ].join('|')
}

export function useChatWorkspaceProviderHealthState({
  active,
  conversationId,
  hydrateProviderKey,
  modelAccessSettings,
  provider,
  providers,
  runtimeConversation,
  t,
}: ChatWorkspaceProviderHealthStateOptions): ChatWorkspaceProviderHealthState {
  const [providerHealth, setProviderHealth] = useState<ConversationHealth | null>(null)
  const providerHealthKey = useMemo(
    () => buildProviderHealthCacheKey({ modelAccessSettings, provider, runtimeConversation }),
    [runtimeConversation?.providerId, provider, modelAccessSettings]
  )

  useEffect(() => {
    if (!active) return
    let mounted = true
    void resolveConversationHealth(runtimeConversation, providers, hydrateProviderKey, t, modelAccessSettings).then((health) => {
      if (mounted) setProviderHealth(health)
    })
    return () => {
      mounted = false
    }
  }, [
    active,
    conversationId,
    runtimeConversation?.providerId,
    runtimeConversation?.model,
    runtimeConversation?.providerModelMode,
    hydrateProviderKey,
    modelAccessSettings,
    providerHealthKey,
    providers,
    t,
  ])

  return { providerHealth, setProviderHealth }
}
