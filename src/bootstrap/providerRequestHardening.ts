import { createProviderRequestHardeningPolicy } from '@/modules/providers'
import { modelDisallowsAnthropicSampling } from '@/utils/modelReasoning'

export type {
  ProviderRequestHardeningInput,
  ProviderRequestHardeningIssue,
  ProviderRequestHardeningManifest,
  ProviderRequestHardeningResult,
} from '@/modules/providers'

export const providerRequestHardeningPolicy = createProviderRequestHardeningPolicy({
  modelDisallowsSampling: modelDisallowsAnthropicSampling,
})

export const hardenProviderRequestBody = providerRequestHardeningPolicy.hardenProviderRequestBody
