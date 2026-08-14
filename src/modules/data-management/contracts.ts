import type { TavernExportAudit, TavernExportOptions } from '@/modules/workspaces'

export interface PortableDataExportOptions {
  /** Historical workspace export controls retained for portable schema v1. */
  tavern?: TavernExportOptions
}

export const MAX_PORTABLE_DATA_IMPORT_BYTES = 64 * 1024 * 1024

export interface PortableDataImportOptions {
  signal?: AbortSignal
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
