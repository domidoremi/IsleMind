import { useColorScheme } from 'react-native'
import { colors } from '@/theme/colors'
import { useSettingsStore } from '@/store/settingsStore'

export function useAppTheme() {
  const systemScheme = useColorScheme()
  const themeMode = useSettingsStore((state) => state.settings.theme)
  const resolvedTheme = themeMode === 'system' ? systemScheme ?? 'light' : themeMode
  const palette = resolvedTheme === 'dark' ? colors.dark : colors.light

  return {
    colors: palette,
    isDark: resolvedTheme === 'dark',
    mode: resolvedTheme,
  }
}
