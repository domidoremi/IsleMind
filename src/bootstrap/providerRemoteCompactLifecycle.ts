import { createProviderRemoteCompactLifecycle } from '@/modules/providers'
import { listActiveCompactStates, saveCompactState } from '@/bootstrap/providerCompactStateRepository'
import { recordCompactUsage } from '@/bootstrap/providerCompactUsage'
import { emitRuntimeEvent } from '@/services/runtimeEvents'

export const providerRemoteCompactLifecycle = createProviderRemoteCompactLifecycle({
  recordCompactUsage,
  listActiveCompactStates,
  saveCompactState,
  emitRuntimeEvent,
  now: () => Date.now(),
})
