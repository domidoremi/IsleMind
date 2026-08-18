import { createProviderSettingsList } from '@/modules/providers'
import { PROVIDER_MODEL_ACCESS_POLICY } from './providerModelAccess'

export const {
  buildProviderSettingsPolicyModelCache,
  buildProviderSettingsSearchIndex,
  compareProviders,
  filterAndSortProviders,
  groupProviderSettingsCards,
  providerMatchesModelFilter,
  providerSettingsSupplierKey,
  providerSettingsSupplierLabel,
} = createProviderSettingsList(PROVIDER_MODEL_ACCESS_POLICY)
