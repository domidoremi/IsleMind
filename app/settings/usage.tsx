import { useCallback, useEffect } from 'react'
import { BackHandler, Platform } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'

import { ThemeDetailFrame } from '@/presentation/app-shell/ThemeDetailFrame'
import { resolveSettingsChildReturnAction } from '@/presentation/app-shell/routeReturnPolicy'
import { createLazyComponent } from '@/utils/lazyLoad'
import { SettingsEditBoundary, useSettingsLeave } from '@/components/settings/SettingsEditBoundary'

const UsageStatisticsScreen = createLazyComponent(
  () => import('@/components/settings/UsageStatisticsScreen').then((module) => ({ default: module.UsageStatisticsScreen })),
)

export default function UsageStatisticsRoute() {
  return <SettingsEditBoundary><UsageStatisticsRouteContent /></SettingsEditBoundary>
}

function UsageStatisticsRouteContent() {
  const { t } = useTranslation()
  const leave = useSettingsLeave()
  const params = useLocalSearchParams<{ returnTo?: string | string[] }>()
  const goBack = useCallback(() => {
    void leave(() => {
    const action = resolveSettingsChildReturnAction(params.returnTo, router.canGoBack())
    if (action.kind === 'back') {
      router.back()
      return
    }
    router.replace(action.pathname)
    })
  }, [params.returnTo, leave])

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      goBack()
      return true
    })
    return () => subscription.remove()
  }, [goBack])

  return (
    <ThemeDetailFrame kind="usage" title={t('usage.title')} onBack={goBack} backLabel={t('common.back')}>
      <UsageStatisticsScreen />
    </ThemeDetailFrame>
  )
}
