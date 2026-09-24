import type { AgentDefinition } from './agentDefinition'

export class AgentDefinitionConflictError extends Error {
  constructor() { super('Agent definition changed or already exists'); this.name = 'AgentDefinitionConflictError' }
}

export interface AgentDefinitionRepository {
  list(options?: { afterId?: string; limit?: number }): Promise<AgentDefinition[]>
  get(id: string): Promise<AgentDefinition | undefined>
  /** No expected revision means insert only. Updates require the current revision and increment it once. */
  save(definition: AgentDefinition, expectedRevision?: number): Promise<AgentDefinition>
  remove(id: string, expectedRevision: number): Promise<void>
  /** Used only by the application's explicitly confirmed full-data reset. */
  clear(): Promise<void>
}

/** Portable recovery owns these compare-and-replace operations, not the editor. */
export interface AgentDefinitionSnapshotRepository {
  loadSnapshot(): Promise<AgentDefinition[]>
  replaceSnapshot(definitions: readonly AgentDefinition[], expected: readonly (readonly AgentDefinition[])[], signal?: AbortSignal): Promise<void>
}
