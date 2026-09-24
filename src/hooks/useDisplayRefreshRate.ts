import { useEffect } from 'react'
import { NativeModules, Platform } from 'react-native'

// Multiple retained screens may overlap during navigation. The last visible
// animation releases the window hint; a route handover must not pulse it off.
let owners = 0
let releaseTimer: ReturnType<typeof setTimeout> | undefined

export function useDisplayRefreshRate(animated: boolean) {
  useEffect(() => {
    const display = Platform.OS === 'android' ? NativeModules.AndroidDisplayRefresh : undefined
    if (!animated || !display?.setHighRefreshRate) return
    if (releaseTimer !== undefined) {
      clearTimeout(releaseTimer)
      releaseTimer = undefined
    } else if (owners === 0) {
      display.setHighRefreshRate(true)
    }
    owners += 1
    return () => {
      owners -= 1
      if (owners === 0) releaseTimer = setTimeout(() => {
        releaseTimer = undefined
        if (owners === 0) display.setHighRefreshRate(false)
      }, 100)
    }
  }, [animated])
}
