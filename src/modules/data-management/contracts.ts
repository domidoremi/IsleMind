import type { UsagePortableSnapshot } from '@/modules/diagnostics'
import type { PortableKnowledgeSnapshot } from '@/modules/knowledge'
import type {
  TavernExportAudit,
  TavernExportOptions,
  TavernSnapshot,
} from '@/modules/workspaces'
import type { Conversation } from '@/types/chatContracts'
import type { McpServerConfig } from '@/types/mcpContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { Settings } from '@/types/settingsContracts'
import type { SkillDefinition } from '@/types/skillContracts'
import type { Mem0MemoryEnvelope } from '@/utils/mem0Interop'

export interface PortableDataExportOptions {
  /** Historical workspace export controls retained for portable schema v1. */
  tavern?: TavernExportOptions
  /** Optional category filter; omitted means a complete portable export. */
  selection?: PortableBackupSelection
}

export type PortableBackupCategory =
  | 'settings'
  | 'providers'
  | 'models'
  | 'conversations'
  | 'workspaces'
  | 'knowledge'
  | 'skills'
  | 'mcp'
  | 'usage'

export interface PortableBackupSelection {
  mode: 'full' | 'selective'
  categories?: readonly PortableBackupCategory[]
}

export type PortableDataRestoreConflictMode = 'skip' | 'replace' | 'merge' | 'fail'

export interface PortableDataRestorePreview {
  schema: 'islemind.portable-backup.v2'
  selection: Required<PortableBackupSelection>
  conflictMode: PortableDataRestoreConflictMode
  counts: Record<PortableBackupCategory, number>
  selectedCategories: PortableBackupCategory[]
  missingDependencies: string[]
  conflicts: Array<{ category: PortableBackupCategory; id: string }>
  actions: Array<{ category: PortableBackupCategory; action: 'skip' | 'replace' | 'merge' | 'create'; id?: string }>
  safeRollbackRequired: true
  secretsIncluded: false
  preserveSecureState: boolean
}

export type PortableDataLanguagePreferenceSource = 'system' | 'user'

export interface PortableDataExportPayload {
  app: 'islemind'
  version: 1
  conversations: Conversation[]
  settings: Settings | null
  languagePreferenceSource?: PortableDataLanguagePreferenceSource
  providers: AIProvider[]
  skills?: SkillDefinition[]
  mcpServers?: McpServerConfig[]
  context?: PortableKnowledgeSnapshot
  tavernSnapshots?: Record<string, TavernSnapshot>
  tavernSnapshotAudits?: Record<string, TavernExportAudit>
  tavernActiveScopes?: Record<string, string>
  mem0?: Mem0MemoryEnvelope
  usage?: UsagePortableSnapshot
  exportedAt: number
}

export const MAX_PORTABLE_DATA_IMPORT_BYTES = 64 * 1024 * 1024

export interface PortableDataImportOptions {
  signal?: AbortSignal
  /** Called after validation and conflict discovery, before any durable write. */
  confirmRestore?: (preview: PortableDataRestorePreview) => boolean | Promise<boolean>
}

export type PortableDataImportFailureReason =
  | 'selection_cancelled'
  | 'picker_failed'
  | 'file_too_large'
  | 'read_failed'
  | 'invalid_json'
  | 'invalid_structure'
  | 'operation_cancelled'
  | 'persistence_failed'

export type PortableDataImportResult =
  | { ok: true; kind: 'islemind'; conversations: number }
  | { ok: true; kind: 'mem0'; memories: number }
  | { ok: false; kind: 'invalid'; reason: PortableDataImportFailureReason }

export interface PortableDataExportResult {
  uri: string
  publicUri?: string
  tavernSnapshotAudits?: Record<string, TavernExportAudit>
}

export interface PortableDataSerializedExport {
  json: string
  tavernSnapshotAudits?: Record<string, TavernExportAudit>
}

export type PortableDataTransferFailureReason =
  | 'selection_cancelled'
  | 'picker_failed'
  | 'file_too_large'
  | 'read_failed'
  | 'operation_cancelled'

export type PortableDataTransferSelectionResult =
  | { ok: true; json: string }
  | { ok: false; reason: PortableDataTransferFailureReason }

export interface PortableDataTransferExportResult {
  uri: string
  publicUri?: string
}

export interface PortableDataPayloadPort {
  exportJson(
    options?: PortableDataExportOptions,
  ): Promise<PortableDataSerializedExport>
  importJson(
    json: string,
    options?: PortableDataImportOptions,
  ): Promise<PortableDataImportResult>
  clearAllData(): Promise<void>
}

export interface PortableDataTransferPort {
  exportJsonFile(json: string): Promise<PortableDataTransferExportResult>
  selectJsonFile(
    options?: PortableDataImportOptions,
  ): Promise<PortableDataTransferSelectionResult>
}

export interface PortableDataProjectionPort {
  refresh(): Promise<void>
}

export interface PortableDataApplication {
  exportToJsonFileDetailed(
    options?: PortableDataExportOptions,
  ): Promise<PortableDataExportResult>
  importFromJsonFileDetailed(
    options?: PortableDataImportOptions,
  ): Promise<PortableDataImportResult>
  clearAllData(): Promise<void>
}

export interface PortableDataApplicationDependencies {
  payload: PortableDataPayloadPort
  transfer: PortableDataTransferPort
  projections: PortableDataProjectionPort
  reportProjectionRefreshFailure?: (error: unknown) => void | Promise<void>
}
