import { applyProviderModelParameterOverrides, type ProviderModelParameterRequest } from '@/modules/providers'
import { resolveProviderModelAlias } from '@/utils/providerModels'
import { resolveProviderRequestParameters } from './providerRequestPolicies'

/** Compose model overrides with the existing protocol limit before reserving context/output. */
export function resolveProviderModelParametersForDispatch<T extends ProviderModelParameterRequest>(request: T): T {
  const effective = applyProviderModelParameterOverrides(request)
  if (!effective.modelParameterBaseline) return effective
  const parameters = resolveProviderRequestParameters({
    ...effective,
    model: resolveProviderModelAlias(effective.provider, effective.requestedModel ?? effective.model),
  })
  return { ...effective, maxTokens: parameters.maxTokens ?? effective.maxTokens }
}
