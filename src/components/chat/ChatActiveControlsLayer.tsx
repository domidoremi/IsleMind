import { MessageMultiSelectBar } from './MessageMultiSelectBar'
import type { ChatActiveWorkspaceProps } from './chatActiveWorkspaceTypes'
import type { useChatMessageSelectionController } from './chatMessageSelectionState'

type MessageSelectionController = ReturnType<typeof useChatMessageSelectionController>

export interface ChatActiveControlsLayerProps extends Pick<
  ChatActiveWorkspaceProps,
  | 'composerBottomInset'
  | 'keyboardLift'
> {
  messageSelectionController: MessageSelectionController
}

export function ChatActiveControlsLayer({
  composerBottomInset,
  keyboardLift,
  messageSelectionController,
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
    </>
  )
}
