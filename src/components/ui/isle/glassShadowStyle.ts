import type { ViewStyle } from 'react-native'
import type { AppPalette } from '@/theme/colors'

/**
 * Android elevation shadows include descendant render nodes. Through a
 * translucent surface those shadows expose the rectangular content bounds.
 * An outset box shadow follows the owner's rounded border and excludes its
 * interior, without adding a blur pass or changing the content layout.
 */
export function glassShadowStyle(
  colors: AppPalette,
  variant: 'none' | 'control' | 'surface' | 'floating' = 'surface',
): ViewStyle {
  const dark = colors.design?.mode === 'dark'
  const geometry = variant === 'control' ? '0 2px 8px' : variant === 'floating' ? '0 8px 26px' : '0 5px 18px'
  return {
    elevation: 0,
    shadowOpacity: 0,
    boxShadow: variant === 'none' ? 'none' : `${geometry} ${dark ? 'rgba(0, 5, 15, 0.22)' : 'rgba(29, 60, 90, 0.12)'}`,
  }
}
