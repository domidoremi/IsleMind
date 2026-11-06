import { act, renderHook } from '@testing-library/react-native'
import { useChatActiveWorkspaceLayoutState } from './chatActiveWorkspaceLayoutState'
import type { ConversationHealth } from './conversationHealth'

jest.mock('./FloatingChrome', () => ({ FLOATING_CHROME_SAFE_AREA_GAP: 0 }))

const input = { activeWindowWidth: 320, chromeHeight: 64, composerPanel: null, providerHealth: null as ConversationHealth | null,
  setChromeCollapsed: jest.fn(), setChromeHeight: jest.fn(), setComposerPanel: jest.fn(), setShowOptions: jest.fn(),
  showOptions: false, topChromeInset: 0, visualTopInset: 0 }

it('keeps the first history message below the measured connection warning at narrow and wide widths', async () => {
  const health = { code: 'provider_missing' } as ConversationHealth
  const { result, rerender } = await renderHook((props: Parameters<typeof useChatActiveWorkspaceLayoutState>[0]) => useChatActiveWorkspaceLayoutState(props), { initialProps: { ...input, providerHealth: health } })
  await act(() => result.current.setProviderHealthHeight(84))
  expect(result.current.conversationHeaderTopPadding).toBeGreaterThanOrEqual(result.current.providerHealthTopOffset + 84 + 8)
  expect(result.current.messageListTopInset).toBe(result.current.conversationHeaderTopPadding)
  await rerender({ ...input, providerHealth: health, activeWindowWidth: 960, chromeHeight: 100 })
  await act(() => result.current.setProviderHealthHeight(60))
  expect(result.current.conversationHeaderTopPadding).toBeGreaterThanOrEqual(result.current.providerHealthTopOffset + 60 + 8)
})

it('restores the original spacing when a connection warning is removed', async () => {
  const { result, rerender } = await renderHook((props: Parameters<typeof useChatActiveWorkspaceLayoutState>[0]) => useChatActiveWorkspaceLayoutState(props), { initialProps: input })
  const initial = result.current.conversationHeaderTopPadding
  await rerender({ ...input, providerHealth: { code: 'provider_missing' } as ConversationHealth })
  await act(() => result.current.setProviderHealthHeight(84))
  expect(result.current.conversationHeaderTopPadding).toBeGreaterThan(initial)
  await rerender(input)
  expect(result.current.conversationHeaderTopPadding).toBe(initial)
})
