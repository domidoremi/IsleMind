import type { Result } from '@/core'

export const TAVERN_WORKSPACE_SCOPE_RECORD_SCHEMA = 'islemind.tavern-workspace-scope.v1'
export const TAVERN_WORKSPACE_REPOSITORY_SNAPSHOT_SCHEMA = 'islemind.tavern-workspace-repository.v1'

export type TavernWorkspaceRepositoryErrorCode =
  | 'cancelled'
  | 'invalid_scope'
  | 'validation_failed'
  | 'duplicate'
  | 'not_found'
  | 'revision_conflict'
  | 'corrupt_record'
  | 'persistence_failed'

export type TavernWorkspaceRepositoryResult<Value> = Result<Value, TavernWorkspaceRepositoryErrorCode>

export interface TavernWorkspaceScopeRecord<Snapshot> {
  schema: typeof TAVERN_WORKSPACE_SCOPE_RECORD_SCHEMA
  scopeId: string
  revision: number
  snapshot: Snapshot
  updatedAt: number
}

/**
 * A coherent point-in-time view of Tavern scopes and their non-self active
 * links. Missing links deliberately mean that the conversation uses its own
 * scope, matching the existing Tavern fallback behavior.
 */
export interface TavernWorkspaceRepositorySnapshot<Snapshot> {
  schema: typeof TAVERN_WORKSPACE_REPOSITORY_SNAPSHOT_SCHEMA
  revision: number
  scopes: readonly TavernWorkspaceScopeRecord<Snapshot>[]
  activeScopeLinks: Readonly<Record<string, string>>
  updatedAt: number
}

export interface TavernWorkspaceSnapshotCodec<Snapshot> {
  /** Schema stored beside the payload so incompatible records fail closed. */
  readonly schema: string
  /** Return undefined rather than repairing an invalid or incompatible value. */
  parse(value: unknown): Snapshot | undefined
}

export interface TavernWorkspaceRepositoryOptions {
  signal?: AbortSignal
}

export interface CreateTavernWorkspaceScopeInput<Snapshot> {
  scopeId: string
  snapshot: Snapshot
  updatedAt?: number
}

export interface SaveTavernWorkspaceScopeInput<Snapshot> extends CreateTavernWorkspaceScopeInput<Snapshot> {
  expectedRevision: number
}

export interface DeleteTavernWorkspaceScopeInput {
  scopeId: string
  expectedRevision: number
  updatedAt?: number
}

export interface DuplicateTavernWorkspaceScopeInput {
  sourceScopeId: string
  targetScopeId: string
  expectedSourceRevision: number
  updatedAt?: number
}

export interface SetTavernActiveScopeInput {
  conversationScopeId: string
  activeScopeId?: string | null
  expectedRepositoryRevision: number
  updatedAt?: number
}

export interface TavernWorkspaceReplacementScope<Snapshot> {
  scopeId: string
  snapshot: Snapshot
  updatedAt?: number
}

/**
 * Complete portable replacement unit. Scopes and links are validated before
 * the transaction starts, then replaced together under repository-level CAS.
 */
export interface ReplaceTavernWorkspaceRepositoryInput<Snapshot> {
  scopes: readonly TavernWorkspaceReplacementScope<Snapshot>[]
  activeScopeLinks: Readonly<Record<string, string>>
  expectedRepositoryRevision: number
  updatedAt?: number
}

export interface TavernWorkspaceRepository<Snapshot> {
  load(
    options?: TavernWorkspaceRepositoryOptions,
  ): Promise<TavernWorkspaceRepositoryResult<TavernWorkspaceRepositorySnapshot<Snapshot>>>
  getScope(
    scopeId: string,
    options?: TavernWorkspaceRepositoryOptions,
  ): Promise<TavernWorkspaceRepositoryResult<TavernWorkspaceScopeRecord<Snapshot>>>
  createScope(
    input: CreateTavernWorkspaceScopeInput<Snapshot>,
    options?: TavernWorkspaceRepositoryOptions,
  ): Promise<TavernWorkspaceRepositoryResult<TavernWorkspaceScopeRecord<Snapshot>>>
  saveScope(
    input: SaveTavernWorkspaceScopeInput<Snapshot>,
    options?: TavernWorkspaceRepositoryOptions,
  ): Promise<TavernWorkspaceRepositoryResult<TavernWorkspaceScopeRecord<Snapshot>>>
  deleteScope(
    input: DeleteTavernWorkspaceScopeInput,
    options?: TavernWorkspaceRepositoryOptions,
  ): Promise<TavernWorkspaceRepositoryResult<{ repositoryRevision: number }>>
  duplicateScope(
    input: DuplicateTavernWorkspaceScopeInput,
    options?: TavernWorkspaceRepositoryOptions,
  ): Promise<TavernWorkspaceRepositoryResult<TavernWorkspaceScopeRecord<Snapshot>>>
  setActiveScope(
    input: SetTavernActiveScopeInput,
    options?: TavernWorkspaceRepositoryOptions,
  ): Promise<TavernWorkspaceRepositoryResult<{ activeScopeId: string; repositoryRevision: number }>>
  replaceAll(
    input: ReplaceTavernWorkspaceRepositoryInput<Snapshot>,
    options?: TavernWorkspaceRepositoryOptions,
  ): Promise<TavernWorkspaceRepositoryResult<TavernWorkspaceRepositorySnapshot<Snapshot>>>
}

/** Canonicalizes legacy-compatible scope identifiers without accepting empties. */
export function normalizeTavernWorkspaceScopeId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.replace(/\s+/g, ' ').trim().slice(0, 160)
  if (!trimmed) return undefined
  const normalized = trimmed.replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return normalized || undefined
}
