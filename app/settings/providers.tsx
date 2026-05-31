import { MotiView } from 'moti'
import { useEffect } from 'react'
import { BackHandler, Platform } from 'react-native'
import { router } from 'expo-router'
import { IsleScreen } from '@/components/ui/isle'
import { ProviderSettingsContent } from '@/components/providers/ProviderSettingsContent'

export default function ProviderSettingsScreen() {
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      router.replace('/settings')
      return true
    })
    return () => subscription.remove()
  }, [])

  return (
    <IsleScreen padded={false}>
      <MotiView
        from={{ opacity: 0, translateY: -28 }}
        animate={{ opacity: 1, translateY: 0 }}
        exit={{ opacity: 0, translateY: -18 }}
        transition={{ type: 'spring', damping: 22, stiffness: 190 }}
        style={{ flex: 1 }}
      >
        <ProviderSettingsContent />
      </MotiView>
    </IsleScreen>
  )
}
