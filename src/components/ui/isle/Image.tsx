import { useEffect, useState } from 'react'
import { Modal, StyleSheet, Text, View, useWindowDimensions, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native'
import { Image as ExpoImage, type ImageProps as ExpoImageProps } from 'expo-image'
import { StatusBar } from 'expo-status-bar'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AppIcon } from '@/components/ui/AppIcon'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { IsleOverlayPressable, IslePressable } from './Pressable'
import type { IsleCardColor } from './IsleKit'

export type IsleImageColor = 'white' | IsleCardColor

export interface IsleImageProps extends Omit<ExpoImageProps, 'source' | 'style' | 'onLoad' | 'onError' | 'accessibilityLabel' | 'alt'> {
  source: NonNullable<ExpoImageProps['source']>
  alt?: string
  width?: DimensionValue
  height?: DimensionValue
  aspectRatio?: number
  color?: IsleImageColor
  preview?: boolean
  onLoad?: ExpoImageProps['onLoad']
  onError?: ExpoImageProps['onError']
  previewAccessibilityLabel?: string
  closePreviewAccessibilityLabel?: string
  errorAccessibilityLabel?: string
  style?: StyleProp<ViewStyle>
  imageStyle?: ExpoImageProps['style']
}

export function IsleImage({
  source,
  alt = '',
  width = '100%',
  height,
  aspectRatio = 4 / 3,
  color = 'white',
  preview = true,
  onLoad,
  onError,
  previewAccessibilityLabel,
  closePreviewAccessibilityLabel,
  errorAccessibilityLabel,
  style,
  imageStyle,
  contentFit = 'cover',
  transition,
  ...props
}: IsleImageProps) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions()
  const [failed, setFailed] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

  useEffect(() => {
    setFailed(false)
    setPreviewOpen(false)
  }, [source])

  const selected = color === 'white'
    ? { bg: colors.ui.semantic.surface.raised, fg: colors.textSecondary }
    : color === 'default'
      ? { bg: colors.ui.tone.neutral.background, fg: colors.ui.tone.neutral.foreground }
      : colors.cardColors[color]
  const frameStyle: StyleProp<ViewStyle> = [
    {
      width,
      height,
      aspectRatio: height === undefined ? aspectRatio : undefined,
      minHeight: height === undefined ? 96 : undefined,
      overflow: 'hidden',
      borderRadius: colors.ui.radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.ui.semantic.chrome.border,
      backgroundColor: selected.bg,
    },
    style,
  ]
  const resolvedPreviewLabel = previewAccessibilityLabel ?? (alt ? `${t('common.openImagePreview')}: ${alt}` : t('common.openImagePreview'))

  const image = failed ? (
    <View
      accessibilityLabel={errorAccessibilityLabel ?? (alt ? `${t('common.imageLoadFailed')}: ${alt}` : t('common.imageLoadFailed'))}
      accessibilityRole="image"
      style={{ flex: 1, minHeight: 96, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 }}
    >
      <AppIcon name="image" color={selected.fg} size={28} />
      <Text style={{ color: selected.fg, fontSize: 12, lineHeight: 17, fontWeight: '600', textAlign: 'center' }}>
        {t('common.imageLoadFailed')}
      </Text>
    </View>
  ) : (
    <ExpoImage
      {...props}
      source={source}
      accessibilityLabel={alt || undefined}
      accessible={!preview}
      contentFit={contentFit}
      transition={transition ?? (motion === 'full' ? 140 : 0)}
      onLoad={(event) => onLoad?.(event)}
      onError={(event) => {
        setFailed(true)
        onError?.(event)
      }}
      style={[{ width: '100%', height: '100%' }, imageStyle]}
    />
  )

  return (
    <>
      {preview && !failed ? (
        <IslePressable
          accessibilityLabel={resolvedPreviewLabel}
          accessibilityRole="button"
          onPress={() => setPreviewOpen(true)}
          style={frameStyle}
        >
          {image}
        </IslePressable>
      ) : (
        <View style={frameStyle}>{image}</View>
      )}
      <Modal
        transparent
        visible={previewOpen}
        animationType={motion === 'full' ? 'fade' : 'none'}
        onRequestClose={() => setPreviewOpen(false)}
        statusBarTranslucent
      >
        <StatusBar style="light" />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: insets.top + 16, paddingRight: 16, paddingBottom: insets.bottom + 16, paddingLeft: 16 }}>
          <IsleOverlayPressable
            accessibilityLabel={closePreviewAccessibilityLabel ?? t('common.closeImagePreview')}
            onPress={() => setPreviewOpen(false)}
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.backdrop }}
          />
          <View
            accessibilityLabel={alt || t('common.openImagePreview')}
            accessibilityRole="image"
            style={{ width: Math.max(240, viewportWidth - 32), maxWidth: 960, height: Math.max(220, viewportHeight - insets.top - insets.bottom - 64), maxHeight: 840 }}
          >
            <ExpoImage source={source} contentFit="contain" accessible={false} transition={motion === 'full' ? 140 : 0} style={{ width: '100%', height: '100%' }} />
          </View>
          <IslePressable
            accessibilityLabel={closePreviewAccessibilityLabel ?? t('common.closeImagePreview')}
            accessibilityRole="button"
            onPress={() => setPreviewOpen(false)}
            style={{
              position: 'absolute',
              top: insets.top + 12,
              right: 12,
              width: 44,
              height: 44,
              borderRadius: colors.ui.radius.controlLarge,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.ui.semantic.chrome.background,
              borderWidth: 1,
              borderColor: colors.ui.semantic.chrome.border,
            }}
          >
            <AppIcon name="close" color={colors.text} size={20} />
          </IslePressable>
        </View>
      </Modal>
    </>
  )
}
