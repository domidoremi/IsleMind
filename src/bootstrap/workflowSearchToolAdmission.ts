import { createWorkflowSearchToolAdmissionPolicy } from '@/modules/tasks'
import { BUILT_IN_CAPABILITY_SERVER_ID, resolveSearchProvider } from '@/modules/integrations'
import type { Settings } from '@/types/settingsContracts'

type SearchToolSettings = Pick<
  Settings,
  | 'webSearchEnabled'
  | 'webSearchMode'
  | 'searchProvider'
  | 'customSearchEndpoint'
  | 'mcpEnabled'
  | 'agentWorkflowAllowReadOnlyTools'
  | 'agentWorkflowAllowReadWriteTools'
  | 'agentWorkflowAllowDestructiveTools'
>

export const workflowSearchToolAdmissionPolicy = createWorkflowSearchToolAdmissionPolicy<SearchToolSettings>({
  resolveSearchProvider,
  builtinSearchTool: {
    toolId: `builtin:${BUILT_IN_CAPABILITY_SERVER_ID}:search_web`,
    source: 'builtin',
    serverId: BUILT_IN_CAPABILITY_SERVER_ID,
    name: 'search_web',
  },
})

export const {
  shouldExposeLocalSearchTool,
  filterLocalSearchToolManifests,
  filterProviderNativeChatToolManifests,
  resolveModelOperationPermissionCeiling,
  isBuiltinSearchToolRequest,
} = workflowSearchToolAdmissionPolicy
