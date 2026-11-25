import { useMemo, type ReactNode } from 'react'
import { ThemeProvider, ThemeTransitionProvider } from 'animal-island-ui-rn'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { AppFontContext, AppTextThemeContext } from '@/components/ui/AppText'
import { fontFamilyForTheme } from '@/theme/font'

/** Project the same appearance into application text and island-only controls. */
export function IsleThemeProvider({ children }: { children: ReactNode }) {
  const { colors, mode, themeAccent, canonicalThemeId } = useAppTheme()
  const systemMotion = useMotionPreference(true)
  const textTheme = useMemo(() => ({ colors, mode }), [colors, mode])
  return <ThemeProvider mode={mode} accent={themeAccent} reducedMotion={systemMotion !== 'full'}>
    <AppTextThemeContext.Provider value={textTheme}>
      <AppFontContext.Provider value={fontFamilyForTheme(canonicalThemeId)}>
        <ThemeTransitionProvider reducedMotion={systemMotion !== 'full'}>{children}</ThemeTransitionProvider>
      </AppFontContext.Provider>
    </AppTextThemeContext.Provider>
  </ThemeProvider>
}
