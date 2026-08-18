import { useColorScheme } from 'react-native'
import { getColors, normalizeThemeId, resolveThemeMode } from '@/theme/colors'
import { useSettingsStore } from '@/store/settingsStore'
export function useAppTheme() {
  const systemScheme = useColorScheme()
  const themeMode = useSettingsStore((state) => state.settings.theme)
  const storedThemeId = useSettingsStore((state) => state.settings.themeId)
  const themeAccent = useSettingsStore((state) => state.settings.themeAccent)
  const resolvedTheme = resolveThemeMode(themeMode, systemScheme === 'unspecified' ? null : systemScheme)
  const themeId = normalizeThemeId(storedThemeId)
  const palette = getColors(resolvedTheme, themeId, undefined, themeAccent)

  return {
    colors: palette,
    isDark: resolvedTheme === 'dark',
    mode: resolvedTheme,
    themeMode,
    themeId,
    themeAccent,
    isMinimal: themeId === 'minimal',
    isMarkdown: themeId === 'markdown',
    // Keep the property until untouched presentation consumers migrate, but
    // no canonical family should enter former Glass-only branches.
    isGlass: false as const,
    isLimeRoad: themeId === 'lime-road',
  }
}
