import type { ChatActiveControlsLayerProps } from './ChatActiveControlsLayer'
import type { ChatActiveWorkspaceViewProps } from './chatActiveWorkspaceLayerPropTypes'

export function buildChatActiveControlsLayerProps({
  composerBottomInset,
  controlOrbOpen,
  keyboardLift,
  messageSelectionController,
  setControlOrbOpen,
  layoutState: {
    controlOrbActions,
    showFloatingControlOrb,
  },
}: ChatActiveWorkspaceViewProps): ChatActiveControlsLayerProps {
  return {
    composerBottomInset,
    controlOrbActions,
    controlOrbOpen,
    keyboardLift,
    messageSelectionController,
    setControlOrbOpen,
    showFloatingControlOrb,
  }
}
