import type { Settings } from '@/types'
import type { AgentToolManifest, AgentToolRequest } from '@/services/agent/agentToolTypes'
import { BUILTIN_SERVER_ID } from '@/services/builtinToolRegistry'
import { resolveSearchProvider } from '@/services/searchPolicy'

type SearchToolSettings = Pick<Settings, 'webSearchEnabled' | 'webSearchMode' | 'searchProvider' | 'customSearchEndpoint'>

export function shouldExposeLocalSearchTool(settings: SearchToolSettings): boolean {
  const searchProvider = resolveSearchProvider(settings)
  return Boolean(settings.webSearchEnabled) && searchProvider !== 'off' && searchProvider !== 'native'
}

export function filterLocalSearchToolManifests(
  manifests: AgentToolManifest[],
  settings: SearchToolSettings
): AgentToolManifest[] {
  if (shouldExposeLocalSearchTool(settings)) return manifests
  return manifests.filter((manifest) => !isBuiltinSearchToolManifest(manifest))
}

export function filterProviderNativeChatToolManifests(
  manifests: AgentToolManifest[],
  settings: SearchToolSettings
): AgentToolManifest[] {
  return filterLocalSearchToolManifests(manifests, settings)
    .filter(isBuiltinSearchToolManifest)
}

export function isBuiltinSearchToolRequest(request: AgentToolRequest | undefined): boolean {
  if (!request) return false
  if (request.toolId) return request.toolId === `builtin:${BUILTIN_SERVER_ID}:search_web`
  if (request.name !== 'search_web') return false
  if (request.source && request.source !== 'builtin') return false
  if (request.serverId && request.serverId !== BUILTIN_SERVER_ID) return false
  return true
}

function isBuiltinSearchToolManifest(manifest: AgentToolManifest): boolean {
  return manifest.source === 'builtin' && manifest.name === 'search_web'
}
