import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import { MotiView, AnimatePresence } from 'moti'
import { BlueCatMascot } from '@/components/mascot/BlueCatMascot'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'

interface AppBootOverlayProps {
  ready: boolean
  errorCount?: number
  bootStartedAt: number
}

const SLOW_BOOT_DELAY_MS = 900
const MAX_VISIBLE_MS = 5200

export function AppBootOverlay({ ready, errorCount = 0, bootStartedAt }: AppBootOverlayProps) {
  const { colors, isDark } = useAppTheme()
  const motion = useMotionPreference()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (ready && !errorCount) {
      setVisible(false)
      return
    }
    const elapsed = Date.now() - bootStartedAt
    const wait = errorCount ? 0 : Math.max(0, SLOW_BOOT_DELAY_MS - elapsed)
    const timer = setTimeout(() => setVisible(true), wait)
    return () => clearTimeout(timer)
  }, [bootStartedAt, errorCount, ready])

  useEffect(() => {
    if (!visible || !ready) return
    const timer = setTimeout(() => setVisible(false), errorCount ? 900 : 180)
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
            backgroundColor: colors.surface,
          }}
        >
          <View pointerEvents="none" style={{ position: 'absolute', top: -110, right: -80, width: 240, height: 240, borderRadius: 120, backgroundColor: colors.skySoft, opacity: isDark ? 0.2 : 0.66 }} />
          <View pointerEvents="none" style={{ position: 'absolute', bottom: -110, left: -80, width: 250, height: 250, borderRadius: 125, backgroundColor: colors.mintSoft, opacity: isDark ? 0.18 : 0.72 }} />
          <BlueCatMascot loading size={168} />
          <Text style={{ color: colors.text, fontSize: 24, fontWeight: '900', letterSpacing: -0.6, marginTop: 16 }}>IsleMind</Text>
          <Text style={{ color: errorCount ? colors.warning : colors.textSecondary, fontSize: 12, lineHeight: 18, fontWeight: '900', marginTop: 6 }}>
            {errorCount ? '恢复中' : ready ? '准备好了' : '唤醒工作台'}
          </Text>
          <LoadingDots />
        </MotiView>
      ) : null}
    </AnimatePresence>
  )
}

function LoadingDots() {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  return (
    <View style={{ flexDirection: 'row', gap: 7, marginTop: 18 }}>
      {[0, 1, 2].map((item) => (
        <MotiView
          key={item}
          from={{ translateY: 0, opacity: 0.35, scale: 0.85 }}
          animate={motion === 'full' ? { translateY: -6, opacity: 1, scale: 1 } : { translateY: 0, opacity: 0.75, scale: 1 }}
          transition={motion === 'full' ? { loop: true, type: 'timing', duration: 620, delay: item * 120 } : { type: 'timing', duration: 1 }}
          style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary }}
        />
      ))}
    </View>
  )
}
