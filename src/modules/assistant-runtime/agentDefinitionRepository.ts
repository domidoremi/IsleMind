import type { AgentDefinition } from './agentDefinition'

export class AgentDefinitionConflictError extends Error {
  constructor() { super('Agent definition changed or already exists'); this.name = 'AgentDefinitionConflictError' }
}

export interface AgentDefinitionRepository {
  list(options?: { afterId?: string; limit?: number }): Promise<AgentDefinition[]>
  get(id: string): Promise<AgentDefinition | undefined>
  /** No expected revision means insert only. Updates require the current revision and increment it once. */
  save(definition: AgentDefinition, expectedRevision?: number, signal?: AbortSignal): Promise<AgentDefinition>
  /** Cancellation is checked before the delete starts; a committed deletion stays successful. */
  remove(id: string, expectedRevision: number, signal?: AbortSignal): Promise<void>
  /** Used only by the application's explicitly confirmed full-data reset. */
  clear(): Promise<void>
}

/** Portable recovery owns these compare-and-replace operations, not the editor. */
export interface AgentDefinitionSnapshotRepository {
  loadSnapshot(): Promise<AgentDefinition[]>
  replaceSnapshot(definitions: readonly AgentDefinition[], expected: readonly (readonly AgentDefinition[])[], signal?: AbortSignal): Promise<void>
}
