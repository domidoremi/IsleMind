import type { ReactNode } from 'react'
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/ui/AppIcon'
import { useAppTheme } from '@/hooks/useAppTheme'
import { IslePressable } from './Pressable'
import type { IsleCardColor } from './IsleKit'

export type IsleTagSize = 'small' | 'medium' | 'large'
export type IsleTagVariant = 'solid' | 'outlined' | 'dashed' | 'soft'
export type IsleTagColor = IsleCardColor

export interface IsleTagProps {
  children: ReactNode
  size?: IsleTagSize
  variant?: IsleTagVariant
  color?: IsleTagColor
  closable?: boolean
  onClose?: () => void
  onPress?: () => void
  disabled?: boolean
  accessibilityLabel?: string
  closeAccessibilityLabel?: string
  style?: StyleProp<ViewStyle>
}

const tagMetrics: Record<IsleTagSize, { minHeight: number; paddingHorizontal: number; fontSize: number; lineHeight: number }> = {
  small: { minHeight: 24, paddingHorizontal: 8, fontSize: 11, lineHeight: 14 },
  medium: { minHeight: 28, paddingHorizontal: 10, fontSize: 12, lineHeight: 16 },
  large: { minHeight: 34, paddingHorizontal: 12, fontSize: 14, lineHeight: 18 },
}

function withAlpha(color: string, opacity: number) {
  return /^#[0-9a-f]{6}$/i.test(color)
    ? `${color}${Math.round(Math.max(0, Math.min(1, opacity)) * 255).toString(16).padStart(2, '0')}`
    : color
}

export function IsleTag({
  children,
  size = 'medium',
  variant = 'soft',
  color = 'default',
  closable = false,
  onClose,
  onPress,
  disabled = false,
  accessibilityLabel,
  closeAccessibilityLabel,
  style,
}: IsleTagProps) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const family = colors.design?.family ?? 'minimal'
  const metrics = tagMetrics[size]
  const selected = color === 'default'
    ? { bg: colors.ui.tone.neutral.background, fg: colors.ui.tone.neutral.foreground }
    : colors.cardColors[color]
  const solid = variant === 'solid'
  const outlined = variant === 'outlined' || variant === 'dashed'
  const backgroundColor = outlined
    ? 'transparent'
    : color === 'default'
      ? solid
        ? colors.ui.tone.ink.background
        : family === 'minimal' ? 'transparent' : colors.ui.tone.neutral.background
      : variant === 'soft'
        ? withAlpha(selected.bg, 0.48)
        : selected.bg
  const foregroundColor = color === 'default'
    ? solid
      ? colors.ui.tone.ink.foreground
      : colors.ui.tone.neutral.foreground
    : selected.fg
  const borderColor = color === 'default'
    ? solid
      ? colors.ui.tone.ink.border
      : colors.ui.tone.neutral.border
    : outlined
      ? selected.bg
      : variant === 'soft'
        ? withAlpha(selected.bg, 0.72)
        : 'transparent'
  const containerStyle: StyleProp<ViewStyle> = [
    {
      minHeight: metrics.minHeight,
      maxWidth: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 4,
      paddingLeft: metrics.paddingHorizontal,
      paddingRight: closable ? 4 : metrics.paddingHorizontal,
      borderRadius: colors.ui.radius.chip,
      borderWidth: outlined ? 1 : color === 'default' && family === 'minimal' ? 0 : StyleSheet.hairlineWidth,
      borderStyle: variant === 'dashed' ? 'dashed' : 'solid',
      borderColor,
      backgroundColor,
      opacity: disabled ? 0.72 : 1,
      cursor: onPress && !disabled ? 'pointer' : 'auto',
    },
    style,
  ]

  const content = (
    <>
      <Text
        numberOfLines={1}
        style={{
          flexShrink: 1,
          minWidth: 0,
          color: foregroundColor,
          fontSize: metrics.fontSize,
          lineHeight: metrics.lineHeight,
          fontWeight: '700',
          includeFontPadding: false,
          textAlignVertical: 'center',
        }}
      >
        {children}
      </Text>
      {closable ? (
        <IslePressable
          accessibilityLabel={closeAccessibilityLabel ?? `${t('dialog.close')} ${accessibilityLabel ?? ''}`.trim()}
          disabled={disabled}
          onPress={(event) => {
            event.stopPropagation()
            onClose?.()
          }}
          style={{
            width: Math.max(24, metrics.minHeight - 2),
            height: Math.max(24, metrics.minHeight - 2),
            borderRadius: colors.ui.radius.chip,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <AppIcon name="close" color={foregroundColor} size={Math.max(12, metrics.fontSize)} />
        </IslePressable>
      ) : null}
    </>
  )

  if (onPress) {
    return (
      <IslePressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={containerStyle}
      >
        {content}
      </IslePressable>
    )
  }

  return <View style={containerStyle}>{content}</View>
}
