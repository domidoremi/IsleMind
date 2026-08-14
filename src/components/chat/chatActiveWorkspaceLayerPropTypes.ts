import type { ChatActiveChromeLayerProps } from './ChatActiveChromeLayer'
import type { ChatActiveComposerDockProps } from './ChatActiveComposerDock'
import type { ChatActiveControlsLayerProps } from './ChatActiveControlsLayer'
import type { ChatActiveMessageListProps } from './ChatActiveMessageList'
import type { ChatActiveStatusLayerProps } from './ChatActiveStatusLayer'
import type { useChatActiveWorkspaceControllers } from './chatActiveWorkspaceControllers'
import type { ChatActiveWorkspaceProps } from './chatActiveWorkspaceTypes'

export type ChatActiveWorkspaceViewProps = ChatActiveWorkspaceProps & ReturnType<typeof useChatActiveWorkspaceControllers>

export interface ChatActiveWorkspaceLayerProps {
  chromeLayerProps: ChatActiveChromeLayerProps
  composerDockProps: ChatActiveComposerDockProps
  controlsLayerProps: ChatActiveControlsLayerProps
  messageListProps: ChatActiveMessageListProps
  statusLayerProps: ChatActiveStatusLayerProps
}
