import type { NativeStackNavigationOptions } from 'expo-router'
import type { MotionIntensity } from '@/theme/themeMotion'
import type { CanonicalThemeId } from '@/types/settingsContracts'
import { THEME_MOTION_DURATIONS } from '@/theme/themeTokens'

/** Native-stack transitions keep the departing screen visible during navigation. */
export function resolveStackTransitionOptions(
  platform: string,
  motion: MotionIntensity,
  themeId: CanonicalThemeId = 'minimal',
): NativeStackNavigationOptions {
  return {
    animation: motion === 'none' ? 'none'
      : motion === 'reduced' ? 'fade'
        : themeId === 'minimal' ? 'fade'
          : themeId === 'monet' || themeId === 'liquid-glass' ? 'fade_from_bottom'
            : themeId === 'material' || platform === 'ios' ? 'slide_from_right' : 'simple_push',
    animationDuration: motion === 'none' ? 0 : motion === 'reduced' ? 120 : THEME_MOTION_DURATIONS[themeId].page,
    // Preserve the existing gesture boundary; settings details own horizontal swipes.
    gestureEnabled: false,
    fullScreenGestureEnabled: false,
    animationMatchesGesture: false,
  }
}
