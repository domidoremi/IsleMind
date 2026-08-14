import { st } from '@/i18n/service'
import { createProviderConfigPolicy, createProviderHostedBoundaryPolicy, createProviderJsonPolicy, type HostedProviderSupportMessageKey } from '@/modules/providers'
import { getProviderPreset } from './providerRegistry'
import { getBedrockRuntimeSupportIssue, isAwsBedrockProvider, isBedrockMantleProvider } from '@/modules/providers'

export const providerConfigPolicy = createProviderConfigPolicy({
  resolvePreset: getProviderPreset,
})
export const { resolveProviderConfigDraft } = providerConfigPolicy

export const providerJsonPolicy = createProviderJsonPolicy({ translate: st })
export const { parseProviderJson } = providerJsonPolicy

export const providerHostedBoundaryPolicy = createProviderHostedBoundaryPolicy({
  translate: (key: HostedProviderSupportMessageKey) => st(key),
  getBedrockRuntimeSupportIssue,
  isAwsBedrockProvider,
  isBedrockMantleProvider,
})
export const {
  getHostedProviderKind,
  getHostedProviderSupportIssue,
  isHostedProviderGap,
  isAwsBedrockHostedProvider,
} = providerHostedBoundaryPolicy
