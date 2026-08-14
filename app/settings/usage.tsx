import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'

import { UsageStatisticsScreen } from '@/components/settings/UsageStatisticsScreen'
import { ThemeDetailFrame } from '@/presentation/app-shell/ThemeDetailFrame'

export default function UsageStatisticsRoute() {
  const { t } = useTranslation()
  const goBack = () => {
    if (router.canGoBack()) {
      router.back()
      return
    }
    router.replace('/settings')
  }

  return (
    <ThemeDetailFrame kind="usage" title={t('usage.title')} onBack={goBack} backLabel={t('common.back')}>
      <UsageStatisticsScreen />
    </ThemeDetailFrame>
  )
}
