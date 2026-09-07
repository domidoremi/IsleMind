import { useColorScheme } from 'react-native'
import { getColors, normalizeThemeAccent, normalizeThemeId, resolveThemeMode } from '@/theme/colors'
import { resolveThemeDesignTokens } from '@/theme/themeTokens'
import { resolveBackgroundEnvironment } from '@/theme/backgroundEnvironment'
import { useSettingsStore } from '@/store/settingsStore'

const BACKGROUND_STARTUP_SEED = Date.now() >>> 0

export function useAppTheme() {
  const systemScheme = useColorScheme()
  const themeMode = useSettingsStore((state) => state.settings.theme)
  const storedThemeId = useSettingsStore((state) => state.settings.themeId)
  const storedThemeAccent = useSettingsStore((state) => state.settings.themeAccent)
  const backgroundVariation = useSettingsStore((state) => state.settings.backgroundVariation)
  const backgroundMotion = useSettingsStore((state) => state.settings.backgroundMotion)
  const backgroundIntensity = useSettingsStore((state) => state.settings.backgroundIntensity)
  const backgroundPreset = useSettingsStore((state) => state.settings.backgroundPreset)
  // Keep the bridge and native projection on the same normalized value while
  // a corrupt snapshot is being hydrated.
  const themeAccent = normalizeThemeAccent(storedThemeAccent)
  const resolvedTheme = resolveThemeMode(themeMode, systemScheme === 'unspecified' ? null : systemScheme)
  const canonicalThemeId = normalizeThemeId(storedThemeId)
  const palette = getColors(resolvedTheme, canonicalThemeId, undefined, themeAccent)
  const design = palette.design ?? resolveThemeDesignTokens(canonicalThemeId, resolvedTheme)
  const backgroundEnvironment = resolveBackgroundEnvironment({
    family: canonicalThemeId,
    mode: resolvedTheme,
    accent: themeAccent,
    variation: backgroundVariation,
    motion: backgroundMotion,
    intensity: backgroundIntensity,
    preset: backgroundPreset,
    startupSeed: BACKGROUND_STARTUP_SEED,
  })

  return {
    colors: palette,
    design,
    isDark: resolvedTheme === 'dark',
    mode: resolvedTheme,
    themeMode,
    canonicalThemeId,
    themeAccent,
    backgroundEnvironment,
    isMinimal: canonicalThemeId === 'minimal',
    isMonet: canonicalThemeId === 'monet',
    isMaterial: canonicalThemeId === 'material',
    isLiquidGlass: canonicalThemeId === 'liquid-glass',
  }
}
