import type { ChatOptionsPanel } from './ChatOptionsPanel'
import { FloatingChrome } from './FloatingChrome'
import type { ChatActiveWorkspaceProps } from './chatActiveWorkspaceTypes'

type ChatActiveChromeLayerBaseProps = Pick<
  ChatActiveWorkspaceProps,
  | 'colors'
  | 'visualTopInset'
  | 'insets'
  | 'chromeCollapsed'
  | 'isStreaming'
  | 'showOptions'
  | 'mobileViewport'
  | 'compactViewport'
  | 'viewportHeight'
  | 'keyboardLift'
  | 'conversation'
  | 'provider'
  | 'providerHealth'
  | 'metrics'
  | 'showBack'
  | 'shellNavigation'
  | 'topChromeInset'
  | 'restoreChrome'
  | 'markChromeActive'
  | 'goHistory'
  | 'goSettings'
  | 'setShowOptions'
  | 'setComposerPanel'
  | 'switchableProviders'
  | 'motion'
  | 'modelAccessSettings'
  | 'settingsTransitionActive'
> & {
  collapseChrome: () => void
  onLayoutHeight: (height: number) => void
}

export interface ChatActiveChromeLayerProps extends ChatActiveChromeLayerBaseProps {
  onCopyLink: () => void
  onNewConversation: () => void
  onDraftChange: NonNullable<Parameters<typeof ChatOptionsPanel>[0]['onDraftChange']>
  onSwitchModel: Parameters<typeof ChatOptionsPanel>[0]['onSwitchModel']
}

export function ChatActiveChromeLayer({
  colors,
  visualTopInset,
  insets,
  chromeCollapsed,
  isStreaming,
  showOptions,
  mobileViewport,
  compactViewport,
  viewportHeight,
  keyboardLift,
  conversation,
  provider,
  providerHealth,
  metrics,
  showBack,
  shellNavigation,
  topChromeInset,
  restoreChrome,
  collapseChrome,
  markChromeActive,
  goHistory,
  goSettings,
  setShowOptions,
  setComposerPanel,
  switchableProviders,
  onLayoutHeight,
  motion,
  modelAccessSettings,
  settingsTransitionActive,
  onCopyLink,
  onNewConversation,
  onDraftChange,
  onSwitchModel,
}: ChatActiveChromeLayerProps) {
  const optionsPanelPlacement = mobileViewport || viewportHeight < 720 ? 'sheet' : 'popover'
  const optionsPanelKeyboardInset = optionsPanelPlacement === 'sheet' ? keyboardLift : 0
  const optionsPanelAvailableHeight = Math.max(
    260,
    viewportHeight - visualTopInset - Math.max(insets.bottom, 10) - optionsPanelKeyboardInset - 88,
  )
  const optionsPanelPreferredHeight = Math.min(viewportHeight * 0.7, compactViewport ? 460 : 620)
  const optionsPanelHeight = Math.max(260, Math.min(optionsPanelPreferredHeight, optionsPanelAvailableHeight))

  return (
    <FloatingChrome
      colors={colors}
      insets={insets}
      visualTopInset={visualTopInset}
      collapsed={chromeCollapsed}
      streaming={isStreaming}
      showOptions={showOptions}
      mobileViewport={mobileViewport}
      conversation={conversation}
      provider={provider}
      providerHealth={providerHealth}
      metrics={metrics}
      onBack={() => {
        if (showOptions) {
          setShowOptions(false)
          return
        }
        goHistory()
      }}
      showBack={showBack}
      shellNavigation={shellNavigation}
      topChromeInset={topChromeInset}
      onRestore={restoreChrome}
      onCollapse={collapseChrome}
      onSettings={() => {
        markChromeActive()
        goSettings()
      }}
      onNewConversation={onNewConversation}
      onOpenModelPicker={() => {
        markChromeActive()
        setComposerPanel(null)
        setShowOptions(true)
      }}
      onCloseOptions={() => setShowOptions(false)}
      onCopyLink={onCopyLink}
      onDraftChange={onDraftChange}
      onSwitchModel={onSwitchModel}
      switchableProviders={switchableProviders}
      optionsPanelHeight={optionsPanelHeight}
      optionsPanelPlacement={optionsPanelPlacement}
      optionsPanelKeyboardInset={optionsPanelKeyboardInset}
      onLayoutHeight={onLayoutHeight}
      motion={motion}
      modelAccessSettings={modelAccessSettings}
      settingsTransitionActive={settingsTransitionActive}
    />
  )
}
