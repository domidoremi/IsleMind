import { type Dispatch, type SetStateAction } from 'react'

import { resolveProductMobileMessageListLayout } from '@/presentation/layout/productMobileLayout'

import { FLOATING_CHROME_SAFE_AREA_GAP } from './FloatingChrome'
import type { ComposerPanel } from './FloatingComposer'
import { FLOATING_NOTICE_TOP_GAP, resolveFloatingNoticeTopOffset } from './chatNoticeLayout'
import type { ConversationHealth } from './conversationHealth'

interface ChatActiveWorkspaceLayoutStateOptions {
  activeWindowWidth: number
  chromeHeight: number
  composerPanel: ComposerPanel
  providerHealth: ConversationHealth | null
  setChromeCollapsed: Dispatch<SetStateAction<boolean>>
  setChromeHeight: Dispatch<SetStateAction<number>>
  setComposerPanel: Dispatch<SetStateAction<ComposerPanel>>
  setShowOptions: Dispatch<SetStateAction<boolean>>
  showOptions: boolean
  topChromeInset: number
  visualTopInset: number
}

export function useChatActiveWorkspaceLayoutState({
  activeWindowWidth,
  chromeHeight,
  composerPanel,
  providerHealth,
  setChromeCollapsed,
  setChromeHeight,
  setComposerPanel,
  setShowOptions,
  showOptions,
  topChromeInset,
  visualTopInset,
}: ChatActiveWorkspaceLayoutStateOptions) {
  const providerHealthTopOffset = Math.max(
    resolveFloatingNoticeTopOffset({
      visualTopInset,
      topChromeInset,
      chromeSafeAreaGap: FLOATING_CHROME_SAFE_AREA_GAP,
      hasLocalChrome: true,
    }),
    chromeHeight + FLOATING_NOTICE_TOP_GAP,
  )
  const chromeCollapseLocked = showOptions || !!providerHealth?.code
  const messageListLayout = resolveProductMobileMessageListLayout(activeWindowWidth, {
    topChromeInset: Math.max(topChromeInset, visualTopInset),
    chromeHeight,
  })
  function collapseChrome() {
    if (chromeCollapseLocked || providerHealth?.code) return
    setShowOptions(false)
    setChromeCollapsed(true)
  }

  function closeOptionsFromBackground() {
    if (showOptions) setShowOptions(false)
    setComposerPanel((current) => current ? null : current)
  }

  return {
    collapseChrome,
    closeOptionsFromBackground,
    conversationHeaderTopPadding: messageListLayout.conversationHeaderTopPadding,
    emptyConversationTopPadding: messageListLayout.emptyConversationTopPadding,
    messageListLayout,
    messageListTopInset: messageListLayout.topInset,
    providerHealthTopOffset,
  }
}
