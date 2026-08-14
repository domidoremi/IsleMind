import { buildChatActiveChromeLayerProps } from './chatActiveWorkspaceChromeLayerProps'
import { buildChatActiveComposerDockProps } from './chatActiveWorkspaceComposerDockProps'
import { buildChatActiveControlsLayerProps } from './chatActiveWorkspaceControlsLayerProps'
import { buildChatActiveMessageListProps } from './chatActiveWorkspaceMessageListProps'
import { buildChatActiveStatusLayerProps } from './chatActiveWorkspaceStatusLayerProps'
import type {
  ChatActiveWorkspaceLayerProps,
  ChatActiveWorkspaceViewProps,
} from './chatActiveWorkspaceLayerPropTypes'

export function buildChatActiveWorkspaceLayerProps(props: ChatActiveWorkspaceViewProps): ChatActiveWorkspaceLayerProps {
  return {
    chromeLayerProps: buildChatActiveChromeLayerProps(props),
    controlsLayerProps: buildChatActiveControlsLayerProps(props),
    composerDockProps: buildChatActiveComposerDockProps(props),
    messageListProps: buildChatActiveMessageListProps(props),
    statusLayerProps: buildChatActiveStatusLayerProps(props),
  }
}
