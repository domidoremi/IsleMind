import { createAgentDefinition, decodeAgentDefinition, encodeAgentDefinition, parseAgentDefinition, type AgentDefinition } from '../agentDefinition'
import type { AgentDefinitionRepository } from '../agentDefinitionRepository'

export interface AgentDefinitionFilePort {
  selectJsonFile(options?: { signal?: AbortSignal }): Promise<{ ok: true; json: string } | { ok: false; reason: string }>
  exportJsonFile(json: string): Promise<{ uri: string }>
}

export interface AgentDefinitionManagement extends AgentDefinitionRepository {
  newDraft(input: { name: string; providerId: string; modelId: string }): AgentDefinition
  /** Preview only, with a fresh local identity. Nothing is saved or enabled by importing. */
  importDraft(signal?: AbortSignal): Promise<AgentDefinition | undefined>
  exportSaved(id: string): Promise<void>
}

export function createAgentDefinitionManagement({ repository, files, newId }: {
  repository: AgentDefinitionRepository; files: AgentDefinitionFilePort; newId(): string
}): AgentDefinitionManagement {
  return {
    ...repository,
    newDraft: (input) => createAgentDefinition({ ...input, id: newId() }),
    async importDraft(signal) {
      const result = await files.selectJsonFile({ signal })
      if (signal?.aborted) return undefined
      if (!result.ok) {
        if (result.reason === 'selection_cancelled' || result.reason === 'operation_cancelled') return undefined
        throw new Error('Agent definition file could not be read')
      }
      const imported = decodeAgentDefinition(result.json)
      return parseAgentDefinition({ ...imported, id: newId(), revision: 1 })
    },
    async exportSaved(id) {
      const definition = await repository.get(id)
      if (!definition) throw new Error('Agent definition not found')
      await files.exportJsonFile(encodeAgentDefinition(definition))
    },
  }
}
