import {
  createAssistantProviderToolTurnRuntime,
  type ProviderToolRuntimeContext,
} from '@/modules/assistant-runtime'
import type { ConversationToolCatalogManifest } from '@/modules/integrations'
import { stableIdentityHash } from '@/modules/integrations'
import type {
  ProviderNativeToolDeclarationResult,
  ProviderNativeToolNameMapEntry,
} from '@/modules/providers'
import { listConversationToolManifests } from '@/bootstrap/conversationToolCatalog'
import { filterProviderNativeChatToolManifests } from '@/bootstrap/workflowSearchToolAdmission'
import {
  buildProviderNativeToolDeclarations,
  resolveProviderNativeToolDeclarationTarget,
} from '@/bootstrap/providerNativeToolDeclarations'
import { resolveWorkflowRunLimitsFromSettings } from '@/modules/tasks'
import type { AIProvider } from '@/types/providerContracts'
import type { Settings } from '@/types/settingsContracts'

type ProviderToolNameMapEntry = ProviderNativeToolNameMapEntry<ConversationToolCatalogManifest['source']>
type ProviderToolDeclaration = ProviderNativeToolDeclarationResult<ConversationToolCatalogManifest['source']>

export type ConversationProviderToolContext = ProviderToolRuntimeContext<
  ConversationToolCatalogManifest,
  ProviderToolNameMapEntry,
  ProviderToolDeclaration
>

/**
 * Temporary Rich-Chat declaration admission. Execution and continuation are
 * owned by the canonical Assistant Runtime model-operation loop.
 */
export function createConversationProviderToolTurnRuntime() {
  const runtime = createAssistantProviderToolTurnRuntime<
    AIProvider,
    ConversationToolCatalogManifest,
    ProviderToolNameMapEntry,
    ProviderToolDeclaration
  >({
    resolveDeclarationTarget(provider, options) {
      return resolveProviderNativeToolDeclarationTarget(provider.type, {
        preferredEndpoint: options.preferredEndpoint === 'responses' ? 'responses' : 'chat',
        assumeOpenAICompatibleTools: options.assumeOpenAICompatibleTools,
        wireProtocol: provider.wireProtocol,
      })
    },
    resolveLimits(settings) {
      return resolveWorkflowRunLimitsFromSettings(settings as Settings)
    },
    listManifests: () => listConversationToolManifests(),
    filterManifests(manifests, settings) {
      return filterProviderNativeChatToolManifests([...manifests], settings as Settings)
    },
    resolveCatalogRevision(manifests) {
      return `islemind.model.operation.catalog.v1:${stableIdentityHash(manifests)}`
    },
    buildDeclarations(declarationInput) {
      return buildProviderNativeToolDeclarations({
        manifests: [...declarationInput.manifests],
        target: declarationInput.target as ProviderToolDeclaration['target'],
        permissionCeiling: declarationInput.permissionCeiling,
        maxTools: declarationInput.maxTools,
      })
    },
  })
  return { admit: runtime.admit }
}
