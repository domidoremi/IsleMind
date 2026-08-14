import { useCallback, useEffect, useState } from 'react'
import { BackHandler, Platform, View } from 'react-native'
import { router } from 'expo-router'
import type { IsleBackgroundState } from '@/components/ui/isle'
import ProviderSettingsContent from '@/components/providers/ProviderSettingsContent'
import { ThemeDetailFrame } from '@/presentation/app-shell/ThemeDetailFrame'

export default function ProviderSettingsScreen() {
  const [backgroundState, setBackgroundState] = useState<IsleBackgroundState>('idle')
  const closeProviderSettings = useCallback(() => {
    router.replace('/settings')
  }, [])
  const navigateBackFromProviderSettings = useCallback(() => {
    if (router.canGoBack()) {
      router.back()
      return
    }
    router.replace('/settings')
  }, [])

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      closeProviderSettings()
      return true
    })
    return () => subscription.remove()
  }, [closeProviderSettings])

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
        <ProviderSettingsContent onClose={navigateBackFromProviderSettings} onBackgroundStateChange={setBackgroundState} />
      </View>
    </ThemeDetailFrame>
  )
}
