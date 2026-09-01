import { StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { AnimatedNavigationIcon, type NavigationGlyph } from '@/components/navigation/AnimatedNavigationIcon'
import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
import { useNavigationTrigger } from '@/components/navigation/AnimatedNavigationTrigger'
import { useAppTheme } from '@/hooks/useAppTheme'
import { resolveThemeComponentExpression } from '@/theme/themeExpression'
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
  tone?: 'empty' | 'error'
}

export function IsleEmptyState({ title, description, actionLabel, actionGlyph, actionBusy = false, actionDisabled = false, onAction, compact: compactOverride, contextual = false, tone = 'empty' }: EmptyStateProps) {
  const { colors, canonicalThemeId } = useAppTheme()
  const { width } = useWindowDimensions()
  const navigation = useNavigationTrigger(onAction ?? (() => undefined))
  const actionPress = actionGlyph ? navigation.trigger : onAction
  const expression = tone === 'error'
    ? resolveThemeComponentExpression(canonicalThemeId, 'errorState')
    : resolveThemeComponentExpression(canonicalThemeId, 'emptyState')
  const toneColors = tone === 'error' ? colors.ui.tone.danger : null
  const minimal = canonicalThemeId === 'minimal'
  const monet = canonicalThemeId === 'monet'
  const material = canonicalThemeId === 'material'
  const glass = canonicalThemeId === 'liquid-glass'
  const compact = compactOverride ?? width < 390
  const iconSize = minimal ? 38 : compact ? 52 : 58
  const panelMaxWidth = Math.max(260, Math.min(340, width - 48))
  const actionMinWidth = Math.max(124, Math.min(148, panelMaxWidth * 0.44))
  // Empty states are an open composition; only Material and Glass need a
  // bounded surface to establish their tonal/lens hierarchy.
  const panelMaterial = contextual || minimal || monet ? 'transparent' : glass ? 'chrome' : material ? 'muted' : 'raised'
  const iconSurface = contextual || minimal
    ? 'transparent'
    : toneColors
      ? toneColors.background
    : glass
      ? colors.ui.actionBar.itemBackground
      : material
        ? colors.ui.semantic.surface.muted
        : colors.ui.icon.accentBackground
  const iconBorderColor = toneColors ? toneColors.border : minimal ? colors.ui.section.divider : glass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
  const iconBorderWidth = expression.border === 'none' ? 0 : expression.border === 'divider' ? StyleSheet.hairlineWidth : 1
  const contentPadding = panelMaterial === 'transparent' ? 0 : compact ? 16 : 18
  const contentAlignment = minimal ? 'left' : 'center'
  const panelRadius = expression.shape === 'capsule'
    ? colors.ui.radius.chip
    : expression.shape === 'material'
      ? colors.ui.radius.panel
      : expression.shape === 'soft'
        ? colors.ui.radius.controlLarge
        : 2

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: compact ? 18 : 24 }}>
      <View testID={`${tone === 'error' ? 'error' : 'empty'}-state-experience-${canonicalThemeId}`} style={{ width: '100%', maxWidth: panelMaxWidth, alignItems: minimal ? 'stretch' : 'center' }}>
        <View
          style={{
            width: iconSize,
            height: iconSize,
            borderRadius: minimal ? 0 : material ? Math.min(colors.ui.radius.controlLarge, 18) : iconSize / 2,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: iconSurface,
            marginBottom: compact ? 10 : 12,
            borderWidth: iconBorderWidth,
            borderLeftWidth: minimal ? 2 : iconBorderWidth,
            borderColor: iconBorderColor,
            shadowColor: colors.shadowTint,
            shadowOpacity: glass ? 0.16 : monet ? 0.08 : 0,
            shadowRadius: glass ? 16 : monet ? 12 : 0,
            shadowOffset: { width: 0, height: glass ? 6 : 3 },
            elevation: glass ? 3 : monet ? 1 : 0,
          }}
        >
          {monet ? <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', top: 4, left: 10, right: 10, height: 2, borderRadius: 2, backgroundColor: colors.ui.control.focus, opacity: 0.22 }} /> : null}
          {glass ? <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', top: 1, left: 9, right: 9, height: 1, backgroundColor: colors.ui.semantic.content.inverse, opacity: 0.56 }} /> : null}
          <AppIcon name={tone === 'error' ? 'warning' : 'message'} color={tone === 'error' ? colors.ui.tone.danger.foreground : colors.ui.icon.accentForeground} size={minimal ? 20 : compact ? 23 : 25} strokeWidth={minimal ? appIconStroke.regular : appIconStroke.fine} />
        </View>
        <IslePanel material={panelMaterial} elevated={expression.elevation !== 'none'} radius={panelRadius} style={{ width: '100%', maxWidth: panelMaxWidth }} contentStyle={{ padding: contentPadding }}>
          <View
            accessible
            accessibilityLabel={description ? `${title}. ${description}` : title}
            accessibilityLiveRegion="polite"
          >
            <Text style={{ color: colors.text, fontSize: compact ? 18 : 20, lineHeight: compact ? 24 : 26, fontWeight: material ? '600' : '700', textAlign: contentAlignment }}>{title}</Text>
            {description ? (
              <Text style={{ color: colors.textSecondary, fontSize: compact ? 13 : 13.5, lineHeight: compact ? 19 : 20, textAlign: contentAlignment, marginTop: 6 }}>
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
            style={{ alignSelf: minimal ? 'flex-start' : 'center', marginTop: compact ? 12 : 14, minWidth: actionMinWidth, minHeight: 44 }}
          />
        ) : null}
      </View>
    </View>
  )
}

export const IsleEmpty = IsleEmptyState
export const EmptyState = IsleEmptyState
