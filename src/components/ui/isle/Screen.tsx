import type { PropsWithChildren } from 'react'
import { StyleSheet, View, type ViewStyle } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { MotiView } from 'moti'
import Svg, { Path } from 'react-native-svg'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'

interface ScreenProps extends PropsWithChildren {
  padded?: boolean
  style?: ViewStyle
}

export function IsleScreen({ children, padded = true, style }: ScreenProps) {
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
          },
          style,
        ]}
      >
        <AmbientBackdrop colors={colors} isDark={isDark} enabled={animateBackground} />
        {children}
      </MotiView>
    </SafeAreaView>
  )
}

export const Screen = IsleScreen

function AmbientBackdrop({
  colors,
  isDark,
  enabled,
}: {
  colors: ReturnType<typeof useAppTheme>['colors']
  isDark: boolean
  enabled: boolean
}) {
  const coolOpacity = isDark ? 0.28 : 0.46
  const warmOpacity = isDark ? 0.2 : 0.34
  const traceOpacity = isDark ? 0.28 : 0.2

  return (
    <View pointerEvents="none" style={styles.backdrop}>
      <AmbientMistField
        enabled={enabled}
        delay={0}
        opacity={coolOpacity}
        primary={colors.mintSoft}
        secondary={colors.skySoft}
        from={{ translateX: -18, translateY: -8, scale: 1 }}
        animate={{ translateX: 18, translateY: 10, scale: 1.02 }}
      />
      <AmbientMistField
        enabled={enabled}
        delay={motionTokens.duration.fast}
        opacity={warmOpacity}
        primary={colors.amberSoft}
        secondary={colors.mintSoft}
        from={{ translateX: 16, translateY: 12, scale: 1.01 }}
        animate={{ translateX: -16, translateY: -6, scale: 1.035 }}
      />
      <AmbientTraceField
        enabled={enabled}
        delay={motionTokens.duration.normal}
        opacity={traceOpacity}
        primary={colors.primary}
        secondary={colors.secondary}
        accent={colors.accent}
      />
    </View>
  )
}

function AmbientMistField({
  primary,
  secondary,
  opacity,
  enabled,
  delay,
  from,
  animate,
}: {
  primary: string
  secondary: string
  opacity: number
  enabled: boolean
  delay: number
  from: { translateX: number; translateY: number; scale: number }
  animate: { translateX: number; translateY: number; scale: number }
}) {
  return (
    <MotiView
      from={from}
      animate={enabled ? animate : { translateX: 0, translateY: 0, scale: 1 }}
      transition={enabled ? { loop: true, type: 'timing', duration: motionTokens.duration.ambient * 2.4, delay } : { type: 'timing', duration: 1 }}
      style={[styles.fieldLayer, { opacity }]}
    >
      <Svg width="100%" height="100%" viewBox="0 0 390 844" preserveAspectRatio="none">
        <Path d="M-92 74C24 36 96 98 192 68C286 39 330 -18 476 14" stroke={primary} strokeWidth={172} strokeLinecap="round" fill="none" />
        <Path d="M-112 642C12 568 118 632 220 572C308 520 356 456 500 484" stroke={secondary} strokeWidth={206} strokeLinecap="round" fill="none" />
        <Path d="M-88 354C48 284 120 318 230 286C332 256 396 206 492 238" stroke={primary} strokeWidth={86} strokeLinecap="round" fill="none" opacity={0.58} />
      </Svg>
    </MotiView>
  )
}

function AmbientTraceField({
  primary,
  secondary,
  accent,
  opacity,
  enabled,
  delay,
}: {
  primary: string
  secondary: string
  accent: string
  opacity: number
  enabled: boolean
  delay: number
}) {
  const drift = motionTokens.distance.blob

  return (
    <MotiView
      from={{ opacity: opacity * 0.72, translateX: -drift, translateY: 0 }}
      animate={enabled ? { opacity, translateX: drift, translateY: -6 } : { opacity: opacity * 0.76, translateX: 0, translateY: 0 }}
      transition={enabled ? { loop: true, type: 'timing', duration: motionTokens.duration.ambient * 1.8, delay } : { type: 'timing', duration: 1 }}
      style={styles.traceLayer}
    >
      <Svg width="100%" height="100%" viewBox="0 0 390 844" preserveAspectRatio="none">
        <Path d="M18 206C82 176 134 194 188 158C246 120 308 110 372 82" stroke={primary} strokeWidth={1.4} strokeLinecap="round" fill="none" opacity={0.42} />
        <Path d="M-10 526C58 498 126 534 186 492C248 448 294 452 404 386" stroke={secondary} strokeWidth={1.2} strokeLinecap="round" fill="none" opacity={0.34} />
        <Path d="M40 742C122 704 174 736 250 682C302 646 336 632 402 624" stroke={accent} strokeWidth={1.2} strokeLinecap="round" fill="none" opacity={0.3} />
      </Svg>
    </MotiView>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: -160,
    right: 0,
    bottom: -160,
    left: 0,
  },
  fieldLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  traceLayer: {
    ...StyleSheet.absoluteFillObject,
  },
})
