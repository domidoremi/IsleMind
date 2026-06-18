import { MotiView } from 'moti'
import { useCallback, useEffect, useState } from 'react'
import { BackHandler, Platform } from 'react-native'
import { router } from 'expo-router'
import { IsleDialogProvider, IsleScreen, type IsleBackgroundState } from '@/components/ui/isle'
import ProviderSettingsContent from '@/components/providers/ProviderSettingsContent'

export default function ProviderSettingsScreen() {
  const [backgroundState, setBackgroundState] = useState<IsleBackgroundState>('idle')
  const closeProviderSettings = useCallback(() => {
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
    <IsleDialogProvider>
      <IsleScreen padded={false} background="surface" backgroundState={backgroundState}>
        <MotiView
          from={{ opacity: 0, translateY: -28 }}
          animate={{ opacity: 1, translateY: 0 }}
          exit={{ opacity: 0, translateY: -18 }}
          transition={{ type: 'spring', damping: 22, stiffness: 190 }}
          style={{ flex: 1 }}
        >
          <ProviderSettingsContent onClose={closeProviderSettings} onBackgroundStateChange={setBackgroundState} />
        </MotiView>
      </IsleScreen>
    </IsleDialogProvider>
  )
}
