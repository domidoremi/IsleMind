import { router, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { ThemeDetailFrame } from '@/presentation/app-shell/ThemeDetailFrame'
import { ModelAvailabilityScreen } from '@/presentation/features/settings/ModelAvailabilityScreen'
import { providerModelAvailabilityPort, providerModelAvailabilityIntegrationProfile } from '@/bootstrap/providerModelAvailabilityRuntime'
import { getPolicyPreferredProviderModel } from '@/bootstrap/providerModelAccess'

export default function ModelAvailabilityRoute() {
  const { t } = useTranslation()
  const { providerId } = useLocalSearchParams<{ providerId?: string }>()
  return <ThemeDetailFrame kind="providers" title={t('modelAvailability.details')} backLabel={t('common.back')}
    onBack={() => router.canGoBack() ? router.back() : router.replace('/settings/providers')}>
    <ModelAvailabilityScreen initialProviderId={typeof providerId === 'string' ? providerId : undefined}
      availability={providerModelAvailabilityPort} pageSize={providerModelAvailabilityIntegrationProfile.pageSize}
      getProviderTestModel={getPolicyPreferredProviderModel} />
  </ThemeDetailFrame>
}
