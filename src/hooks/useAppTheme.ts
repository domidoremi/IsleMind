import { useColorScheme } from 'react-native'
import { getColors, normalizeThemeId, resolveThemeMode } from '@/theme/colors'
import { useSettingsStore } from '@/store/settingsStore'
export function useAppTheme() {
  const systemScheme = useColorScheme()
  const settings = useSettingsStore((state) => state.settings)
  const resolvedTheme = resolveThemeMode(settings.theme, systemScheme === 'unspecified' ? null : systemScheme)
  const themeId = normalizeThemeId(settings.themeId)
  const themeAccent = settings.themeAccent
  const palette = getColors(resolvedTheme, themeId, undefined, themeAccent)

  return {
    colors: palette,
    isDark: resolvedTheme === 'dark',
    mode: resolvedTheme,
    themeMode: settings.theme,
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
