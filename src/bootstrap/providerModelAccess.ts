import { createProviderModelAccessPolicy } from '@/modules/providers'
import {
  getProviderManualModels,
  getProviderPreferredModel,
  inferModelFamily,
  isProviderChatCompatibleModel,
  normalizeProviderModelAliases,
  resolveProviderModelAlias,
} from '@/utils/providerModels'

export type {
  AccessPolicyDecision,
  ProviderModelAccessInput,
  ProviderModelAccessSettings,
  ProviderModelAliasAccessInput,
  ProviderModelDisplayCandidate,
  ProviderModelDisplayPolicyInput,
} from '@/modules/providers'

export const PROVIDER_MODEL_ACCESS_POLICY = createProviderModelAccessPolicy({
  getProviderManualModels,
  getProviderPreferredModel,
  inferModelFamily,
  isProviderChatCompatibleModel,
  normalizeProviderModelAliases,
  resolveProviderModelAlias,
})

export const {
  getPolicyAllowedProviderModels,
  getPolicyPreferredProviderModel,
  getProviderModelDisplayCandidates,
  hasProviderModelAccessRules,
  mergeRuntimeAliasAccessPolicy,
  providerHasPolicyAllowedModel,
  providerHasPolicyModel,
  resolveProviderModelAccess,
  resolveProviderModelAliasAccess,
} = PROVIDER_MODEL_ACCESS_POLICY
