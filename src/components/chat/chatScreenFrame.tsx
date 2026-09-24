import type { PropsWithChildren } from 'react'
import { Platform, View } from 'react-native'
import { IsleScreen, type IsleBackgroundState } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'

interface ChatScreenFrameProps {
  embedded: boolean
  backgroundState: IsleBackgroundState
  compactViewport: boolean
}

export function ChatScreenFrame({
  embedded,
  backgroundState,
  compactViewport,
  children,
}: PropsWithChildren<ChatScreenFrameProps>) {
  const { isLiquidGlass } = useAppTheme()
  if (embedded) {
    return <View style={{ flex: 1 }}>{children}</View>
  }
  const backgroundMode = isLiquidGlass ? 'ambient' : Platform.OS === 'android' ? 'none' : 'focus'
  const screenEdges = Platform.OS === 'android'
    ? (['left', 'right', 'bottom'] as const)
    : undefined

  return (
    <IsleScreen edges={screenEdges} padded={false} background={backgroundMode} backgroundState={backgroundState} backgroundIntensity={compactViewport ? 0.84 : 1}>
      {children}
    </IsleScreen>
  )
}

export function renderConversationHeaderSpacer(topPadding: number) {
  return <View style={{ height: topPadding }} />
}
