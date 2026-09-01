import { act, renderHook } from '@testing-library/react-native'

import { useChatFloatingChromeState } from './chatFloatingChromeState'

const unlockedState = {
  active: true,
  hasProviderHealthIssue: false,
  isStreaming: false,
  keepChromeExpanded: false,
  showOptions: false,
}

describe('chat floating chrome state', () => {
  it('collapses only when unlocked and restores immediately on activity', async () => {
    const { result, rerender } = await renderHook(
      (props: typeof unlockedState) => useChatFloatingChromeState(props),
      { initialProps: unlockedState },
    )

    await act(async () => result.current.setChromeCollapsed(true))
    expect(result.current.chromeCollapsed).toBe(true)

    await act(async () => result.current.markChromeActive())
    expect(result.current.chromeCollapsed).toBe(false)

    await act(async () => result.current.setChromeCollapsed(true))
    await rerender({ ...unlockedState, showOptions: true })
    expect(result.current.chromeCollapsed).toBe(false)

    await act(async () => result.current.setChromeCollapsed(true))
    expect(result.current.chromeCollapsed).toBe(false)
  })
})
