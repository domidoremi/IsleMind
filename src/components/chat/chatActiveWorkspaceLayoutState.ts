import { type Dispatch, type SetStateAction } from 'react'
import type { TFunction } from 'i18next'

import { resolveProductMobileMessageListLayout } from '@/presentation/layout/productMobileLayout'

import { FLOATING_CHROME_SAFE_AREA_GAP } from './FloatingChrome'
import type { ComposerPanel } from './FloatingComposer'
import { buildActiveControlOrbActions } from './chatControlOrbActions'
import { FLOATING_NOTICE_TOP_GAP, resolveFloatingNoticeTopOffset } from './chatNoticeLayout'
import { CHAT_USES_FLOATING_CONTROL_ORB } from './chatWorkspaceConstants'
import type { ConversationHealth } from './conversationHealth'

interface ChatActiveWorkspaceLayoutStateOptions {
  activeWindowWidth: number
  chromeHeight: number
  composerPanel: ComposerPanel
  controlOrbOpen: boolean
  goHistory: () => void
  goMemoryReview: () => void
  goProviders: () => void
  goSettings: () => void
  markChromeActive: () => void
  openWorkspaceReview: () => void
  providerHealth: ConversationHealth | null
  setChromeCollapsed: Dispatch<SetStateAction<boolean>>
  setChromeHeight: Dispatch<SetStateAction<number>>
  setComposerPanel: Dispatch<SetStateAction<ComposerPanel>>
  setControlOrbOpen: Dispatch<SetStateAction<boolean>>
  setShowOptions: Dispatch<SetStateAction<boolean>>
  showOptions: boolean
  t: TFunction
  topChromeInset: number
  visualTopInset: number
}

export function useChatActiveWorkspaceLayoutState({
  activeWindowWidth,
  chromeHeight,
  composerPanel,
  controlOrbOpen,
  goHistory,
  goMemoryReview,
  goProviders,
  goSettings,
  markChromeActive,
  openWorkspaceReview,
  providerHealth,
  setChromeCollapsed,
  setChromeHeight,
  setComposerPanel,
  setControlOrbOpen,
  setShowOptions,
  showOptions,
  t,
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
  const showFloatingControlOrb = CHAT_USES_FLOATING_CONTROL_ORB && !composerPanel && !providerHealth?.code
  const controlOrbActions = buildActiveControlOrbActions({
    goHistory,
    goMemoryReview,
    goProviders,
    goSettings,
    markChromeActive,
    openWorkspaceReview,
    setComposerPanel,
    setControlOrbOpen,
    setShowOptions,
    t,
  })

  function collapseChrome() {
    if (chromeCollapseLocked || providerHealth?.code) return
    setShowOptions(false)
    setChromeCollapsed(true)
  }

  function closeOptionsFromBackground() {
    if (showOptions) setShowOptions(false)
    if (controlOrbOpen) setControlOrbOpen(false)
    setComposerPanel((current) => current ? null : current)
  }

  return {
    collapseChrome,
    closeOptionsFromBackground,
    controlOrbActions,
    conversationHeaderTopPadding: messageListLayout.conversationHeaderTopPadding,
    emptyConversationTopPadding: messageListLayout.emptyConversationTopPadding,
    messageListLayout,
    messageListTopInset: messageListLayout.topInset,
    providerHealthTopOffset,
    showFloatingControlOrb,
  }
}
