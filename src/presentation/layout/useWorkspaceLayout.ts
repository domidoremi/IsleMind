import { useWindowDimensions } from 'react-native'
import { resolveWorkspaceLayout } from './workspaceLayout'

export function useWorkspaceLayout() {
  return resolveWorkspaceLayout(useWindowDimensions())
}
