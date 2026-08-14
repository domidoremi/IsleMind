import { createProviderRuntimeHealth } from '@/modules/providers'
import { providerHealthRepository } from '@/bootstrap/providerHealthRepository'

export const {
  providerRuntimeHealthRoute,
  resolveProviderRuntimeHealthView,
  recordProviderRuntimeSuccess,
  recordProviderRuntimeFailure,
  recordProviderRuntimeRouteSuccess,
  recordProviderRuntimeRouteFailure,
} = createProviderRuntimeHealth(providerHealthRepository)
