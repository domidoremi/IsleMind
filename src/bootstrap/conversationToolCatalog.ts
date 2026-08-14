import {
  BUILTIN_SERVER_ID,
  builtinMcpServer,
  listBuiltinToolDescriptors,
  listMcpServers,
} from '@/bootstrap/mcpCatalog'
import { KNOWLEDGE_RAG_CONTEXT_PACK_MANIFEST } from '@/modules/knowledge'
import {
  listConversationToolCatalog,
  listAppActionToolDescriptors,
  listStaticConversationToolCatalog,
  resolveUniqueToolManifest,
  WORK_ARTIFACT_TOOL_MANIFEST,
  type ConversationToolCatalogManifest as ConversationToolManifest,
  type ConversationToolCatalogSourcePorts,
} from '@/modules/integrations'
import type { WorkflowStepToolRequest as ConversationToolRequest } from '@/modules/tasks'
import { listAndroidDeviceToolManifests } from '@/services/androidDeviceTools'

export interface ListConversationToolManifestOptions {
  includeMcp?: boolean
  includeBuiltins?: boolean
  includeAppActions?: boolean
  includeInternalTools?: boolean
  includeAndroidTools?: boolean
}

const INTERNAL_TOOLS: ConversationToolManifest[] = [
  KNOWLEDGE_RAG_CONTEXT_PACK_MANIFEST,
  WORK_ARTIFACT_TOOL_MANIFEST,
]

const CONVERSATION_TOOL_CATALOG_SOURCES: ConversationToolCatalogSourcePorts = {
  builtinServerId: BUILTIN_SERVER_ID,
  listMcpServers,
  getBuiltinServer: builtinMcpServer,
  listBuiltinTools: listBuiltinToolDescriptors,
  listAppActionTools: listAppActionToolDescriptors,
  listAndroidTools: listAndroidDeviceToolManifests,
}

export async function listConversationToolManifests(
  options: ListConversationToolManifestOptions = {},
): Promise<ConversationToolManifest[]> {
  return listConversationToolCatalog(CONVERSATION_TOOL_CATALOG_SOURCES, {
    ...options,
    internalTools: INTERNAL_TOOLS,
  })
}

export function listStaticConversationToolManifests(): ConversationToolManifest[] {
  return listStaticConversationToolCatalog(CONVERSATION_TOOL_CATALOG_SOURCES, INTERNAL_TOOLS)
}

export function resolveConversationTool(
  request: ConversationToolRequest,
  manifests: ConversationToolManifest[],
): ConversationToolManifest | null {
  return resolveUniqueToolManifest(request, manifests)
}
