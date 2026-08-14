import { ChatActiveWorkspaceView } from './ChatActiveWorkspaceView'
import { useChatActiveWorkspaceControllers } from './chatActiveWorkspaceControllers'
import type { ChatActiveWorkspaceProps } from './chatActiveWorkspaceTypes'

export function ChatActiveWorkspace(props: ChatActiveWorkspaceProps) {
  const controllers = useChatActiveWorkspaceControllers(props)

  return <ChatActiveWorkspaceView {...props} {...controllers} />
}
