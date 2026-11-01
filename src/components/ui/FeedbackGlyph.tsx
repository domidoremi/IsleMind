import { useEffect, type ReactNode } from 'react'
import { AccessibilityInfo, Platform, StyleSheet, View, type TextStyle } from 'react-native'
import { MotiView } from 'moti'
import { Text } from './AppText'
import { AppIcon } from './AppIcon'
import { HighFrameSpinner } from './HighFrameSpinner'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useThemeMotion } from '@/hooks/useThemeMotion'
import type { ActionFeedbackPhase } from '@/hooks/useActionFeedback'

/** Announcements occupy no flow space and never move focus. */
export function FeedbackAnnouncement({ message, receiptKey, testID }: {
  message?: string
  receiptKey?: string | number
  testID?: string
}) {
  useEffect(() => {
    if (!message || Platform.OS === 'web') return
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true })
    else AccessibilityInfo.announceForAccessibility(message)
  }, [message, receiptKey])

  if (Platform.OS !== 'web') return null
  return <Text testID={testID} accessible={Boolean(message)} accessibilityLabel={message}
    accessibilityLiveRegion="polite" style={[styles.announcement, webClip]}>
    <Text key={receiptKey}>{message ?? ''}</Text>
  </Text>
}

/** Reserve the same icon bounds before, during and after an action. */
export function FeedbackGlyph({ phase = 'idle', label, color, idleIcon, announce = true, receiptKey, testID }: {
  phase?: ActionFeedbackPhase
  label?: string
  color?: string
  idleIcon?: ReactNode
  announce?: boolean
  receiptKey?: string | number
  testID?: string
}) {
  const { colors } = useAppTheme()
  const motion = useThemeMotion('accent', { readable: true })
  const foreground = color ?? (phase === 'error' ? colors.ui.tone.danger.foreground : colors.ui.tone.success.foreground)
  const activeLabel = phase === 'idle' ? undefined : label
  return <View testID={testID} style={styles.slot} accessible={Boolean(activeLabel)} accessibilityRole="text"
    accessibilityLabel={activeLabel} accessibilityState={{ busy: phase === 'pending' }}>
    <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.slot}>
      {phase === 'pending' ? <HighFrameSpinner size={16} color={color ?? colors.textSecondary} />
        : phase === 'success' || phase === 'error' ? <MotiView key={`${phase}:${receiptKey ?? ''}`}
          from={{ opacity: motion.intensity === 'none' ? 1 : 0, scale: motion.intensity === 'full' ? 0.84 : 1 }}
          animate={{ opacity: 1, scale: 1 }} transition={motion.transition}>
          <AppIcon name={phase === 'success' ? 'check' : 'warning'} size={16} color={foreground} />
        </MotiView> : idleIcon}
    </View>
    {announce ? <FeedbackAnnouncement message={phase === 'success' ? label : undefined} receiptKey={receiptKey} testID={testID ? `${testID}-announcement` : undefined} /> : null}
  </View>
}

const styles = StyleSheet.create({
  slot: { width: 18, height: 18, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  announcement: { position: 'absolute', top: 0, left: 0, width: 1, height: 1, overflow: 'hidden', fontSize: 1, lineHeight: 1 },
})

const webClip = { clipPath: 'inset(50%)', whiteSpace: 'nowrap' } as unknown as TextStyle
