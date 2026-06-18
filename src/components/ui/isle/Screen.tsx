import type { PropsWithChildren } from 'react'
import { type ViewStyle } from 'react-native'
import { SafeAreaView, type Edges } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { MotiView } from 'moti'
import { IsleBackground, resolveBackgroundCanvas, type IsleBackgroundMode, type IsleBackgroundState } from './Background'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'

interface ScreenProps extends PropsWithChildren {
  padded?: boolean
  style?: ViewStyle
  background?: IsleBackgroundMode
  backgroundState?: IsleBackgroundState
  backgroundIntensity?: number
  edges?: Edges
}

export function IsleScreen({ children, padded = true, style, background = 'default', backgroundState = 'idle', backgroundIntensity = 1, edges }: ScreenProps) {
  const { colors, isDark } = useAppTheme()
  const motion = useMotionPreference()
  const canvas = resolveBackgroundCanvas(colors, background)

  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: canvas }}>
      <StatusBar style={isDark ? 'light' : 'dark'} translucent backgroundColor={canvas} />
      <MotiView
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'timing', duration: motion === 'full' ? 160 : 1 }}
        style={[
          {
            flex: 1,
            paddingHorizontal: padded ? 20 : 0,
          },
          style,
        ]}
      >
        <IsleBackground colors={colors} motion={motion} mode={background} state={backgroundState} intensity={backgroundIntensity} />
        {children}
      </MotiView>
    </SafeAreaView>
  )
}

export const Screen = IsleScreen
