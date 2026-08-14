import { createProviderSessionLeasePool } from '@/modules/providers'

export type {
  ProviderSessionLease,
  ProviderSessionLeaseOptions,
  ProviderSessionLeasePool,
} from '@/modules/providers'

export const providerSessionLeasePool = createProviderSessionLeasePool()

export const acquireProviderSessionLease = providerSessionLeasePool.acquire
export const activeProviderSessionLeaseCount = providerSessionLeasePool.activeCount
