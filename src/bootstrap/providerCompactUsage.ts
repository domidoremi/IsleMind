import { createProviderCompactUsageStore } from '@/modules/providers'

export type {
  CompactUsageInput,
  CompactUsageRecord,
} from '@/modules/providers'

export { compactUsageToMessageUsage } from '@/modules/providers'

export const providerCompactUsageStore = createProviderCompactUsageStore()

export const {
  clearCompactUsageRecords,
  listCompactUsageRecords,
  recordCompactUsage,
} = providerCompactUsageStore
