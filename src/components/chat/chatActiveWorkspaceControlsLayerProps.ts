import type { ChatActiveControlsLayerProps } from './ChatActiveControlsLayer'
import type { ChatActiveWorkspaceViewProps } from './chatActiveWorkspaceLayerPropTypes'

export function buildChatActiveControlsLayerProps({
  composerBottomInset,
  keyboardLift,
  messageSelectionController,
}: ChatActiveWorkspaceViewProps): ChatActiveControlsLayerProps {
  return {
    composerBottomInset,
    keyboardLift,
    messageSelectionController,
  }
}
