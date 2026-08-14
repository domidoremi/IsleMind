import { FLOATING_CONTROL_ORB_GAP, FloatingControlOrb, type FloatingControlOrbAction } from './FloatingControlOrb'
import { MessageMultiSelectBar } from './MessageMultiSelectBar'
import type { ChatActiveWorkspaceProps } from './chatActiveWorkspaceTypes'
import type { useChatMessageSelectionController } from './chatMessageSelectionState'

type MessageSelectionController = ReturnType<typeof useChatMessageSelectionController>

export interface ChatActiveControlsLayerProps extends Pick<
  ChatActiveWorkspaceProps,
  | 'composerBottomInset'
  | 'keyboardLift'
  | 'controlOrbOpen'
  | 'setControlOrbOpen'
> {
  controlOrbActions: FloatingControlOrbAction[]
  messageSelectionController: MessageSelectionController
  showFloatingControlOrb: boolean
}

export function ChatActiveControlsLayer({
  composerBottomInset,
  controlOrbActions,
  controlOrbOpen,
  keyboardLift,
  messageSelectionController,
  setControlOrbOpen,
  showFloatingControlOrb,
}: ChatActiveControlsLayerProps) {
  return (
    <>
      {messageSelectionController.multiSelectActive ? (
        <MessageMultiSelectBar
          count={messageSelectionController.selectedMessages.length}
          bottomOffset={composerBottomInset + keyboardLift + 8}
          onCancel={messageSelectionController.clearMessageSelection}
          onCopy={() => void messageSelectionController.copySelectedMessages()}
          onExport={() => void messageSelectionController.exportSelectedMessages()}
          onDelete={() => void messageSelectionController.deleteSelectedMessages()}
        />
      ) : null}

      {showFloatingControlOrb ? (
        <FloatingControlOrb
          actions={controlOrbActions}
          bottomOffset={composerBottomInset + FLOATING_CONTROL_ORB_GAP}
          open={controlOrbOpen}
          onOpenChange={setControlOrbOpen}
        />
      ) : null}
    </>
  )
}
