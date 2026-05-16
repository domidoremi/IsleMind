import { Text, View } from 'react-native'
import { MessageCircle } from 'lucide-react-native'
import { MotiView } from 'moti'
import { useAppTheme } from '@/hooks/useAppTheme'
import { IslandButton } from './IslandButton'
import { IslandPanel } from './IslandPanel'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'

interface EmptyStateProps {
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
}

export function EmptyState({ title, description, actionLabel, onAction }: EmptyStateProps) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
      <MotiView
        from={{ scale: 0.9, opacity: 0.6 }}
        animate={motion === 'full' ? { scale: 1.05, opacity: 1 } : { scale: 1, opacity: 1 }}
        transition={motion === 'full' ? { loop: true, type: 'timing', duration: motionTokens.duration.mascotLoop } : { type: 'timing', duration: 1 }}
        style={{
          width: 76,
          height: 76,
          borderRadius: 38,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.mintSoft,
          marginBottom: 20,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <MessageCircle color={colors.primary} size={30} strokeWidth={1.7} />
      </MotiView>
      <IslandPanel elevated={false} style={{ borderRadius: 28, maxWidth: 320 }} contentStyle={{ padding: 18 }}>
        <Text style={{ color: colors.text, fontSize: 24, fontWeight: '900', textAlign: 'center' }}>{title}</Text>
        <Text style={{ color: colors.textSecondary, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 8 }}>
          {description}
        </Text>
      </IslandPanel>
      {actionLabel && onAction ? (
        <IslandButton label={actionLabel} tone="primary" onPress={onAction} style={{ marginTop: 22, minHeight: 48, borderRadius: 24 }} />
      ) : null}
    </View>
  )
}

export const IslandEmpty = EmptyState
