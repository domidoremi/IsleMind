import { StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { AnimatedNavigationIcon, type NavigationGlyph } from '@/components/navigation/AnimatedNavigationIcon'
import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
import { useNavigationTrigger } from '@/components/navigation/AnimatedNavigationTrigger'
import { useAppTheme } from '@/hooks/useAppTheme'
import { IslePanel } from './Panel'
import { IsleButton } from './Controls'

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
  const { width } = useWindowDimensions()
  const navigation = useNavigationTrigger(onAction ?? (() => undefined))
  const actionPress = actionGlyph ? navigation.trigger : onAction
  const compact = compactOverride ?? width < 390
  const iconSize = compact ? 52 : 58
  const panelMaxWidth = Math.max(260, Math.min(340, width - 48))
  const actionMinWidth = Math.max(124, Math.min(148, panelMaxWidth * 0.44))
  const panelMaterial = contextual ? 'transparent' : colors.ui.minimal ? 'transparent' : colors.ui.glass ? 'chrome' : 'raised'
  const iconSurface = colors.ui.limeRoad
    ? colors.ui.icon.accentBackground
    : colors.ui.glass
      ? colors.ui.actionBar.itemBackground
      : colors.ui.minimal || contextual
        ? 'transparent'
        : colors.ui.semantic.surface.muted
  const iconBorderColor = colors.ui.limeRoad
    ? colors.material.stroke
    : colors.ui.glass
      ? colors.ui.actionBar.itemBorder
      : colors.ui.minimal
        ? 'transparent'
        : colors.ui.semantic.chrome.border
  const iconBorderWidth = colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth
  const contentPadding = panelMaterial === 'transparent' ? 0 : compact ? 16 : 18

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: compact ? 18 : 24 }}>
      <View
        style={{
          width: iconSize,
          height: iconSize,
          borderRadius: Math.min(colors.ui.radius.panel, 8),
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: iconSurface,
          marginBottom: compact ? 10 : 12,
          borderWidth: iconBorderWidth,
          borderColor: iconBorderColor,
          shadowColor: colors.shadowTint,
          shadowOpacity: 0,
          shadowRadius: 0,
          shadowOffset: { width: 0, height: 0 },
        }}
      >
        <AppIcon name="message" color={colors.ui.icon.accentForeground} size={compact ? 23 : 25} strokeWidth={appIconStroke.fine} />
      </View>
      <IslePanel material={panelMaterial} elevated={false} radius={Math.min(colors.ui.radius.panel, 8)} style={{ width: '100%', maxWidth: panelMaxWidth }} contentStyle={{ padding: contentPadding }}>
        <View
          accessible
          accessibilityLabel={description ? `${title}. ${description}` : title}
          accessibilityLiveRegion="polite"
        >
          <Text style={{ color: colors.text, fontSize: compact ? 18 : 20, lineHeight: compact ? 24 : 26, fontWeight: '700', textAlign: 'center' }}>{title}</Text>
          {description ? (
            <Text style={{ color: colors.textSecondary, fontSize: compact ? 13 : 13.5, lineHeight: compact ? 19 : 20, textAlign: 'center', marginTop: 6 }}>
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
          style={{ alignSelf: 'center', marginTop: compact ? 12 : 14, minWidth: actionMinWidth, minHeight: 44, borderRadius: Math.min(colors.ui.radius.controlLarge, 8) }}
        />
      ) : null}
    </View>
  )
}

export const IsleEmpty = IsleEmptyState
export const EmptyState = IsleEmptyState
