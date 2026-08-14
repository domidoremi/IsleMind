import { AnimatePresence, MotiView } from 'moti'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/ui/AppIcon'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'
import { IslePressable } from './Pressable'
import type { StyleProp, ViewStyle } from 'react-native'

export interface IsleScrollToTopTarget {
  scrollTo?: (options: { x?: number; y?: number; animated?: boolean }) => void
  scrollToOffset?: (options: { offset: number; animated?: boolean }) => void
}

export interface IsleBackTopProps {
  target: () => IsleScrollToTopTarget | null
  scrollOffset?: number
  visibilityHeight?: number
  visible?: boolean
  animated?: boolean
  onPress?: () => void
  accessibilityLabel?: string
  accessibilityHint?: string
  style?: StyleProp<ViewStyle>
}

export function IsleBackTop({
  target,
  scrollOffset = 0,
  visibilityHeight = 400,
  visible,
  animated = true,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  style,
}: IsleBackTopProps) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const { t } = useTranslation()
  const shouldShow = visible ?? scrollOffset > visibilityHeight
  const shouldAnimate = animated && motion === 'full'

  return (
    <AnimatePresence>
      {shouldShow ? (
        <MotiView
          key="isle-back-top"
          from={shouldAnimate ? { opacity: 0, translateY: 8 } : { opacity: 1, translateY: 0 }}
          animate={{ opacity: 1, translateY: 0 }}
          exit={shouldAnimate ? { opacity: 0, translateY: 6 } : { opacity: 0, translateY: 0 }}
          transition={{ type: 'timing', duration: shouldAnimate ? motionTokens.duration.fast : 1 }}
          style={[{ position: 'absolute', right: 16, bottom: 16, zIndex: 20 }, style]}
        >
          <IslePressable
            haptic
            accessibilityLabel={accessibilityLabel ?? t('common.scrollToTop')}
            accessibilityHint={accessibilityHint ?? t('common.scrollToTopHint')}
            accessibilityRole="button"
            onPress={() => {
              const scrollTarget = target()
              if (scrollTarget?.scrollToOffset) {
                scrollTarget.scrollToOffset({ offset: 0, animated: shouldAnimate })
              } else {
                scrollTarget?.scrollTo?.({ x: 0, y: 0, animated: shouldAnimate })
              }
              onPress?.()
            }}
            style={{
              width: 48,
              height: 48,
              borderRadius: colors.ui.radius.controlLarge,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.ui.semantic.chrome.background,
              borderWidth: 1,
              borderColor: colors.ui.semantic.chrome.border,
              shadowColor: colors.shadowTint,
              shadowOpacity: colors.ui.glass ? 0 : colors.shadow.mediumOpacity,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 2 },
              elevation: 3,
            }}
          >
            <AppIcon name="arrow-up" color={colors.ui.icon.accentForeground} size={20} />
          </IslePressable>
        </MotiView>
      ) : null}
    </AnimatePresence>
  )
}
