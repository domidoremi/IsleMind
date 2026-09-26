import type { AgentDefinition, FrozenAgentDefinition } from '@/modules/assistant-runtime'
import { stableIdentityHash } from '@/modules/integrations'
import type { AIProvider } from '@/types/providerContracts'
import { buildProviderModelCapabilityMatrix, providerModelCapabilityCanBeSent } from './providerCapabilityMatrix'

/** Reuses host capability evidence. A definition's claims or json_mode are not proof of reliable actions. */
export function resolveAgentModelBinding(provider: AIProvider, modelId: string): AgentDefinition['modelBinding'] {
  const matrix = buildProviderModelCapabilityMatrix(provider, modelId)
  const tools = providerModelCapabilityCanBeSent(provider, modelId, 'tools')
  return { providerId: provider.id, modelId, actionCapability: tools ? 'native_tool_calling' : 'text_only',
    capabilityRevision: `agent-capabilities-v1:${stableIdentityHash({ matrix, tools,
      type: provider.type, wireProtocol: provider.wireProtocol ?? '', endpoint: provider.baseUrl ?? '' })}` }
}

export function assertAgentModelBinding(provider: AIProvider, definition: FrozenAgentDefinition): void {
  if (provider.id !== definition.modelBinding.providerId) throw new Error('Agent provider binding changed')
  if (definition.modelBinding.actionCapability === 'text_only') return
  const current = resolveAgentModelBinding(provider, definition.modelBinding.modelId)
  // A structured-output declaration is deliberately insufficient. Such routes
  // remain chat-only until the host has an independently validated action profile.
  if (current.actionCapability !== definition.modelBinding.actionCapability
    || current.capabilityRevision !== definition.modelBinding.capabilityRevision) {
    throw new Error('Agent action capability evidence changed or is unavailable; rebind in settings')
  }
}
