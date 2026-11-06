import { useState, type Dispatch, type SetStateAction } from 'react'

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
  const [providerHealthHeight, setProviderHealthHeight] = useState(0)
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
  const baseMessageListLayout = resolveProductMobileMessageListLayout(activeWindowWidth, {
    topChromeInset: Math.max(topChromeInset, visualTopInset),
    chromeHeight,
  })
  const healthClearance = providerHealth?.code && providerHealthHeight > 0
    ? providerHealthTopOffset + providerHealthHeight + FLOATING_NOTICE_TOP_GAP : 0
  const messageListLayout = {
    ...baseMessageListLayout,
    topInset: Math.max(baseMessageListLayout.topInset, healthClearance),
    conversationHeaderTopPadding: Math.max(baseMessageListLayout.conversationHeaderTopPadding, healthClearance),
    emptyConversationTopPadding: Math.max(baseMessageListLayout.emptyConversationTopPadding, healthClearance),
  }
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
    setProviderHealthHeight,
  }
}
