import { createProviderParameterMatrixPolicy } from '@/modules/providers'
import { providerModelCapabilityCanBeSent } from '@/bootstrap/providerCapabilityMatrix'
import {
  providerSupportsFileInput,
  providerSupportsVisionInput,
  resolveProviderNativeToolSupport,
} from '@/services/chatProviderNativeToolUtils'
import { getModelConfig } from '@/types/modelCatalog'
import { providerSupportsReasoning } from '@/utils/modelReasoning'
import { resolveProviderModelAlias } from '@/utils/providerModels'

const providerParameterMatrixPolicy = createProviderParameterMatrixPolicy({
  getModelConfig,
  resolveProviderModelAlias,
  providerModelCapabilityCanBeSent,
  resolveProviderNativeToolSupport,
  providerSupportsReasoning,
  providerSupportsVisionInput,
  providerSupportsFileInput,
})

export const buildProviderParameterMatrix = providerParameterMatrixPolicy.buildProviderParameterMatrix
export const getProviderParameterEntry = providerParameterMatrixPolicy.getProviderParameterEntry
export const providerParameterCanBeSent = providerParameterMatrixPolicy.providerParameterCanBeSent
