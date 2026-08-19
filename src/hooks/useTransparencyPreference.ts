import { useEffect, useState } from 'react'
import { Platform } from 'react-native'

interface ThemeMediaQueryList {
  matches: boolean
  addEventListener?: (type: 'change', listener: () => void) => void
  removeEventListener?: (type: 'change', listener: () => void) => void
  addListener?: (listener: () => void) => void
  removeListener?: (listener: () => void) => void
}

type ThemeWindow = {
  matchMedia?: (query: string) => ThemeMediaQueryList
}

const TRANSPARENCY_FALLBACK_QUERIES = [
  '(prefers-reduced-transparency: reduce)',
  '(forced-colors: active)',
  '(prefers-contrast: more)',
] as const

export function useTransparencyPreference(): boolean {
  const [reduced, setReduced] = useState(readTransparencyPreference)

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined
    const matchMedia = resolveThemeWindow()?.matchMedia
    if (!matchMedia) return undefined
    const queries = TRANSPARENCY_FALLBACK_QUERIES.map((query) => matchMedia(query))
    const update = () => setReduced(queries.some((query) => query.matches))
    update()
    for (const query of queries) {
      if (query.addEventListener) query.addEventListener('change', update)
      else query.addListener?.(update)
    }
    return () => {
      for (const query of queries) {
        if (query.removeEventListener) query.removeEventListener('change', update)
        else query.removeListener?.(update)
      }
    }
  }, [])

  return reduced
}

function readTransparencyPreference(): boolean {
  if (Platform.OS !== 'web') return true
  const matchMedia = resolveThemeWindow()?.matchMedia
  return matchMedia ? TRANSPARENCY_FALLBACK_QUERIES.some((query) => matchMedia(query).matches) : true
}

function resolveThemeWindow(): ThemeWindow | undefined {
  return (globalThis as typeof globalThis & { window?: ThemeWindow }).window
}
