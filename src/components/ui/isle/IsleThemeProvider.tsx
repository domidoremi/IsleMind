import type { ReactNode } from 'react'
import { ThemeProvider, ThemeTransitionProvider } from 'animal-island-ui-rn'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'

/** Application settings bridge only. The fork owns all RN theme rendering. */
export function IsleThemeProvider({ children }: { children: ReactNode }) {
  const { mode, themeAccent } = useAppTheme()
  const systemMotion = useMotionPreference(true)
  return <ThemeProvider mode={mode} accent={themeAccent} reducedMotion={systemMotion !== 'full'}>
    <ThemeTransitionProvider reducedMotion={systemMotion !== 'full'}>{children}</ThemeTransitionProvider>
  </ThemeProvider>
}
