import { createProviderCapabilityMatrixPolicy } from '@/modules/providers'
import { getProviderPreset } from '@/bootstrap/providerRegistry'
import {
  getHostedProviderSupportIssue,
  isAwsBedrockHostedProvider,
  isHostedProviderGap,
} from '@/bootstrap/providerPolicies'
import {
  providerSupportsFileInput,
  providerSupportsVisionInput,
  resolveProviderNativeToolSupport,
} from '@/services/chatProviderNativeToolUtils'
import { getModelConfig } from '@/types/modelCatalog'
import { providerSupportsReasoning } from '@/utils/modelReasoning'
import { resolveProviderModelAlias } from '@/utils/providerModels'

const providerCapabilityMatrixPolicy = createProviderCapabilityMatrixPolicy({
  getModelConfig,
  getProviderPreset,
  getHostedProviderSupportIssue,
  isAwsBedrockHostedProvider,
  isHostedProviderGap,
  providerSupportsFileInput,
  providerSupportsVisionInput,
  resolveProviderNativeToolSupport,
  providerSupportsReasoning,
  resolveProviderModelAlias,
})

export const buildProviderCapabilityMatrix = providerCapabilityMatrixPolicy.buildProviderCapabilityMatrix
export const buildProviderModelCapabilityMatrix = providerCapabilityMatrixPolicy.buildProviderModelCapabilityMatrix
export const getProviderModelCapabilityModelIds = providerCapabilityMatrixPolicy.getProviderModelCapabilityModelIds
export const summarizeProviderModelCapabilityProvider = providerCapabilityMatrixPolicy.summarizeProviderModelCapabilityProvider
export const getProviderModelCapabilityStatus = providerCapabilityMatrixPolicy.getProviderModelCapabilityStatus
export const providerModelCapabilityCanBeSent = providerCapabilityMatrixPolicy.providerModelCapabilityCanBeSent
export const summarizeProviderCapabilityMatrix = providerCapabilityMatrixPolicy.summarizeProviderCapabilityMatrix
export const summarizeProviderCapabilityMatrixDetails = providerCapabilityMatrixPolicy.summarizeProviderCapabilityMatrixDetails
export const describeProviderCapabilityStatus = providerCapabilityMatrixPolicy.describeProviderCapabilityStatus
export const buildProviderCoverageBuckets = providerCapabilityMatrixPolicy.buildProviderCoverageBuckets
export const providerNeedsHostedCompatibilityWork = providerCapabilityMatrixPolicy.providerNeedsHostedCompatibilityWork
export const providerSuppressesGenericModelList = providerCapabilityMatrixPolicy.providerSuppressesGenericModelList
