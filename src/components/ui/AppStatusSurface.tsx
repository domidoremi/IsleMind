import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MotiView } from 'moti'

import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { AppIcon, appIconStroke, type AppIconName } from './AppIcon'
import {
  resolveAppStatusIcon,
  resolveAppStatusMotion,
  resolveAppStatusSafeAreaPadding,
  type AppStatusSafeAreaEdge,
  type AppStatusTone,
} from './appStatusSurfaceState'
import { IslePanel } from './isle/Panel'

export interface AppStatusSurfaceProps {
  title: string
  message?: string
  detail?: string
  tone?: AppStatusTone
  icon?: AppIconName
  actionLabel?: string
  onAction?: () => void
  dismissLabel?: string
  onDismiss?: () => void
  onPress?: () => void
  accessibilityRole?: 'alert' | 'text' | 'button'
  accessibilityLiveRegion?: 'none' | 'polite' | 'assertive'
  accessibilityHint?: string
  safeArea?: AppStatusSafeAreaEdge
  animate?: boolean
  compact?: boolean
  selectableMessage?: boolean
  showDisclosure?: boolean
  testID?: string
  style?: StyleProp<ViewStyle>
  children?: ReactNode
}

/** Shared, non-blocking feedback surface for startup, handoff, and inline recovery states. */
export function AppStatusSurface({
  title,
  message,
  detail,
  tone = 'info',
  icon,
  actionLabel,
  onAction,
  dismissLabel,
  onDismiss,
  onPress,
  accessibilityRole = 'text',
  accessibilityLiveRegion = tone === 'danger' ? 'assertive' : 'polite',
  accessibilityHint,
  safeArea = 'none',
  animate = false,
  compact = false,
  selectableMessage = false,
  showDisclosure,
  testID,
  style,
  children,
}: AppStatusSurfaceProps) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const insets = useSafeAreaInsets()
  const { t } = useTranslation()
  const toneToken = colors.ui.semantic.feedback[tone]
  const iconName = icon ?? resolveAppStatusIcon(tone)
  const motionConfig = resolveAppStatusMotion(motion, animate)
  const shouldAnimate = animate && motionConfig.duration > 1
  const safeAreaPadding = resolveAppStatusSafeAreaPadding(safeArea, insets)
  const hasAction = Boolean(actionLabel && onAction)
  const hasDismiss = Boolean(onDismiss)
  const disclosureVisible = showDisclosure ?? Boolean(onPress)
  const accessibilityLabel = [title, message, detail].filter(Boolean).join('. ')
  const panel = (
    <IslePanel
      material="chrome"
      elevated={false}
      radius={Math.min(colors.ui.radius.card, 8)}
      style={{ borderColor: toneToken.border, backgroundColor: colors.ui.semantic.chrome.background }}
      contentStyle={{ padding: compact ? 10 : 14, backgroundColor: colors.ui.semantic.chrome.background }}
    >
      <View style={styles.body}>
        <View
          accessible={!onPress}
          accessibilityRole={onPress ? undefined : accessibilityRole}
          accessibilityLiveRegion={accessibilityLiveRegion}
          accessibilityLabel={accessibilityLabel}
          style={styles.mainRow}
        >
          <View style={[styles.iconFrame, { backgroundColor: toneToken.background }]}>
            <AppIcon name={iconName} color={toneToken.foreground} size={compact ? 16 : 18} strokeWidth={appIconStroke.strong} />
          </View>
          <View style={styles.copy}>
            <Text numberOfLines={2} style={[styles.title, { color: colors.text }]}>{title}</Text>
            {message ? <Text selectable={selectableMessage} numberOfLines={compact ? 3 : 8} style={[styles.message, { color: colors.textSecondary }]}>{message}</Text> : null}
            {detail ? <Text selectable={selectableMessage} numberOfLines={compact ? 2 : 3} style={[styles.detail, { color: colors.textTertiary }]}>{detail}</Text> : null}
          </View>
          {disclosureVisible ? <AppIcon name="arrow-right" color={colors.textTertiary} size={16} strokeWidth={appIconStroke.strong} /> : null}
        </View>
        {children}
        {hasAction || hasDismiss ? (
          <View style={styles.actions}>
            {hasAction ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={actionLabel}
                onPress={onAction}
                style={({ pressed }) => [styles.action, { borderColor: colors.ui.control.primaryBorder, backgroundColor: colors.ui.control.primaryBackground, opacity: pressed ? 0.7 : 1 }]}
              >
                <Text numberOfLines={2} style={[styles.actionText, { color: colors.ui.control.primaryForeground }]}>{actionLabel}</Text>
              </Pressable>
            ) : null}
            {hasDismiss ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={dismissLabel ?? t('common.close')}
                onPress={onDismiss}
                style={({ pressed }) => [styles.dismiss, { opacity: pressed ? 0.6 : 1 }]}
              >
                <AppIcon name="close" color={colors.textTertiary} size={17} strokeWidth={appIconStroke.strong} />
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </IslePanel>
  )

  const surface = onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityLiveRegion={accessibilityLiveRegion}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.88 : 1 })}
    >
      {panel}
    </Pressable>
  ) : panel

  const content = shouldAnimate ? (
    <MotiView
      from={motionConfig.from}
      animate={motionConfig.animate}
      exit={motionConfig.exit}
      transition={{ type: 'timing', duration: motionConfig.duration }}
      testID={testID}
      style={styles.frame}
    >
      {surface}
    </MotiView>
  ) : (
    <View testID={testID} style={styles.frame}>{surface}</View>
  )

  return <View style={[safeAreaPadding, style]}>{content}</View>
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
  },
  body: {
    minWidth: 0,
  },
  mainRow: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconFrame: {
    width: 34,
    height: 34,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900',
    includeFontPadding: false,
  },
  message: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    includeFontPadding: false,
  },
  detail: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    includeFontPadding: false,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  action: {
    minHeight: 44,
    maxWidth: 180,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  actionText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textAlign: 'center',
  },
  dismiss: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
