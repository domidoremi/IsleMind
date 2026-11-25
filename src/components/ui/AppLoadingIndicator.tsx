import { View, type ViewProps } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useAppTheme } from '@/hooks/useAppTheme'
import { HighFrameSpinner } from './HighFrameSpinner'

export interface AppLoadingIndicatorProps extends Omit<ViewProps, 'children'> {
  color?: string
  size?: 'small' | 'large' | number
  animating?: boolean
  hidesWhenStopped?: boolean
}

/** Application-owned loading semantics and theme graphics on every platform. */
export function AppLoadingIndicator({ color, size = 'small', animating = true, hidesWhenStopped = true,
  style, accessibilityLabel, accessibilityState, ...props }: AppLoadingIndicatorProps) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  if (!animating && hidesWhenStopped) return null
  const diameter = typeof size === 'number' ? size : size === 'large' ? 36 : 20
  return <View accessible accessibilityRole="progressbar" accessibilityLabel={accessibilityLabel ?? t('common.loading')}
    accessibilityState={{ ...accessibilityState, busy: animating }} {...props}
    style={[{ alignItems: 'center', justifyContent: 'center' }, style]}>
    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <HighFrameSpinner color={color ?? colors.ui.loading.dot} size={diameter} active={animating} />
    </View>
  </View>
}
