import { useColorScheme } from 'react-native'
import { getColors, normalizeThemeId, resolveThemeMode } from '@/theme/colors'
import { useSettingsStore } from '@/store/settingsStore'

export function useAppTheme() {
  const systemScheme = useColorScheme()
  const settings = useSettingsStore((state) => state.settings)
  const resolvedTheme = resolveThemeMode(settings.theme, systemScheme)
  const themeId = normalizeThemeId(settings.themeId)
  const palette = getColors(resolvedTheme, themeId)

  return {
    colors: palette,
    isDark: resolvedTheme === 'dark',
    mode: resolvedTheme,
    themeMode: settings.theme,
    themeId,
    isMinimal: themeId === 'minimal',
    isGlass: themeId === 'glass',
    isCartoon: themeId === 'cartoon',
  }
}
