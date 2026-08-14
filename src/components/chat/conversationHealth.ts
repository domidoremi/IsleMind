import type { TFunction } from 'i18next'

import { resolveProviderModelAliasAccess, type ProviderModelAccessInput } from '@/bootstrap/providerModelAccess'
import { resolveProviderDisplayName } from '@/presentation/features/settings/providerPresentation'
import { getModelConfig } from '@/types/modelCatalog'
import { getProviderConfigIssue } from '@/types/providerBaseUrls'
import type { Conversation } from '@/types/chatContracts'
import type { AIProvider, ChatErrorCode, ProviderOperationCode } from '@/types/providerContracts'
import { getProviderDisplayModel, resolveProviderModelAlias } from '@/utils/providerModels'

import { providerHasSpecificPolicyModel } from './chatModelSelection'

export interface ConversationHealth {
  code: 'provider_missing' | ChatErrorCode | ProviderOperationCode | null
  title: string
  description: string
  inheritedExpired: boolean
  providerId?: string
}

export async function resolveConversationHealth(
  conversation: Conversation | null,
  providers: AIProvider[],
  hydrateProviderKey: (id: string) => Promise<AIProvider | null>,
  t: TFunction,
  settings?: ProviderModelAccessInput['settings']
): Promise<ConversationHealth | null> {
  if (!conversation || conversation.providerId === 'local-setup') return null
  const provider = providers.find((item) => item.id === conversation.providerId)
  const inheritedExpired = false
  if (!provider) {
    return {
      code: 'provider_missing',
      title: inheritedExpired ? t('chat.providerInheritedMissing') : t('chat.providerMissing'),
      description: t('chat.providerMissingDescription', { providerId: conversation.providerId }),
      inheritedExpired,
      providerId: conversation.providerId,
    }
  }
  const providerDisplayName = resolveProviderDisplayName(provider, t('providerSettings.customProvider'))
  if (!provider.enabled) {
    return health('disabled_provider', inheritedExpired, provider.id, providerDisplayName, t('chat.providerDisabledDescription'), t)
  }
  const upstreamModel = resolveProviderModelAlias(provider, conversation.model)
  const access = resolveProviderModelAliasAccess({ provider, model: conversation.model, settings })
  if (!access.allowed) {
    return health('model_unavailable', inheritedExpired, provider.id, providerDisplayName, t('chat.modelNotInProvider', { model: conversation.model, provider: providerDisplayName }), t)
  }
  if (!providerHasSpecificPolicyModel(provider, conversation.model, settings)) {
    return health('model_unavailable', inheritedExpired, provider.id, providerDisplayName, t('chat.modelNotInProvider', { model: conversation.model, provider: providerDisplayName }), t)
  }
  const keyedProvider = await hydrateProviderKey(provider.id)
  if (!keyedProvider?.apiKey.trim()) {
    return health('missing_key', inheritedExpired, provider.id, providerDisplayName, t('chat.providerMissingKey'), t)
  }
  const issue = getProviderConfigIssue(keyedProvider, keyedProvider.apiKey)
  if (issue) {
    return health(issue.code, inheritedExpired, provider.id, providerDisplayName, t(issue.messageKey ?? issue.message, { defaultValue: issue.message }), t)
  }
  if (provider.lastTestStatus === 'bad' && provider.lastTestCode && provider.lastTestCode !== 'ok' && (!provider.lastTestModel || provider.lastTestModel === conversation.model || provider.lastTestModel === upstreamModel)) {
    return health(provider.lastTestCode, inheritedExpired, provider.id, providerDisplayName, provider.lastTestMessage || t('chat.lastTestFailed'), t)
  }
  if (provider.lastTestStatus === 'bad') {
    return health('model_unavailable', inheritedExpired, provider.id, providerDisplayName, provider.lastTestMessage || t('chat.lastTestFailed'), t)
  }
  const config = getModelConfig(upstreamModel, provider.type, provider.modelConfigs)
  if (config.deprecated) {
    return health('model_unavailable', inheritedExpired, provider.id, providerDisplayName, t('chat.modelDeprecated', { model: getProviderDisplayModel(provider, conversation.model) }), t)
  }
  return { code: null, title: '', description: '', inheritedExpired, providerId: provider.id }
}

function health(
  code: ConversationHealth['code'],
  inheritedExpired: boolean,
  providerId: string,
  providerName: string,
  description: string,
  t: TFunction
): ConversationHealth {
  return {
    code,
    title: inheritedExpired ? t('chat.inheritedConfigExpired') : t('chat.conversationConfigIssue'),
    description: `${providerName}: ${description}`,
    inheritedExpired,
    providerId,
  }
}
