import { StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { MotiView } from 'moti'
import { AnimatedNavigationIcon, type NavigationGlyph } from '@/components/navigation/AnimatedNavigationIcon'
import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
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
  compact?: boolean
  contextual?: boolean
}

export function IsleEmptyState({ title, description, actionLabel, actionGlyph, actionBusy = false, actionDisabled = false, onAction, compact: compactOverride, contextual = false }: EmptyStateProps) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const { width } = useWindowDimensions()
  const navigation = useNavigationTrigger(onAction ?? (() => undefined))
  const actionPress = actionGlyph ? navigation.trigger : onAction
  const compact = compactOverride ?? width < 390
  const iconSize = compact ? 62 : 72
  const panelMaxWidth = Math.max(260, Math.min(340, width - 48))
  const actionMinWidth = Math.max(124, Math.min(148, panelMaxWidth * 0.44))
  const panelMaterial = contextual ? 'transparent' : colors.ui.minimal ? 'transparent' : colors.ui.glass ? 'chrome' : 'raised'
  const iconSurface = colors.ui.cartoon
    ? colors.ui.icon.accentBackground
    : colors.ui.glass
      ? colors.ui.actionBar.itemBackground
      : contextual
        ? colors.ui.semantic.surface.base
        : colors.ui.semantic.surface.muted
  const iconBorderColor = colors.ui.cartoon
    ? colors.material.stroke
    : colors.ui.glass
      ? colors.ui.actionBar.itemBorder
      : colors.ui.semantic.chrome.border
  const iconBorderWidth = colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth
  const contentPadding = panelMaterial === 'transparent' ? 0 : compact ? 16 : 18

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: compact ? 18 : 24 }}>
      <MotiView
        from={{ scale: contextual ? 0.98 : 0.9, opacity: contextual ? 0.9 : 0.6 }}
        animate={motion === 'full' ? { scale: contextual ? 1 : 1.02, opacity: 1 } : { scale: 1, opacity: 1 }}
        transition={motion === 'full' ? { loop: true, type: 'timing', duration: motionTokens.duration.pulseLoop } : { type: 'timing', duration: 1 }}
        style={{
          width: iconSize,
          height: iconSize,
          borderRadius: iconSize / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: iconSurface,
          marginBottom: contextual ? (compact ? 10 : 12) : compact ? 16 : 20,
          borderWidth: iconBorderWidth,
          borderColor: iconBorderColor,
          shadowColor: colors.shadowTint,
          shadowOpacity: colors.ui.cartoon ? 0.06 : 0,
          shadowRadius: colors.ui.cartoon ? 0 : 0,
          shadowOffset: { width: 0, height: colors.ui.cartoon ? 1 : 0 },
        }}
      >
        <AppIcon name="message" color={colors.ui.icon.accentForeground} size={compact ? 24 : 28} strokeWidth={appIconStroke.fine} />
      </MotiView>
      <IslePanel material={panelMaterial} elevated={false} radius={colors.ui.radius.panel} style={{ width: '100%', maxWidth: panelMaxWidth }} contentStyle={{ padding: contentPadding }}>
        <View
          accessible
          accessibilityLabel={description ? `${title}. ${description}` : title}
          accessibilityLiveRegion="polite"
        >
          <Text style={{ color: colors.text, fontSize: compact ? 20 : 22, lineHeight: compact ? 26 : 28, fontWeight: '900', textAlign: 'center' }}>{title}</Text>
          {description ? (
            <Text style={{ color: colors.textSecondary, fontSize: compact ? 13.5 : 14, lineHeight: compact ? 20 : 21, textAlign: 'center', marginTop: 8 }}>
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
