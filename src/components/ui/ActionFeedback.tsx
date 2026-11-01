import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import { Text } from './AppText'
import { useAppTheme } from '@/hooks/useAppTheme'
import type { ActionFeedbackPhase } from '@/hooks/useActionFeedback'
import { FeedbackAnnouncement } from './FeedbackGlyph'
import { IsleMotionFrame } from './isle/ThemeMotion'

export function ActionFeedback({ phase, successLabel, errorLabel, style, testID }: {
  phase: ActionFeedbackPhase
  successLabel?: string
  errorLabel: string
  style?: StyleProp<ViewStyle>
  testID?: string
}) {
  const { colors } = useAppTheme()
  if (phase !== 'error') return successLabel
    ? <FeedbackAnnouncement message={phase === 'success' ? successLabel : undefined} testID={testID} />
    : null
  return <IsleMotionFrame role="section" testID={testID} style={[styles.frame, { borderLeftColor: colors.ui?.tone?.danger?.foreground ?? colors.text }, style]}>
    <Text accessibilityRole="alert" accessibilityLiveRegion="assertive"
      style={[styles.label, { color: colors.ui?.tone?.danger?.foreground ?? colors.text }]}>
      {errorLabel}
    </Text>
  </IsleMotionFrame>
}

const styles = StyleSheet.create({
  frame: { minWidth: 0, paddingVertical: 6, paddingLeft: 10, borderLeftWidth: 2 },
  label: { fontSize: 13, lineHeight: 20 },
})
