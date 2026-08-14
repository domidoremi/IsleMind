import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'

import {
  deleteTemporaryImportCopy,
  isFileTooLargeError,
  readUtf8ImportFile,
} from './boundedImportFile'
import { publishPortableJsonFileToDownloads } from './androidDownloadsPublisher'

export type ExpoPortableDataTransferSelectionResult =
  | { ok: true; json: string }
  | {
      ok: false
      reason:
        | 'selection_cancelled'
        | 'picker_failed'
        | 'file_too_large'
        | 'read_failed'
        | 'operation_cancelled'
    }

export interface ExpoPortableDataTransferOptions {
  maxImportBytes: number
  exportDialogTitle: () => string
  now?: () => Date
}

export interface ExpoPortableDataTransferPort {
  exportJsonFile(json: string): Promise<{ uri: string; publicUri?: string }>
  selectJsonFile(options?: { signal?: AbortSignal }): Promise<ExpoPortableDataTransferSelectionResult>
}

export function createExpoPortableDataTransferPort(
  options: ExpoPortableDataTransferOptions,
): ExpoPortableDataTransferPort {
  return Object.freeze({
    async exportJsonFile(json: string) {
      const filename = createPortableExportFilename(options.now?.() ?? new Date())
      const rootDirectory = FileSystem.documentDirectory ?? FileSystem.cacheDirectory
      if (!rootDirectory) throw new Error('File storage is unavailable.')

      const uri = `${rootDirectory}${filename}`
      await FileSystem.writeAsStringAsync(uri, json, { encoding: FileSystem.EncodingType.UTF8 })
      const publicUri = await publishPortableJsonFileToDownloads(uri, filename)
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/json',
          dialogTitle: options.exportDialogTitle(),
          UTI: 'public.json',
        })
      }
      return publicUri ? { uri, publicUri } : { uri }
    },

    async selectJsonFile(
      selectionOptions: { signal?: AbortSignal } = {},
    ): Promise<ExpoPortableDataTransferSelectionResult> {
      if (selectionOptions.signal?.aborted) return cancelledSelection()

      let picked: DocumentPicker.DocumentPickerResult
      try {
        picked = await DocumentPicker.getDocumentAsync({
          copyToCacheDirectory: true,
          type: ['application/json', 'text/json', 'text/plain'],
        })
      } catch {
        return { ok: false, reason: 'picker_failed' }
      }

      const asset = Array.isArray(picked.assets) ? picked.assets[0] : undefined
      if (!asset || typeof asset.uri !== 'string' || !asset.uri.trim()) {
        return { ok: false, reason: 'selection_cancelled' }
      }
      if (picked.canceled) {
        await deleteTemporaryImportCopy(asset.uri, { assumeTemporaryCopy: true })
        return { ok: false, reason: 'selection_cancelled' }
      }

      try {
        if (selectionOptions.signal?.aborted) return cancelledSelection()
        const json = await readUtf8ImportFile(asset.uri, {
          size: asset.size,
          limitBytes: options.maxImportBytes,
        })
        if (selectionOptions.signal?.aborted) return cancelledSelection()
        return { ok: true, json }
      } catch (error) {
        if (selectionOptions.signal?.aborted) return cancelledSelection()
        if (isFileTooLargeError(error)) return { ok: false, reason: 'file_too_large' }
        return { ok: false, reason: 'read_failed' }
      } finally {
        await deleteTemporaryImportCopy(asset.uri, { assumeTemporaryCopy: true })
      }
    },
  })
}

function createPortableExportFilename(now: Date): string {
  return `islemind-export-${now.toISOString().replace(/[:.]/g, '-')}.json`
}

function cancelledSelection(): ExpoPortableDataTransferSelectionResult {
  return { ok: false, reason: 'operation_cancelled' }
}
