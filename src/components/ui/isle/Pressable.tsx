import { Pressable, type PressableProps } from 'react-native'
import { PressableScale } from '@/components/ui/PressableScale'

export function IslePressable(props: Parameters<typeof PressableScale>[0]) {
  return <PressableScale {...props} />
}

export function IsleOverlayPressable(props: PressableProps) {
  return <Pressable accessibilityRole="button" {...props} />
}
