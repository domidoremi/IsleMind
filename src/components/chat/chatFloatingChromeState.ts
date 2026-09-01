import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'

export interface ChatFloatingChromeState {
  chromeCollapsed: boolean
  markChromeActive: () => void
  restoreChrome: () => void
  setChromeCollapsed: Dispatch<SetStateAction<boolean>>
}

export function useChatFloatingChromeState({
  active,
  hasProviderHealthIssue,
  isStreaming,
  keepChromeExpanded,
  showOptions,
}: {
  active: boolean
  hasProviderHealthIssue: boolean
  isStreaming: boolean
  keepChromeExpanded: boolean
  showOptions: boolean
}): ChatFloatingChromeState {
  void isStreaming
  const collapseLocked = !active || hasProviderHealthIssue || keepChromeExpanded || showOptions
  const [chromeCollapsed, setChromeCollapsedState] = useState(false)

  const restoreChrome = useCallback(() => {
    setChromeCollapsedState(false)
  }, [])
  const markChromeActive = restoreChrome
  const setChromeCollapsed = useCallback<Dispatch<SetStateAction<boolean>>>((update) => {
    setChromeCollapsedState((current) => {
      const next = typeof update === 'function' ? update(current) : update
      return collapseLocked && next ? false : next
    })
  }, [collapseLocked])

  useEffect(() => {
    if (collapseLocked) restoreChrome()
  }, [collapseLocked, restoreChrome])

  return {
    chromeCollapsed,
    markChromeActive,
    restoreChrome,
    setChromeCollapsed,
  }
}
