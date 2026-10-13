import type { ReactNode } from 'react'
import { ThemeProvider, ThemeTransitionProvider } from 'animal-island-ui-rn'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { AppFontContext } from '@/components/ui/AppText'
import { fontFamilyForTheme } from '@/theme/font'

/** Application settings bridge only. The fork owns all RN theme rendering. */
export function IsleThemeProvider({ children }: { children: ReactNode }) {
  const { mode, themeAccent, canonicalThemeId } = useAppTheme()
  const systemMotion = useMotionPreference(true)
  return <ThemeProvider mode={mode} accent={themeAccent} reducedMotion={systemMotion !== 'full'}>
    <AppFontContext.Provider value={fontFamilyForTheme(canonicalThemeId)}>
      <ThemeTransitionProvider reducedMotion={systemMotion !== 'full'}>{children}</ThemeTransitionProvider>
    </AppFontContext.Provider>
  </ThemeProvider>
}
