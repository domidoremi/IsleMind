import { Text, View, useWindowDimensions } from 'react-native'
import { MessageCircle } from 'lucide-react-native'
import { MotiView } from 'moti'
import { AnimatedNavigationIcon, type NavigationGlyph } from '@/components/navigation/AnimatedNavigationIcon'
import { useNavigationTrigger } from '@/components/navigation/AnimatedNavigationTrigger'
import { useAppTheme } from '@/hooks/useAppTheme'
import { IslePanel } from './Panel'
import { IsleButton } from './Controls'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'

interface EmptyStateProps {
  title: string
  description?: string
  actionLabel?: string
  actionGlyph?: NavigationGlyph
  actionBusy?: boolean
  actionDisabled?: boolean
  onAction?: () => void
}

export function IsleEmptyState({ title, description, actionLabel, actionGlyph, actionBusy = false, actionDisabled = false, onAction }: EmptyStateProps) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const { width } = useWindowDimensions()
  const navigation = useNavigationTrigger(onAction ?? (() => undefined))
  const actionPress = actionGlyph ? navigation.trigger : onAction
  const compact = width < 390
  const iconSize = compact ? 66 : 76
  const panelMaxWidth = Math.max(260, Math.min(340, width - 48))
  const actionMinWidth = Math.max(132, Math.min(156, panelMaxWidth * 0.46))
  const panelMaterial = colors.ui.minimal ? 'chrome' : 'raised'

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: compact ? 18 : 24 }}>
      <MotiView
        from={{ scale: 0.9, opacity: 0.6 }}
        animate={motion === 'full' ? { scale: 1.05, opacity: 1 } : { scale: 1, opacity: 1 }}
        transition={motion === 'full' ? { loop: true, type: 'timing', duration: motionTokens.duration.pulseLoop } : { type: 'timing', duration: 1 }}
        style={{
          width: iconSize,
          height: iconSize,
          borderRadius: iconSize / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.ui.icon.accentBackground,
          marginBottom: compact ? 16 : 20,
          borderWidth: colors.ui.minimal ? 1 : 2,
          borderColor: colors.material.stroke,
          shadowColor: colors.shadowTint,
          shadowOpacity: colors.ui.minimal ? 0.08 : 0.18,
          shadowRadius: colors.ui.minimal ? 12 : 0,
          shadowOffset: { width: 0, height: colors.ui.minimal ? 6 : 4 },
        }}
      >
        <MessageCircle color={colors.ui.icon.accentForeground} size={compact ? 26 : 30} strokeWidth={1.7} />
      </MotiView>
      <IslePanel material={panelMaterial} elevated={false} radius={colors.ui.radius.panel} style={{ width: '100%', maxWidth: panelMaxWidth }} contentStyle={{ padding: compact ? 18 : 20 }}>
        <View
          accessible
          accessibilityLabel={description ? `${title}. ${description}` : title}
          accessibilityLiveRegion="polite"
        >
          <Text style={{ color: colors.text, fontSize: 24, fontWeight: '900', textAlign: 'center' }}>{title}</Text>
          {description ? (
            <Text style={{ color: colors.textSecondary, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 8 }}>
              {description}
            </Text>
          ) : null}
        </View>
      </IslePanel>
      {actionLabel && onAction ? (
        <IsleButton
          label={actionLabel}
          tone="primary"
          icon={actionGlyph ? <AnimatedNavigationIcon glyph={actionGlyph} active={navigation.active} color={colors.ui.control.primaryForeground} size={18} /> : undefined}
          busy={actionBusy}
          disabled={actionDisabled}
          onPress={actionPress}
          style={{ alignSelf: 'center', marginTop: compact ? 18 : 22, minWidth: actionMinWidth, minHeight: 48, borderRadius: colors.ui.radius.controlLarge }}
        />
      ) : null}
    </View>
  )
}

export const IsleEmpty = IsleEmptyState
export const EmptyState = IsleEmptyState
