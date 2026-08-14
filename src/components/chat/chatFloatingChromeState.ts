import { useCallback, type Dispatch, type SetStateAction } from 'react'

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
  void active
  void hasProviderHealthIssue
  void isStreaming
  void keepChromeExpanded
  void showOptions

  const chromeCollapsed = false
  const markChromeActive = useCallback(() => undefined, [])
  const restoreChrome = useCallback(() => undefined, [])
  const setChromeCollapsed = useCallback<Dispatch<SetStateAction<boolean>>>(() => undefined, [])

  return {
    chromeCollapsed,
    markChromeActive,
    restoreChrome,
    setChromeCollapsed,
  }
}
