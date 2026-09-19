import { createProviderRemoteCompactLifecycle } from '@/modules/providers'
import { listActiveCompactStates, saveCompactState, providerCompactStateRepository } from '@/bootstrap/providerCompactStateRepository'
import { recordCompactUsage } from '@/bootstrap/providerCompactUsage'
import { emitRuntimeEvent } from '@/services/runtimeEvents'

export const providerRemoteCompactLifecycle = createProviderRemoteCompactLifecycle({
  recordCompactUsage,
  listActiveCompactStates,
  saveCompactState,
  emitRuntimeEvent,
  compactStatePersistenceAvailable: providerCompactStateRepository.persistenceAvailable,
  now: () => Date.now(),
})
