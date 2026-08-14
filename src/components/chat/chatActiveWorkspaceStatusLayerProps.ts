import type { ChatActiveStatusLayerProps } from './ChatActiveStatusLayer'
import type { ChatActiveWorkspaceViewProps } from './chatActiveWorkspaceLayerPropTypes'

export function buildChatActiveStatusLayerProps({
  conversation: activeConversation,
  providerHealth,
  latestCompression,
  compactViewport,
  visualTopInset,
  topChromeInset,
  goSettings,
  setShowOptions,
  setComposerPanel,
  markChromeActive,
  activeActions: {
    confirmActionFromMessage,
    repairAgentEvidenceFromMessage,
    safeStopMessage,
  },
  activeConversationTasks,
  chromeHeight,
  layoutState: {
    providerHealthTopOffset,
  },
  primaryConversationTask,
  primaryConversationTaskMessage,
}: ChatActiveWorkspaceViewProps): ChatActiveStatusLayerProps {
  return {
    conversation: activeConversation,
    providerHealth,
    latestCompression,
    compactViewport,
    visualTopInset,
    topChromeInset,
    goSettings,
    markChromeActive,
    setShowOptions,
    setComposerPanel,
    activeConversationTaskCount: activeConversationTasks.length,
    chromeHeight,
    primaryConversationTask,
    primaryConversationTaskMessage,
    providerHealthTopOffset,
    confirmActionFromMessage,
    repairAgentEvidenceFromMessage,
    safeStopMessage,
  }
}
