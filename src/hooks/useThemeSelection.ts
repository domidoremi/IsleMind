import { useCallback, useLayoutEffect, useRef } from 'react'
import { Platform, useColorScheme, type GestureResponderEvent } from 'react-native'
import { useThemeTransition } from 'animal-island-ui-rn'
import { useSettingsStore } from '@/store/settingsStore'
import { getColors, normalizeThemeAccent, normalizeThemeId } from '@/theme/colors'
import type { Settings } from '@/types/settingsContracts'

type ThemeSelection = Partial<Pick<Settings, 'theme' | 'themeId' | 'themeAccent'>>

/** Keep the initiating control under the pointer when themed headers change height. */
export function captureThemeSelectionAnchor(event?: GestureResponderEvent): (() => void) | undefined {
  if (Platform.OS !== 'web') return undefined
  const target = event?.currentTarget as unknown as HTMLElement | undefined
  if (!target?.getBoundingClientRect) return undefined
  let scroller = target.parentElement
  while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) {
    scroller = scroller.parentElement
  }
  if (!scroller) return undefined
  const top = target.getBoundingClientRect().top
  const container = scroller
  return () => {
    if (target.isConnected && container.isConnected) container.scrollTop += target.getBoundingClientRect().top - top
  }
}

/** User-initiated appearance changes only; hydration and system changes stay immediate. */
export function useThemeSelection(onError: (error: unknown) => void, commit?: (selection: ThemeSelection) => void) {
  const transition = useThemeTransition()
  const systemScheme = useColorScheme()
  const pending = useRef(0)
  const requested = useRef<ThemeSelection>({})
  const restoreAnchor = useRef<(() => void) | undefined>(undefined)
  useLayoutEffect(() => {
    restoreAnchor.current?.()
    restoreAnchor.current = undefined
  })
  return useCallback((selection: ThemeSelection, event?: GestureResponderEvent) => {
    const settings = useSettingsStore.getState().settings
    const unchanged = () => {
      const current = useSettingsStore.getState().settings
      return Object.entries(selection).every(([key, value]) => current[key as keyof ThemeSelection] === value)
    }
    const intended = pending.current ? { ...settings, ...requested.current } : settings
    if (Object.entries(selection).every(([key, value]) => intended[key as keyof ThemeSelection] === value)) return
    if (!pending.current) requested.current = {}
    requested.current = { ...requested.current, ...selection }
    const next = { ...settings, ...requested.current }
    const destination = getColors(next.theme, normalizeThemeId(next.themeId), systemScheme === 'dark' ? 'dark' : 'light', normalizeThemeAccent(next.themeAccent))
    const press = event?.nativeEvent
    const anchor = captureThemeSelectionAnchor(event)
    const origin = press && Number.isFinite(press.pageX) && Number.isFinite(press.pageY) && (press.pageX !== 0 || press.pageY !== 0)
      ? { x: press.pageX, y: press.pageY }
      : undefined
    pending.current += 1
    void transition(() => {
      if (!unchanged()) {
        restoreAnchor.current = anchor
        if (commit) commit(selection)
        else useSettingsStore.getState().updateSettings(selection)
      }
    }, { origin, color: destination.background.canvas })
      .catch((error) => {
        if (restoreAnchor.current === anchor) restoreAnchor.current = undefined
        onError(error)
      })
      .finally(() => { pending.current -= 1 })
  }, [commit, onError, systemScheme, transition])
}
