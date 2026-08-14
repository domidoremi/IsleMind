import { createLocalModelStateRepository } from '@/modules/knowledge'
import { createAsyncStorageLocalModelStateStoragePort } from '@/platform/localModels'

export const localModelStateRepository = createLocalModelStateRepository(
  createAsyncStorageLocalModelStateStoragePort(),
)
