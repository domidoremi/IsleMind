import type {
  PortableDataApplication,
  PortableDataApplicationDependencies,
  PortableDataExportOptions,
  PortableDataImportOptions,
  PortableDataImportResult,
  PortableDataTransferFailureReason,
} from '../contracts'

export function createPortableDataApplication(
  dependencies: PortableDataApplicationDependencies,
): PortableDataApplication {
  return Object.freeze({
    async exportToJsonFileDetailed(
      options: PortableDataExportOptions = {},
    ) {
      const payload = await dependencies.payload.exportJson(options)
      const file = await dependencies.transfer.exportJsonFile(payload.json)
      return {
        ...file,
        ...(payload.tavernSnapshotAudits
          ? { tavernSnapshotAudits: payload.tavernSnapshotAudits }
          : {}),
      }
    },

    async importFromJsonFileDetailed(
      options: PortableDataImportOptions = {},
    ): Promise<PortableDataImportResult> {
      if (options.signal?.aborted) return cancelledImportResult()

      const selection = await dependencies.transfer.selectJsonFile(options)
      if (!selection.ok) return failedImportResult(selection.reason)
      if (options.signal?.aborted) return cancelledImportResult()

      const result = await dependencies.payload.importJson(selection.json, options)
      if (!result.ok) return result

      try {
        await dependencies.projections.refresh()
      } catch (error) {
        try {
          await dependencies.reportProjectionRefreshFailure?.(error)
        } catch {
          // The durable import result remains authoritative after projection failure.
        }
      }
      return result
    },

    async clearAllData(): Promise<void> {
      await dependencies.payload.clearAllData()
      await dependencies.projections.refresh()
    },
  })
}

function cancelledImportResult(): PortableDataImportResult {
  return { ok: false, kind: 'invalid', reason: 'operation_cancelled' }
}

function failedImportResult(
  reason: PortableDataTransferFailureReason,
): PortableDataImportResult {
  return { ok: false, kind: 'invalid', reason }
}
