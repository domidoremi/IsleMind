import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import { MotiView, AnimatePresence } from 'moti'
import Animated, { Easing, useAnimatedProps, useSharedValue, withDelay, withTiming } from 'react-native-reanimated'
import Svg, { Circle, ClipPath, Defs, G, LinearGradient, Path, Stop } from 'react-native-svg'
import { useTranslation } from 'react-i18next'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference, type MotionIntensity } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'

interface AppBootOverlayProps {
  ready: boolean
  errorCount?: number
  bootStartedAt: number
}

const MIN_VISIBLE_MS = 1450
const MAX_VISIBLE_MS = 3800
const BOOT_CANVAS = '#f8f4ec'
const BOOT_INK = '#111918'
const BOOT_MUTED = 'rgba(53, 67, 62, 0.72)'
const BOOT_RAIL = 'rgba(17, 25, 24, 0.12)'
const BOOT_MARK_WASH = 'rgba(255, 253, 247, 0.82)'
const BOOT_MARK_RING = 'rgba(56, 181, 143, 0.34)'
const BOOT_SHADOW = 'rgba(7, 16, 14, 0.28)'
const BOOT_ACCENT = '#38b58f'
const BOOT_SKY = '#5ccfe6'
const BOOT_CORAL = '#e56f5c'
const BOOT_GOLD = '#f0b856'
const BOOT_DANGER = '#d85b47'
const DRAW_EASING = Easing.bezier(0.2, 0.78, 0.22, 1)
const CORE_PATH = 'M120 18C154 26 184 49 198 82C214 120 204 158 177 183C158 201 136 210 120 218C104 210 82 201 63 183C36 158 26 120 42 82C56 49 86 26 120 18Z'
const SIGNAL_PATH = 'M48 124C74 100 104 96 124 110C143 123 151 149 173 154C188 158 202 148 214 128'
const SIGNAL_HIGHLIGHT_PATH = 'M58 134C80 116 103 115 121 126C141 138 151 162 172 166C188 169 202 159 210 144'
const CUBE_TOP_PATH = 'M78 88L120 60L162 88L120 116Z'
const CUBE_LEFT_PATH = 'M78 88L120 116L120 178L78 150Z'
const CUBE_RIGHT_PATH = 'M162 88L120 116L120 178L162 150Z'
const CUBE_EDGES_PATH = 'M78 88L120 60L162 88L120 116L78 88ZM78 88L120 116V178M162 88L120 116M78 150L120 178L162 150'
const INNER_ROUTE_PATH = 'M120 70V164M94 164H146'
const AnimatedPath = Animated.createAnimatedComponent(Path)
const AnimatedCircle = Animated.createAnimatedComponent(Circle)

export function AppBootOverlay({ ready, errorCount = 0, bootStartedAt }: AppBootOverlayProps) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const { t } = useTranslation()
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    if (ready && !errorCount) {
      const elapsed = Date.now() - bootStartedAt
      const wait = Math.max(0, MIN_VISIBLE_MS - elapsed)
      const timer = setTimeout(() => setVisible(false), wait)
      return () => clearTimeout(timer)
    }
    setVisible(true)
  }, [bootStartedAt, errorCount, ready])

  useEffect(() => {
    if (!visible || !ready || !errorCount) return
    const timer = setTimeout(() => setVisible(false), 900)
    return () => clearTimeout(timer)
  }, [errorCount, ready, visible])

  useEffect(() => {
    if (!visible || ready) return
    const timer = setTimeout(() => setVisible(false), MAX_VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [ready, visible])

  return (
    <AnimatePresence>
      {visible ? (
        <MotiView
          from={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.normal : motionTokens.duration.fast }}
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            zIndex: 999,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: BOOT_CANVAS,
          }}
        >
          <BootBackdrop active={!ready || !!errorCount} />
          <MotiView
            from={{ opacity: 0, translateY: motion === 'full' ? 12 : 0, scale: motion === 'full' ? 0.96 : 1 }}
            animate={{ opacity: 1, translateY: 0, scale: 1 }}
            transition={motion === 'full' ? { type: 'spring', damping: 18, stiffness: 130 } : { type: 'timing', duration: 1 }}
            style={{
              width: 246,
              height: 246,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MotiView
              from={{ opacity: 0, rotate: '-8deg', scale: 0.94 }}
              animate={motion === 'full' && !ready ? { opacity: 1, rotate: '2deg', scale: 1.02 } : { opacity: 1, rotate: '0deg', scale: 1 }}
              transition={motion === 'full' ? { type: 'spring', damping: 24, stiffness: 86 } : { type: 'timing', duration: 1 }}
              style={{
                position: 'absolute',
                width: 220,
                height: 220,
                borderRadius: 110,
                borderWidth: 2,
                borderColor: errorCount ? 'rgba(216, 91, 71, 0.32)' : BOOT_MARK_RING,
              }}
            />
            <MotiView
              from={{ opacity: 0.9, scale: 0.99 }}
              animate={motion === 'full' && !ready ? { opacity: 1, scale: 1.035 } : { opacity: 1, scale: 1 }}
              transition={motion === 'full' && !ready ? { loop: true, type: 'timing', duration: 1650 } : { type: 'timing', duration: 1 }}
              style={{
                position: 'absolute',
                width: 178,
                height: 178,
                borderRadius: 89,
                backgroundColor: BOOT_MARK_WASH,
                shadowColor: BOOT_SHADOW,
                shadowOpacity: 0.34,
                shadowRadius: 28,
                shadowOffset: { width: 0, height: 20 },
              }}
            />
            <MotiView
              from={{ opacity: 0.4, scaleX: 0.62, translateY: 76 }}
              animate={motion === 'full' && !ready ? { opacity: 0.9, scaleX: 1.1, translateY: 72 } : { opacity: 0.72, scaleX: 1, translateY: 72 }}
              transition={motion === 'full' && !ready ? { loop: true, type: 'timing', duration: 1320 } : { type: 'timing', duration: 1 }}
              style={{
                position: 'absolute',
                width: 146,
                height: 6,
                borderRadius: 999,
                backgroundColor: errorCount ? colors.warning : BOOT_ACCENT,
              }}
            />
            <HandDrawnBootMark active={!ready || !!errorCount} error={!!errorCount} motion={motion} />
          </MotiView>
          <MotiView
            from={{ opacity: 0, translateY: motion === 'full' ? 8 : 0 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={motion === 'full' ? { type: 'timing', duration: 420, delay: 760 } : { type: 'timing', duration: 1 }}
            style={{ alignItems: 'center' }}
          >
            <Text style={{ color: BOOT_INK, fontSize: 31, lineHeight: 37, fontWeight: '900', marginTop: 8 }}>IsleMind</Text>
            <Text style={{ color: errorCount ? colors.warning : BOOT_MUTED, fontSize: 12, lineHeight: 17, fontWeight: '800', marginTop: 5 }}>
              {errorCount ? t('app.bootRecovering') : ready ? t('app.bootReady') : t('app.bootWaking')}
            </Text>
          </MotiView>
          <LoadingTrace active={!ready || !!errorCount} tone={errorCount ? colors.warning : BOOT_ACCENT} />
        </MotiView>
      ) : null}
    </AnimatePresence>
  )
}

function HandDrawnBootMark({ active, error, motion }: { active: boolean; error: boolean; motion: MotionIntensity }) {
  const fullMotion = motion === 'full'
  const pinTone = error ? BOOT_DANGER : BOOT_ACCENT

  return (
    <View style={{ width: 206, height: 206, alignItems: 'center', justifyContent: 'center' }}>
      <MotiView
        from={{ opacity: fullMotion ? 0 : 1, scale: fullMotion ? 0.985 : 1 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={fullMotion ? { type: 'timing', duration: 520, delay: 420 } : { type: 'timing', duration: 1 }}
        style={{ position: 'absolute', width: 206, height: 206 }}
      >
        <Svg width={206} height={206} viewBox="0 0 240 240">
          <Defs>
            <LinearGradient id="bootCoreFill" x1="68" y1="28" x2="180" y2="220" gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor="#1d2f2b" />
              <Stop offset="0.58" stopColor="#111918" />
              <Stop offset="1" stopColor="#0b1110" />
            </LinearGradient>
            <LinearGradient id="bootCubeTop" x1="82" y1="60" x2="158" y2="176" gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor="#fffdf7" />
              <Stop offset="1" stopColor="#fff8e8" />
            </LinearGradient>
            <LinearGradient id="bootCubeLeft" x1="78" y1="86" x2="122" y2="178" gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor="#e5fbf4" />
              <Stop offset="1" stopColor="#c9f0e4" />
            </LinearGradient>
            <LinearGradient id="bootCubeRight" x1="122" y1="86" x2="164" y2="178" gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor="#d3f7ef" />
              <Stop offset="1" stopColor="#aee6d9" />
            </LinearGradient>
            <ClipPath id="bootCoreClip">
              <Path d={CORE_PATH} />
            </ClipPath>
          </Defs>
          <Path d={CORE_PATH} fill="url(#bootCoreFill)" />
          <G clipPath="url(#bootCoreClip)">
            <Path d={SIGNAL_PATH} fill="none" stroke={error ? BOOT_DANGER : BOOT_ACCENT} strokeOpacity="0.42" strokeWidth="30" strokeLinecap="round" />
            <Path d={SIGNAL_HIGHLIGHT_PATH} fill="none" stroke="#fff8e8" strokeOpacity="0.62" strokeWidth="7" strokeLinecap="round" />
            <Path d={CUBE_TOP_PATH} fill="url(#bootCubeTop)" opacity="0.98" />
            <Path d={CUBE_LEFT_PATH} fill="url(#bootCubeLeft)" opacity="0.98" />
            <Path d={CUBE_RIGHT_PATH} fill="url(#bootCubeRight)" opacity="0.98" />
            <Circle cx="120" cy="60" r="12" fill={pinTone} opacity="0.96" />
            <Circle cx="120" cy="60" r="5" fill="#71d9bf" opacity={error ? 0.3 : 0.88} />
            <Circle cx="158" cy="170" r="4.4" fill={BOOT_GOLD} opacity="0.86" />
            <Circle cx="84" cy="150" r="3.6" fill={BOOT_SKY} opacity="0.86" />
          </G>
        </Svg>
      </MotiView>

      <MotiView
        from={{ opacity: 0.12, rotate: '-2deg', scale: 0.98 }}
        animate={fullMotion && active ? { opacity: 0.22, rotate: '2deg', scale: 1.012 } : { opacity: 0.16, rotate: '0deg', scale: 1 }}
        transition={fullMotion && active ? { loop: true, type: 'timing', duration: 1800 } : { type: 'timing', duration: 1 }}
        style={{
          position: 'absolute',
          width: 174,
          height: 174,
          borderRadius: 87,
          borderWidth: 1,
          borderColor: error ? 'rgba(216, 91, 71, 0.28)' : 'rgba(56, 181, 143, 0.28)',
        }}
      />

      <Svg width={206} height={206} viewBox="0 0 240 240">
        <SketchPath d={CORE_PATH} length={760} delay={40} duration={820} stroke="#fffdf7" strokeWidth={9} opacity={0.95} motion={motion} lineJoin="round" />
        <SketchPath d={CORE_PATH} length={760} delay={120} duration={900} stroke="#233935" strokeWidth={4.5} opacity={0.78} motion={motion} lineJoin="round" />
        <SketchPath d={SIGNAL_PATH} length={300} delay={260} duration={720} stroke={error ? BOOT_DANGER : BOOT_ACCENT} strokeWidth={18} opacity={0.84} motion={motion} />
        <SketchPath d={SIGNAL_HIGHLIGHT_PATH} length={250} delay={420} duration={600} stroke="#fff8e8" strokeWidth={4.8} opacity={0.88} motion={motion} />
        <SketchPath d={CUBE_EDGES_PATH} length={420} delay={500} duration={720} stroke="#203632" strokeWidth={3.6} opacity={0.58} motion={motion} lineJoin="round" />
        <SketchPath d={INNER_ROUTE_PATH} length={170} delay={660} duration={520} stroke={error ? BOOT_DANGER : BOOT_ACCENT} strokeWidth={8} opacity={0.9} motion={motion} />
        <SketchCircle cx={120} cy={60} r={13.5} length={88} delay={840} duration={360} stroke="#111918" strokeWidth={4.2} opacity={0.92} motion={motion} />
        <SketchCircle cx={158} cy={170} r={5.8} length={38} delay={980} duration={260} stroke={BOOT_GOLD} strokeWidth={3.2} opacity={0.9} motion={motion} />
        <SketchCircle cx={84} cy={150} r={4.8} length={32} delay={1040} duration={260} stroke={BOOT_SKY} strokeWidth={3} opacity={0.9} motion={motion} />
      </Svg>
    </View>
  )
}

function SketchPath({
  d,
  delay,
  duration,
  length,
  lineCap = 'round',
  lineJoin = 'round',
  motion,
  opacity = 1,
  stroke,
  strokeWidth,
}: {
  d: string
  delay: number
  duration: number
  length: number
  lineCap?: 'butt' | 'round' | 'square'
  lineJoin?: 'bevel' | 'miter' | 'round'
  motion: MotionIntensity
  opacity?: number
  stroke: string
  strokeWidth: number
}) {
  const offset = useSharedValue(motion === 'full' ? length : 0)

  useEffect(() => {
    offset.value = motion === 'full' ? withDelay(delay, withTiming(0, { duration, easing: DRAW_EASING })) : 0
  }, [delay, duration, length, motion, offset])

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: offset.value,
  }))

  return (
    <AnimatedPath
      animatedProps={animatedProps}
      d={d}
      fill="none"
      stroke={stroke}
      strokeDasharray={[length, length]}
      strokeLinecap={lineCap}
      strokeLinejoin={lineJoin}
      strokeOpacity={opacity}
      strokeWidth={strokeWidth}
    />
  )
}

function SketchCircle({
  cx,
  cy,
  delay,
  duration,
  length,
  motion,
  opacity = 1,
  r,
  stroke,
  strokeWidth,
}: {
  cx: number
  cy: number
  delay: number
  duration: number
  length: number
  motion: MotionIntensity
  opacity?: number
  r: number
  stroke: string
  strokeWidth: number
}) {
  const offset = useSharedValue(motion === 'full' ? length : 0)

  useEffect(() => {
    offset.value = motion === 'full' ? withDelay(delay, withTiming(0, { duration, easing: DRAW_EASING })) : 0
  }, [delay, duration, length, motion, offset])

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: offset.value,
  }))

  return (
    <AnimatedCircle
      animatedProps={animatedProps}
      cx={cx}
      cy={cy}
      fill="none"
      r={r}
      stroke={stroke}
      strokeDasharray={[length, length]}
      strokeLinecap="round"
      strokeOpacity={opacity}
      strokeWidth={strokeWidth}
    />
  )
}

function BootBackdrop({ active }: { active: boolean }) {
  const motion = useMotionPreference()
  return (
    <>
      <View
        style={{
          position: 'absolute',
          top: -124,
          right: -112,
          width: 306,
          height: 306,
          borderRadius: 153,
          backgroundColor: 'rgba(113, 217, 191, 0.30)',
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: -134,
          top: 164,
          width: 276,
          height: 276,
          borderRadius: 138,
          backgroundColor: 'rgba(92, 207, 230, 0.18)',
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: -92,
          right: -92,
          bottom: -48,
          height: 220,
          transform: [{ rotate: '-5deg' }],
          backgroundColor: 'rgba(240, 184, 86, 0.18)',
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: -86,
          right: -86,
          bottom: 112,
          height: 74,
          transform: [{ rotate: '-5deg' }],
          backgroundColor: 'rgba(255, 253, 247, 0.62)',
        }}
      />
      <MotiView
        from={{ opacity: 0.16, translateX: -28 }}
        animate={motion === 'full' && active ? { opacity: 0.54, translateX: 28 } : { opacity: 0.28, translateX: 0 }}
        transition={motion === 'full' && active ? { loop: true, type: 'timing', duration: 1900 } : { type: 'timing', duration: 1 }}
        style={{
          position: 'absolute',
          left: 54,
          right: 54,
          top: 132,
          height: 3,
          borderRadius: 3,
          backgroundColor: 'rgba(56, 181, 143, 0.18)',
        }}
      />
      <MotiView
        from={{ opacity: 0.18, translateX: 24 }}
        animate={motion === 'full' && active ? { opacity: 0.48, translateX: -26 } : { opacity: 0.28, translateX: 0 }}
        transition={motion === 'full' && active ? { loop: true, type: 'timing', duration: 2100 } : { type: 'timing', duration: 1 }}
        style={{
          position: 'absolute',
          left: 88,
          right: 88,
          bottom: 280,
          height: 3,
          borderRadius: 3,
          backgroundColor: 'rgba(240, 184, 86, 0.22)',
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: 314,
          height: 314,
          marginLeft: -157,
          marginTop: -204,
          borderRadius: 157,
          borderWidth: 1,
          borderColor: 'rgba(56, 181, 143, 0.18)',
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: 236,
          height: 236,
          marginLeft: -118,
          marginTop: -165,
          borderRadius: 118,
          borderWidth: 1,
          borderColor: 'rgba(92, 207, 230, 0.18)',
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: 84,
          height: 84,
          marginLeft: 112,
          marginTop: -176,
          borderRadius: 42,
          borderWidth: 1,
          borderColor: 'rgba(229, 111, 92, 0.18)',
          backgroundColor: 'rgba(229, 111, 92, 0.08)',
        }}
      />
    </>
  )
}

function LoadingTrace({ active, tone }: { active: boolean; tone: string }) {
  const motion = useMotionPreference()
  return (
    <View
      style={{
        width: 190,
        height: 4,
        borderRadius: 4,
        overflow: 'hidden',
        marginTop: 20,
        backgroundColor: BOOT_RAIL,
      }}
    >
      <MotiView
        from={{ translateX: -70, opacity: 0.42 }}
        animate={motion === 'full' && active ? { translateX: 136, opacity: 0.96 } : { translateX: 0, opacity: 0.74 }}
        transition={motion === 'full' && active ? { loop: true, type: 'timing', duration: 1180 } : { type: 'timing', duration: 1 }}
        style={{
          width: 78,
          height: 4,
          borderRadius: 4,
          backgroundColor: tone,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: 58,
          width: 40,
          height: 4,
          borderRadius: 4,
          backgroundColor: BOOT_SKY,
          opacity: 0.28,
        }}
      />
      <View
        style={{
          position: 'absolute',
          right: 18,
          width: 30,
          height: 4,
          borderRadius: 4,
          backgroundColor: BOOT_CORAL,
          opacity: 0.28,
        }}
      />
    </View>
  )
}
