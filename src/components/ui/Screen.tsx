import type { PropsWithChildren } from 'react'
import { View, type ViewStyle } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { MotiView } from 'moti'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'

interface ScreenProps extends PropsWithChildren {
  padded?: boolean
  style?: ViewStyle
}

export function Screen({ children, padded = true, style }: ScreenProps) {
  const { colors, isDark } = useAppTheme()
  const motion = useMotionPreference()
  const animateBackground = motion === 'full'

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <MotiView
        from={{ opacity: 0, translateY: 8 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'timing', duration: 220 }}
        style={[
          {
            flex: 1,
            paddingHorizontal: padded ? 20 : 0,
            backgroundColor: colors.surface,
          },
          style,
        ]}
      >
        <AmbientBlob color={colors.mintSoft} top={-92} right={-84} size={220} opacity={isDark ? 0.22 : 0.78} enabled={animateBackground} drift={motionTokens.distance.blob} />
        <AmbientBlob color={colors.skySoft} top={72} left={-118} size={190} opacity={isDark ? 0.2 : 0.62} enabled={animateBackground} drift={-motionTokens.distance.blob} delay={400} />
        <AmbientBlob color={colors.amberSoft} bottom={-132} left={-70} size={240} opacity={isDark ? 0.18 : 0.58} enabled={animateBackground} drift={motionTokens.distance.blob / 2} delay={800} />
        {children}
      </MotiView>
    </SafeAreaView>
  )
}

export const IslandScreen = Screen

function AmbientBlob({
  color,
  size,
  opacity,
  enabled,
  drift,
  delay = 0,
  top,
  right,
  bottom,
  left,
}: {
  color: string
  size: number
  opacity: number
  enabled: boolean
  drift: number
  delay?: number
  top?: number
  right?: number
  bottom?: number
  left?: number
}) {
  return (
    <MotiView
      pointerEvents="none"
      from={{ translateY: 0, translateX: 0, scale: 1 }}
      animate={enabled ? { translateY: drift, translateX: drift / 2, scale: 1.035 } : { translateY: 0, translateX: 0, scale: 1 }}
      transition={enabled ? { loop: true, type: 'timing', duration: motionTokens.duration.ambient, delay } : { type: 'timing', duration: 1 }}
      style={{
        position: 'absolute',
        top,
        right,
        bottom,
        left,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity,
      }}
    />
  )
}
