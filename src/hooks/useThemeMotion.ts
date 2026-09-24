import { useMemo } from 'react'
import { Easing } from 'react-native-reanimated'
import { normalizeThemeId } from '@/theme/colors'
import { resolveThemeMotion, THEME_EXPERIENCE_EXTENSIONS, type MotionIntensity, type ThemeMotionRole } from '@/theme/themeMotion'
import { useAppTheme } from './useAppTheme'
import { useMotionPreference } from './useMotionPreference'

// Stable easing functions: rerendering a field or streaming text must not
// manufacture a new animation configuration on every update.
const curves = {
  precision: Easing.out(Easing.cubic),
  organic: Easing.inOut(Easing.sin),
  material: Easing.bezier(0.2, 0, 0, 1),
  fluid: Easing.out(Easing.quad),
  island: Easing.bezier(0.22, 1, 0.36, 1),
}

type ThemeMotionOptions = Omit<Parameters<typeof resolveThemeMotion>[0], 'role' | 'intensity' | 'themeId'> & {
  themeId?: Parameters<typeof resolveThemeMotion>[0]['themeId']
  motion?: MotionIntensity
}

/** Interaction motion follows the OS; scenic decoration stays conservative. */
export function useThemeMotion(role: ThemeMotionRole, options: ThemeMotionOptions = {}) {
  const { canonicalThemeId } = useAppTheme()
  const themeId = normalizeThemeId(options.themeId ?? canonicalThemeId)
  const preferred = useMotionPreference(role !== 'scenic' || themeId === 'liquid-glass')
  const intensity = options.motion ?? preferred
  const { readable, direction, order } = options
  return useMemo(() => {
    const resolved = resolveThemeMotion({ readable, direction, order, themeId, role, intensity })
    return {
      ...resolved,
      intensity,
      transition: {
        ...resolved.transition,
        easing: intensity === 'full' ? curves[THEME_EXPERIENCE_EXTENSIONS[themeId].motion.curve] : curves.precision,
      },
    }
  }, [readable, direction, order, themeId, role, intensity])
}
