import type { TFunction } from 'i18next'

import { resolveProviderModelAliasAccess, type ProviderModelAccessInput } from '@/bootstrap/providerModelAccess'
import { composeUserFacingError, isUserFacingErrorCode, userFacingErrorCodeKey } from '@/core'
import { isProviderHttpCopyOnlyCode } from '@/modules/providers'
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
    return health(provider.lastTestCode, inheritedExpired, provider.id, providerDisplayName, describeProviderTestFailure(provider.lastTestCode, provider.lastTestMessage, t), t)
  }
  if (provider.lastTestStatus === 'bad') {
    return health('model_unavailable', inheritedExpired, provider.id, providerDisplayName, describeProviderTestFailure('model_unavailable', provider.lastTestMessage, t), t)
  }
  const config = getModelConfig(upstreamModel, provider.type, provider.modelConfigs)
  if (config.deprecated) {
    return health('model_unavailable', inheritedExpired, provider.id, providerDisplayName, t('chat.modelDeprecated', { model: getProviderDisplayModel(provider, conversation.model) }), t)
  }
  return { code: null, title: '', description: '', inheritedExpired, providerId: provider.id }
}

/**
 * A provider test result is persisted as a pre-rendered sentence, so replaying it
 * verbatim would freeze the copy at the language that was active when the test ran.
 * The headline is rebuilt from the persisted code instead, and the stored sentence is
 * kept only as technical detail behind it.
 */
function describeProviderTestFailure(code: ProviderOperationCode, lastTestMessage: string | undefined, t: TFunction): string {
  const headline = isUserFacingErrorCode(code) ? t(userFacingErrorCodeKey(code)) : t('chat.lastTestFailed')
  // A copy-only code already says everything the stored sentence said, in the language
  // selected right now rather than the one the test ran in.
  return composeUserFacingError(headline, isProviderHttpCopyOnlyCode(code) ? undefined : lastTestMessage)
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
