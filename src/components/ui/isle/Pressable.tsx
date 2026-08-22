import { Pressable, type PressableProps } from 'react-native'
import { PressableScale } from '@/components/ui/PressableScale'

import { useAppTheme } from '@/hooks/useAppTheme'
import { resolveThemeExpression } from '@/theme/themeExpression'

export function IslePressable(props: Parameters<typeof PressableScale>[0]) {
  const { canonicalThemeId } = useAppTheme()
  const interactionProfile = resolveThemeExpression(canonicalThemeId).motion.grammar

  return <PressableScale interactionProfile={interactionProfile} {...props} />
}

export function IsleOverlayPressable(props: PressableProps) {
  const accessibilityState = props.disabled
    ? { ...props.accessibilityState, disabled: true }
    : props.accessibilityState
  return <Pressable accessibilityRole="button" {...props} accessibilityState={accessibilityState} />
}
