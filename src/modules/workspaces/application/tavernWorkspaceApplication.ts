import type {
  TavernActiveScopeLinksExportOptions,
  TavernExportAudit,
  TavernExportOptions,
  TavernScopedExportEntry,
  TavernScopedExportOptions,
  TavernScopeDuplicateOptions,
  TavernScopeDuplicateResult,
  TavernSnapshot,
} from '../domain/tavernContracts'
import {
  buildTavernExportAudit,
  buildTavernScopeDuplicateAudit,
  filterTavernSnapshotForExport,
} from '../domain/tavernExportPolicy'
import {
  createEmptyTavernSnapshot,
  normalizeTavernSnapshot,
} from '../domain/tavernSnapshotPolicy'
import type { TavernWorkspacePersistence } from './tavernWorkspacePersistence'
import {
  normalizeTavernWorkspaceScopeId,
  type TavernWorkspaceReplacementScope,
  type TavernWorkspaceRepositoryOptions,
  type TavernWorkspaceRepositoryResult,
} from './tavernWorkspaceRepository'

const DEFAULT_TAVERN_SCOPE_ID = 'default'

type TavernWorkspaceApplicationPersistence = Pick<
  TavernWorkspacePersistence<TavernSnapshot>,
  | 'loadOrEmpty'
  | 'upsertScope'
  | 'clearScope'
  | 'clearAll'
  | 'listScopes'
  | 'resolveActiveScope'
  | 'setActiveScope'
  | 'loadAll'
  | 'replaceImport'
>

export interface TavernWorkspaceApplicationDependencies {
  persistence: TavernWorkspaceApplicationPersistence
  now?: () => number
  generateDuplicateScopeId?: (sourceScopeId: string, now: number) => string
}

export interface TavernWorkspaceApplication {
  loadTavernSnapshot(
    scopeId?: string,
    options?: TavernWorkspaceRepositoryOptions,
  ): Promise<TavernSnapshot>
  saveTavernSnapshot(
    snapshot: Partial<TavernSnapshot>,
    scopeId?: string,
    options?: TavernWorkspaceRepositoryOptions,
  ): Promise<TavernSnapshot>
  clearTavernSnapshot(scopeId?: string): Promise<void>
  exportTavernSnapshot(options?: TavernExportOptions, scopeId?: string): Promise<TavernSnapshot>
  listTavernScopeIds(): Promise<string[]>
  resolveTavernActiveScopeId(
    conversationScopeId?: string,
    options?: TavernWorkspaceRepositoryOptions,
  ): Promise<string | undefined>
  setTavernActiveScopeId(
    conversationScopeId: string | undefined,
    activeScopeId?: string | null,
  ): Promise<string | undefined>
  exportTavernActiveScopeLinks(options?: TavernActiveScopeLinksExportOptions): Promise<Record<string, string>>
  duplicateTavernScope(
    sourceScopeId?: string,
    targetScopeId?: string,
    options?: TavernScopeDuplicateOptions,
  ): Promise<TavernScopeDuplicateResult>
  exportTavernSnapshots(options?: TavernScopedExportOptions): Promise<TavernScopedExportEntry[]>
  importTavernWorkspaceState(
    entries: readonly { scopeId?: string; snapshot: Partial<TavernSnapshot> | undefined }[],
    activeScopeLinks: Record<string, string> | undefined,
    options?: TavernActiveScopeLinksExportOptions,
  ): Promise<Record<string, TavernSnapshot>>
}

export interface NormalizedTavernWorkspaceImportState {
  scopes: readonly TavernWorkspaceReplacementScope<TavernSnapshot>[]
  activeScopeLinks: Readonly<Record<string, string>>
}

/**
 * Preserves the historical portable-import admission semantics while making
 * the exact normalized replacement available to backup-first orchestration.
 */
export function normalizeTavernWorkspaceImportState(
  entries: readonly { scopeId?: string; snapshot: Partial<TavernSnapshot> | undefined }[],
  activeScopeLinks: Record<string, string> | undefined,
  options: TavernActiveScopeLinksExportOptions = {},
  operationTime = Date.now(),
): NormalizedTavernWorkspaceImportState {
  const imported = new Map<string, TavernSnapshot>()
  for (const entry of entries) {
    const scopeId = normalizeTavernScopeId(entry.scopeId)
    imported.set(
      scopeId,
      normalizeTavernSnapshot(entry.snapshot ?? createEmptyTavernSnapshot(operationTime), operationTime),
    )
  }
  return {
    scopes: [...imported].map(([scopeId, snapshot]) => ({
      scopeId,
      snapshot,
      updatedAt: snapshot.updatedAt,
    })),
    activeScopeLinks: filterTavernActiveScopeLinks(activeScopeLinks ?? {}, {
      ...options,
      scopeIds: [...imported.keys()],
    }),
  }
}

/**
 * Target-owned Tavern workspace lifecycle and portable-state orchestration.
 * Persistence owns CAS/repository behavior; this application owns scope
 * admission, privacy policy, and public error projection.
 */
export function createTavernWorkspaceApplication(
  dependencies: TavernWorkspaceApplicationDependencies,
): TavernWorkspaceApplication {
  const now = dependencies.now ?? (() => Date.now())
  const generateDuplicateScopeId = dependencies.generateDuplicateScopeId ?? generateDefaultDuplicateScopeId

  async function loadTavernSnapshot(
    scopeId?: string,
    options: TavernWorkspaceRepositoryOptions = {},
  ): Promise<TavernSnapshot> {
    const resolvedScopeId = normalizeTavernScopeId(scopeId)
    try {
      return unwrapTavernWorkspaceResult(
        await dependencies.persistence.loadOrEmpty(resolvedScopeId, options),
        options.signal,
      ).snapshot
    } catch (error) {
      throwIfTavernOperationAborted(options.signal)
      if (error instanceof TavernWorkspacePersistenceError && error.code === 'corrupt_record') throw error
      return createEmptyTavernSnapshot(now())
    }
  }

  async function saveTavernSnapshot(
    snapshot: Partial<TavernSnapshot>,
    scopeId?: string,
    options: TavernWorkspaceRepositoryOptions = {},
  ): Promise<TavernSnapshot> {
    const resolvedScopeId = normalizeTavernScopeId(scopeId)
    const normalized = normalizeTavernSnapshot(snapshot, now())
    return unwrapTavernWorkspaceResult(await dependencies.persistence.upsertScope({
      scopeId: resolvedScopeId,
      snapshot: normalized,
      updatedAt: normalized.updatedAt,
    }, options), options.signal).snapshot
  }

  async function clearTavernSnapshot(scopeId?: string): Promise<void> {
    if (scopeId === undefined) {
      unwrapTavernWorkspaceResult(await dependencies.persistence.clearAll())
      return
    }
    unwrapTavernWorkspaceResult(
      await dependencies.persistence.clearScope(normalizeTavernScopeId(scopeId)),
    )
  }

  async function exportTavernSnapshot(
    options: TavernExportOptions = {},
    scopeId?: string,
  ): Promise<TavernSnapshot> {
    return filterTavernSnapshotForExport(await loadTavernSnapshot(scopeId), options)
  }

  async function listTavernScopeIds(): Promise<string[]> {
    return unwrapTavernWorkspaceResult(await dependencies.persistence.listScopes())
      .map((scope) => scope.scopeId)
  }

  async function resolveTavernActiveScopeId(
    conversationScopeId?: string,
    options: TavernWorkspaceRepositoryOptions = {},
  ): Promise<string | undefined> {
    return unwrapTavernWorkspaceResult(
      await dependencies.persistence.resolveActiveScope(conversationScopeId, options),
      options.signal,
    )
  }

  async function setTavernActiveScopeId(
    conversationScopeId: string | undefined,
    activeScopeId?: string | null,
  ): Promise<string | undefined> {
    return unwrapTavernWorkspaceResult(
      await dependencies.persistence.setActiveScope(conversationScopeId, activeScopeId),
    )
  }

  async function exportTavernActiveScopeLinks(
    options: TavernActiveScopeLinksExportOptions = {},
  ): Promise<Record<string, string>> {
    const state = unwrapTavernWorkspaceResult(await dependencies.persistence.loadAll())
    return filterTavernActiveScopeLinks(state.activeScopeLinks, {
      ...options,
      scopeIds: options.scopeIds ?? state.scopes.map((scope) => scope.scopeId),
    })
  }

  async function duplicateTavernScope(
    sourceScopeId?: string,
    targetScopeId?: string,
    options: TavernScopeDuplicateOptions = {},
  ): Promise<TavernScopeDuplicateResult> {
    const resolvedSourceScopeId = normalizeTavernScopeId(sourceScopeId ?? DEFAULT_TAVERN_SCOPE_ID)
    const operationTime = now()
    const sourceSnapshot = options.sourceSnapshot
      ? normalizeTavernSnapshot(options.sourceSnapshot, operationTime)
      : await loadTavernSnapshot(sourceScopeId)
    const requestedTargetScopeId = normalizeOptionalTavernScopeId(targetScopeId)
    const existingScopeIds = new Set(await listTavernScopeIds())
    const resolvedTargetScopeId = requestedTargetScopeId &&
      requestedTargetScopeId !== resolvedSourceScopeId &&
      !existingScopeIds.has(requestedTargetScopeId)
      ? requestedTargetScopeId
      : await generateUniqueTavernDuplicateScopeId(resolvedSourceScopeId, operationTime)
    const includePendingWritebacks = Boolean(options.includePendingWritebacks)
    const snapshot = await saveTavernSnapshot({
      ...sourceSnapshot,
      pendingWritebacks: includePendingWritebacks ? sourceSnapshot.pendingWritebacks : [],
      updatedAt: operationTime,
    }, resolvedTargetScopeId)
    return {
      scopeId: resolvedTargetScopeId,
      snapshot,
      duplicateAudit: buildTavernScopeDuplicateAudit(sourceSnapshot, includePendingWritebacks),
    }
  }

  async function exportTavernSnapshots(
    options: TavernScopedExportOptions = {},
  ): Promise<TavernScopedExportEntry[]> {
    const scopeIds = await listTavernScopeIds()
    const includeEmptyScopeIds = new Set(
      (options.includeEmptyScopeIds ?? [])
        .map((scopeId) => normalizeOptionalTavernScopeId(scopeId))
        .filter(isString),
    )
    const exports: TavernScopedExportEntry[] = []
    for (const scopeId of scopeIds) {
      const rawSnapshot = await loadTavernSnapshot(scopeId)
      const snapshot = filterTavernSnapshotForExport(rawSnapshot, options)
      const exportAudit = buildTavernExportAudit(rawSnapshot, options)
      if (!hasTavernSnapshotData(snapshot) &&
          !hasTavernExportAuditOmissions(exportAudit) &&
          !includeEmptyScopeIds.has(scopeId)) {
        continue
      }
      exports.push({ scopeId, snapshot, exportAudit })
    }
    return exports
  }

  async function importTavernWorkspaceState(
    entries: readonly { scopeId?: string; snapshot: Partial<TavernSnapshot> | undefined }[],
    activeScopeLinks: Record<string, string> | undefined,
    options: TavernActiveScopeLinksExportOptions = {},
  ): Promise<Record<string, TavernSnapshot>> {
    const operationTime = now()
    const normalized = normalizeTavernWorkspaceImportState(
      entries,
      activeScopeLinks,
      options,
      operationTime,
    )
    const state = unwrapTavernWorkspaceResult(await dependencies.persistence.replaceImport({
      scopes: normalized.scopes,
      activeScopeLinks: normalized.activeScopeLinks,
    }))
    return Object.fromEntries(state.scopes.map((scope) => [scope.scopeId, scope.snapshot]))
  }

  async function generateUniqueTavernDuplicateScopeId(sourceScopeId: string, timestamp: number): Promise<string> {
    const existingScopeIds = new Set(await listTavernScopeIds())
    const baseScopeId = normalizeTavernScopeId(generateDuplicateScopeId(sourceScopeId, timestamp))
    if (!existingScopeIds.has(baseScopeId)) return baseScopeId
    for (let index = 2; index < 1000; index += 1) {
      const candidateScopeId = normalizeTavernScopeId(`${baseScopeId}-${index}`)
      if (!existingScopeIds.has(candidateScopeId)) return candidateScopeId
    }
    return normalizeTavernScopeId(
      `${baseScopeId}-${Math.abs(hashString(`${sourceScopeId}:${timestamp}:${existingScopeIds.size}`)).toString(36)}`,
    )
  }

  return {
    loadTavernSnapshot,
    saveTavernSnapshot,
    clearTavernSnapshot,
    exportTavernSnapshot,
    listTavernScopeIds,
    resolveTavernActiveScopeId,
    setTavernActiveScopeId,
    exportTavernActiveScopeLinks,
    duplicateTavernScope,
    exportTavernSnapshots,
    importTavernWorkspaceState,
  }
}

function hasTavernSnapshotData(snapshot: TavernSnapshot): boolean {
  return snapshot.characters.length > 0 ||
    snapshot.lorebook.length > 0 ||
    snapshot.relationshipMemories.length > 0 ||
    snapshot.scenes.length > 0 ||
    snapshot.narrativeSummaries.length > 0 ||
    snapshot.pendingWritebacks.length > 0
}

function hasTavernExportAuditOmissions(audit: TavernExportAudit): boolean {
  return audit.hiddenRelationshipMemoryOmitted > 0 ||
    audit.hiddenPendingRelationshipMemoryCandidateOmitted > 0 ||
    audit.pendingWritebackOmitted > 0 ||
    audit.pendingSummaryDraftOmitted > 0 ||
    audit.pendingCharacterDraftOmitted > 0 ||
    audit.pendingLorebookDraftOmitted > 0 ||
    audit.pendingRelationshipMemoryCandidateOmitted > 0 ||
    audit.pendingSceneChangeOmitted > 0
}

function filterTavernActiveScopeLinks(
  scopesByConversationId: Readonly<Record<string, string>>,
  options: TavernActiveScopeLinksExportOptions,
): Record<string, string> {
  const conversationIds = options.conversationIds
    ? new Set(options.conversationIds.map(normalizeOptionalTavernScopeId).filter(isString))
    : null
  const scopeIds = options.scopeIds
    ? new Set(options.scopeIds.map(normalizeOptionalTavernScopeId).filter(isString))
    : null
  const filtered: Record<string, string> = {}
  for (const [rawConversationId, rawScopeId] of Object.entries(scopesByConversationId)) {
    const conversationId = normalizeOptionalTavernScopeId(rawConversationId)
    const scopeId = normalizeOptionalTavernScopeId(rawScopeId)
    if (!conversationId || !scopeId || conversationId === scopeId) continue
    if (conversationIds && !conversationIds.has(conversationId)) continue
    if (scopeIds && !scopeIds.has(scopeId)) continue
    filtered[conversationId] = scopeId
  }
  return filtered
}

function unwrapTavernWorkspaceResult<Value>(
  result: TavernWorkspaceRepositoryResult<Value>,
  signal?: AbortSignal,
): Value {
  if (result.ok) return result.value
  if (result.error.code === 'cancelled') throwTavernOperationAborted(signal)
  throw new TavernWorkspacePersistenceError(result.error.code, result.error.message)
}

class TavernWorkspacePersistenceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'TavernWorkspacePersistenceError'
  }
}

function throwIfTavernOperationAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throwTavernOperationAborted(signal)
}

function throwTavernOperationAborted(signal?: AbortSignal): never {
  if (signal?.reason instanceof Error) throw signal.reason
  const error = new Error('The Tavern workspace persistence operation was aborted.')
  error.name = 'AbortError'
  throw error
}

function normalizeTavernScopeId(value: unknown): string {
  return normalizeTavernWorkspaceScopeId(value) ?? DEFAULT_TAVERN_SCOPE_ID
}

function normalizeOptionalTavernScopeId(value: unknown): string | undefined {
  return normalizeTavernWorkspaceScopeId(value)
}

function generateDefaultDuplicateScopeId(sourceScopeId: string, timestamp: number): string {
  return `tavern-profile-${Math.abs(hashString(`${sourceScopeId}:${timestamp}`)).toString(36)}`
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash | 0
}

function isString(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0
}
