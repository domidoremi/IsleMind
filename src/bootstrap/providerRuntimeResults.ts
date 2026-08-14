import { st } from '@/i18n/service'
import { createProviderRuntimeResultPolicy } from '@/modules/providers'

const providerRuntimeResultPolicy = createProviderRuntimeResultPolicy({
  nonErrorFallbackMessage: () => st('providerOperation.requestFailed'),
})

export const {
  providerRuntimeError,
  runStreamTask,
  withCredentialGroup,
} = providerRuntimeResultPolicy
