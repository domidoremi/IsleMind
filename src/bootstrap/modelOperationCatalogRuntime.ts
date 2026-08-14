import {
  createModelOperationCatalogSnapshot,
  formatModelOperationFallbackPrompt,
  type ConversationToolCatalogManifest,
  type ModelOperationCatalogCreationFailureCode,
  type ModelOperationCatalogSnapshot,
  type ModelOperationDescriptor,
  type ModelOperationExecutorKind,
} from '@/modules/integrations'
import { listConversationToolManifests } from '@/bootstrap/conversationToolCatalog'
import { filterProviderNativeChatToolManifests } from '@/bootstrap/workflowSearchToolAdmission'
import type { Settings } from '@/types/settingsContracts'

export interface ConversationModelOperationCatalog {
  readonly snapshot: ModelOperationCatalogSnapshot
  readonly manifests: readonly ConversationToolCatalogManifest[]
  readonly fallbackPrompt: string
}

export type ConversationModelOperationCatalogResult =
  | Readonly<{ ok: true; catalog: ConversationModelOperationCatalog }>
  | Readonly<{
    ok: false
    code: ModelOperationCatalogCreationFailureCode | 'fallback_prompt_unavailable'
    message: string
  }>

/**
 * Freezes exactly the runnable, policy-admitted operations for one model run.
 * Internal built-ins are independent of the external MCP feature toggle.
 */
export async function createConversationModelOperationCatalog(
  settings: Settings,
): Promise<ConversationModelOperationCatalogResult> {
  const discovered = await listConversationToolManifests({
    includeMcp: true,
    includeBuiltins: true,
    includeAppActions: false,
    includeInternalTools: true,
    includeAndroidTools: true,
  })
  const admitted = discovered.filter((manifest) =>
    filterProviderNativeChatToolManifests([manifest], settings).length === 1)
  const descriptors = admitted.map(toModelOperationDescriptor).filter(isDescriptor)
  const created = createModelOperationCatalogSnapshot(descriptors)
  if (!created.ok) {
    return Object.freeze({ ok: false, code: created.code, message: created.message })
  }
  const fallback = formatModelOperationFallbackPrompt(created.snapshot)
  if (!fallback.ok) {
    return Object.freeze({
      ok: false,
      code: 'fallback_prompt_unavailable',
      message: fallback.message,
    })
  }
  const manifests = Object.freeze(admitted
    .filter((manifest) => created.snapshot.operations.some((operation) => operation.id === manifest.id))
    .map((manifest) => Object.freeze({
      ...manifest,
      ...(manifest.inputSchema ? { inputSchema: structuredClone(manifest.inputSchema) } : {}),
      ...(manifest.metadata ? { metadata: structuredClone(manifest.metadata) } : {}),
    })))
  return Object.freeze({
    ok: true,
    catalog: Object.freeze({
      snapshot: created.snapshot,
      manifests,
      fallbackPrompt: fallback.prompt,
    }),
  })
}

function toModelOperationDescriptor(
  manifest: ConversationToolCatalogManifest,
): ModelOperationDescriptor | undefined {
  const executorKind = toExecutorKind(manifest.source)
  if (!executorKind) return undefined
  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description || manifest.name,
    inputSchema: (manifest.inputSchema ?? {
      type: 'object',
      properties: {},
      additionalProperties: true,
    }) as ModelOperationDescriptor['inputSchema'],
    permission: manifest.permission,
    requiresConfirmation: manifest.permission === 'destructive',
    capabilityScopes: [
      `source:${manifest.source}`,
      `permission:${manifest.permission}`,
      `operation:${manifest.id}`,
    ],
    executor: { kind: executorKind, id: manifest.id },
    availability: { status: 'available' },
  }
}

function toExecutorKind(
  source: ConversationToolCatalogManifest['source'],
): ModelOperationExecutorKind | undefined {
  if (source === 'mcp' || source === 'builtin' || source === 'android' ||
    source === 'app-action' || source === 'rag' || source === 'work-artifact') {
    return source
  }
  return undefined
}

function isDescriptor(value: ModelOperationDescriptor | undefined): value is ModelOperationDescriptor {
  return value !== undefined
}
