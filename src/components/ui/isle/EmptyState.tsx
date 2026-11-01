import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { Text } from '@/components/ui/AppText'
import { AnimatedNavigationIcon, type NavigationGlyph } from '@/components/navigation/AnimatedNavigationIcon'
import { AppIcon, appIconStroke, type AppIconName } from '@/components/ui/AppIcon'
import { useNavigationTrigger } from '@/components/navigation/AnimatedNavigationTrigger'
import { useAppTheme } from '@/hooks/useAppTheme'
import { glassShadowStyle } from './glassShadowStyle'
import { resolveThemeComponentExpression } from '@/theme/themeExpression'
import { IslePanel } from './Panel'
import { IsleButton } from './Controls'
import { IsleMotionFrame } from './ThemeMotion'

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
  icon?: AppIconName
  testID?: string
}

export function IsleEmptyState({ title, description, actionLabel, actionGlyph, actionBusy = false, actionDisabled = false, onAction, compact: compactOverride, contextual = false, tone = 'empty', icon, testID }: EmptyStateProps) {
  const { colors, canonicalThemeId } = useAppTheme()
  const { width, fontScale } = useWindowDimensions()
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
  const compact = compactOverride ?? width / fontScale < 390
  const iconSize = minimal ? 38 : contextual ? 48 : compact ? 64 : 72
  const panelMaxWidth = Math.min(380, Math.max(0, width - (compact ? 36 : 48)))
  const actionMinWidth = Math.max(124, Math.min(148, panelMaxWidth * 0.44))
  const panelMaterial = 'transparent'
  const iconSurface = contextual || minimal
    ? 'transparent'
    : toneColors
      ? toneColors.background
    : glass
      ? colors.ui.actionBar.itemBackground
      : colors.ui.icon.accentBackground
  const iconBorderColor = toneColors ? toneColors.border : minimal ? colors.ui.section.divider : glass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
  const iconBorderWidth = expression.border === 'none' ? 0 : expression.border === 'divider' ? StyleSheet.hairlineWidth : 1
  const contentPadding = 0
  const contentAlignment = minimal ? 'left' : 'center'
  const panelRadius = expression.shape === 'capsule'
    ? colors.ui.radius.chip
    : expression.shape === 'material'
      ? colors.ui.radius.panel
      : expression.shape === 'soft'
        ? colors.ui.radius.controlLarge
        : 2

  return (
    <View testID={testID} style={{ flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: compact ? 18 : 24, paddingVertical: contextual ? 18 : 28 }}>
      <IsleMotionFrame role="section" testID={`${tone === 'error' ? 'error' : 'empty'}-state-experience-${canonicalThemeId}`} style={{ width: '100%', maxWidth: panelMaxWidth, alignItems: minimal ? 'stretch' : 'center' }}>
        <View
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={{
            width: iconSize,
            height: iconSize,
            borderRadius: minimal ? 0 : material ? Math.min(colors.ui.radius.controlLarge, 18) : iconSize / 2,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: iconSurface,
            marginBottom: contextual ? 14 : 24,
            borderWidth: iconBorderWidth,
            borderLeftWidth: minimal ? 2 : iconBorderWidth,
            borderColor: iconBorderColor,
            shadowColor: colors.shadowTint,
            shadowOpacity: glass ? 0.16 : monet ? 0.08 : 0,
            shadowRadius: glass ? 16 : monet ? 12 : 0,
            shadowOffset: { width: 0, height: glass ? 6 : 3 },
            elevation: glass ? 3 : monet ? 1 : 0,
            ...(glass ? glassShadowStyle(colors, 'control') : {}),
          }}
        >
          {!minimal && !contextual && tone === 'empty' ? <>
            <View style={{ position: 'absolute', width: iconSize + 20, height: iconSize + 20, borderRadius: material ? 28 : (iconSize + 20) / 2, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.ui.section.divider, transform: [{ rotate: monet ? '-8deg' : '8deg' }], opacity: 0.6 }} />
            <View style={{ position: 'absolute', top: 0, right: -8, width: 7, height: 7, borderRadius: 4, backgroundColor: colors.ui.icon.accentForeground, opacity: 0.75 }} />
            <View style={{ position: 'absolute', bottom: 2, left: -12, width: 16, height: 3, borderRadius: 2, backgroundColor: colors.ui.section.divider }} />
          </> : null}
          {monet ? <View accessible={false} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', top: 4, left: 10, right: 10, height: 2, borderRadius: 2, backgroundColor: colors.ui.control.focus, opacity: 0.22 }} /> : null}
          <AppIcon name={icon ?? (tone === 'error' ? 'warning' : 'message')} color={tone === 'error' ? colors.ui.tone.danger.foreground : colors.ui.icon.accentForeground} size={minimal ? 20 : contextual ? 22 : 30} strokeWidth={minimal ? appIconStroke.regular : appIconStroke.fine} />
        </View>
        <IslePanel material={panelMaterial} elevated={expression.elevation !== 'none'} radius={panelRadius} style={{ width: '100%', maxWidth: panelMaxWidth }} contentStyle={{ padding: contentPadding }}>
          <View
            accessible
            accessibilityLabel={description ? `${title}. ${description}` : title}
            accessibilityLiveRegion="polite"
          >
            <Text style={{ ...colors.design?.semantic.typography.title, ...(!contextual ? { fontSize: compact ? 21 : 24, lineHeight: compact ? 29 : 34 } : null), color: colors.text, textAlign: contentAlignment }}>{title}</Text>
            {description ? (
              <Text style={{ ...colors.design?.semantic.typography.body, color: colors.textSecondary, textAlign: contentAlignment, marginTop: 6 }}>
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
                style={{ alignSelf: minimal ? 'flex-start' : 'center', marginTop: contextual ? 16 : 22, minWidth: actionMinWidth, minHeight: 44 }}
          />
        ) : null}
      </IsleMotionFrame>
    </View>
  )
}

export const IsleEmpty = IsleEmptyState
export const EmptyState = IsleEmptyState
