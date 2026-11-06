import { useCallback, useEffect, useState } from 'react'
import { BackHandler, Platform, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import type { IsleBackgroundState } from '@/components/ui/isle'
import { ThemeDetailFrame } from '@/presentation/app-shell/ThemeDetailFrame'
import { resolveSettingsChildReturnAction } from '@/presentation/app-shell/routeReturnPolicy'
import { createLazyComponent } from '@/utils/lazyLoad'
import { providerDetailTab, usageRouteIdentity } from '@/presentation/features/settings/usageNavigation'

const ProviderSettingsContent = createLazyComponent(
  () => import('@/components/providers/ProviderSettingsContent').then((module) => ({ default: module.ProviderSettingsContent })),
)

export default function ProviderSettingsScreen() {
  const [backgroundState, setBackgroundState] = useState<IsleBackgroundState>('idle')
  const params = useLocalSearchParams<{ returnTo?: string | string[]; setup?: string; providerId?: string | string[]; tab?: string | string[] }>()
  const providerId = usageRouteIdentity(params.providerId)
  const tab = providerDetailTab(params.tab)
  const consumeAddIntent = useCallback(() => router.setParams({ setup: undefined }), [])
  const consumeProviderIntent = useCallback(() => router.setParams(params.tab ? { providerId: undefined, tab: undefined } : { providerId: undefined }), [params.tab])
  const navigateBackFromProviderSettings = useCallback(() => {
    const action = resolveSettingsChildReturnAction(params.returnTo, router.canGoBack())
    if (action.kind === 'back') {
      router.back()
      return
    }
    router.replace(action.pathname)
  }, [params.returnTo])

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      navigateBackFromProviderSettings()
      return true
    })
    return () => subscription.remove()
  }, [navigateBackFromProviderSettings])

  return (
    <ThemeDetailFrame
      kind="providers"
      title=""
      onBack={navigateBackFromProviderSettings}
      backLabel=""
      backgroundState={backgroundState}
      headerMode="canvas"
    >
      <View style={{ flex: 1 }}>
        <ProviderSettingsContent
          autoOpenAdd={params.setup === 'add'}
          onAutoOpenAddConsumed={consumeAddIntent}
          autoOpenProviderId={providerId}
          autoOpenProviderTab={tab}
          onAutoOpenProviderConsumed={consumeProviderIntent}
          onClose={navigateBackFromProviderSettings}
          onBackgroundStateChange={setBackgroundState}
        />
      </View>
    </ThemeDetailFrame>
  )
}
