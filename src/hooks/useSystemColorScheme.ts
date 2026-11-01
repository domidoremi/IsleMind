import { useSyncExternalStore } from 'react'
import { Appearance } from 'react-native'

function subscribe(onChange: () => void) {
  const subscription = Appearance.addChangeListener(onChange)
  return () => subscription.remove()
}

function readColorScheme(): 'light' | 'dark' | null {
  const scheme = Appearance.getColorScheme()
  return scheme === 'light' || scheme === 'dark' ? scheme : null
}

function serverColorScheme() {
  return null
}

/** Stable subscriptions and fresh snapshots keep nested theme consumers in sync. */
export function useSystemColorScheme() {
  return useSyncExternalStore(subscribe, readColorScheme, serverColorScheme)
}
