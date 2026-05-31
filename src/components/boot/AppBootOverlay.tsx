import { useEffect, useState } from 'react'
import { Image, Text, View } from 'react-native'
import { MotiView, AnimatePresence } from 'moti'
import { useTranslation } from 'react-i18next'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'

interface AppBootOverlayProps {
  ready: boolean
  errorCount?: number
  bootStartedAt: number
}

const MIN_VISIBLE_MS = 1100
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
const bootMark = require('../../../assets/splash-icon.png')

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
              width: 236,
              height: 236,
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
            <MotiView
              from={{ opacity: 0.4, scale: 0.82, rotate: '-10deg' }}
              animate={motion === 'full' && !ready ? { opacity: 1, scale: 1, rotate: '0deg' } : { opacity: 1, scale: 1, rotate: '0deg' }}
              transition={motion === 'full' ? { type: 'spring', damping: 20, stiffness: 110 } : { type: 'timing', duration: 1 }}
            >
              <Image source={bootMark} resizeMode="contain" style={{ width: 192, height: 192 }} />
            </MotiView>
          </MotiView>
          <Text style={{ color: BOOT_INK, fontSize: 31, lineHeight: 37, fontWeight: '900', marginTop: 8 }}>IsleMind</Text>
          <Text style={{ color: errorCount ? colors.warning : BOOT_MUTED, fontSize: 12, lineHeight: 17, fontWeight: '800', marginTop: 5 }}>
            {errorCount ? t('app.bootRecovering') : ready ? t('app.bootReady') : t('app.bootWaking')}
          </Text>
          <LoadingTrace active={!ready || !!errorCount} tone={errorCount ? colors.warning : BOOT_ACCENT} />
        </MotiView>
      ) : null}
    </AnimatePresence>
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
