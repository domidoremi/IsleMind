import { useColorScheme } from 'react-native'
import { getColors, normalizeThemeId, resolveThemeMode, resolveThemePresentationId } from '@/theme/colors'
import { resolveThemeDesignTokens } from '@/theme/themeTokens'
import { useSettingsStore } from '@/store/settingsStore'
export function useAppTheme() {
  const systemScheme = useColorScheme()
  const themeMode = useSettingsStore((state) => state.settings.theme)
  const storedThemeId = useSettingsStore((state) => state.settings.themeId)
  const themeAccent = useSettingsStore((state) => state.settings.themeAccent)
  const resolvedTheme = resolveThemeMode(themeMode, systemScheme === 'unspecified' ? null : systemScheme)
  const canonicalThemeId = normalizeThemeId(storedThemeId)
  const themeId = resolveThemePresentationId(canonicalThemeId)
  const palette = getColors(resolvedTheme, canonicalThemeId, undefined, themeAccent)
  const design = palette.design ?? resolveThemeDesignTokens(canonicalThemeId, resolvedTheme)

  return {
    colors: palette,
    design,
    isDark: resolvedTheme === 'dark',
    mode: resolvedTheme,
    themeMode,
    canonicalThemeId,
    // Compatibility projection for untouched theme composition dispatchers.
    themeId,
    themeAccent,
    isMinimal: canonicalThemeId === 'minimal',
    isMonet: canonicalThemeId === 'monet',
    isMaterial: canonicalThemeId === 'material',
    isLiquidGlass: canonicalThemeId === 'liquid-glass',
    isMarkdown: canonicalThemeId === 'material',
    isGlass: canonicalThemeId === 'liquid-glass',
    isLimeRoad: canonicalThemeId === 'monet',
  }
}
