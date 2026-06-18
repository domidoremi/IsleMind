import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { exportAllData, importAllDataDetailed, type ImportAllDataResult } from '@/services/storage'
import { MAX_IMPORT_JSON_FILE_BYTES, deleteTemporaryImportCopy, isFileTooLargeError, readUtf8ImportFile } from '@/services/fileImportGuards'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { st } from '@/i18n/service'

export async function exportToJsonFile(): Promise<string> {
  const json = await exportAllData()
  const filename = `islemind-export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  const canShare = await Sharing.isAvailableAsync()
  const rootDirectory = canShare
    ? FileSystem.cacheDirectory ?? FileSystem.documentDirectory
    : FileSystem.documentDirectory ?? FileSystem.cacheDirectory
  if (!rootDirectory) throw new Error('File storage is unavailable.')
  const uri = `${rootDirectory}${filename}`
  await FileSystem.writeAsStringAsync(uri, json, { encoding: FileSystem.EncodingType.UTF8 })
  try {
    if (canShare) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/json',
        dialogTitle: st('portableData.exportDialogTitle'),
        UTI: 'public.json',
      })
    }
  } finally {
    if (canShare) {
      await deleteTemporaryImportCopy(uri, { assumeTemporaryCopy: true })
    }
  }
  return uri
}

export async function importFromJsonFile(): Promise<boolean> {
  return (await importFromJsonFileDetailed()).ok
}

export async function importFromJsonFileDetailed(): Promise<ImportAllDataResult> {
  let importUri: string | undefined
  try {
    const picked = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      type: ['application/json', 'text/json', 'text/plain'],
    })
    if (picked.canceled || !picked.assets[0]) return { ok: false, kind: 'invalid' }
    importUri = picked.assets[0].uri
    const raw = await readUtf8ImportFile(importUri, {
      size: picked.assets[0].size,
      limitBytes: MAX_IMPORT_JSON_FILE_BYTES,
    })
    const result = await importAllDataDetailed(raw)
    if (result.ok) {
      await Promise.all([useChatStore.getState().load(), useSettingsStore.getState().load()]).catch(() => undefined)
    }
    return result
  } catch (error) {
    if (isFileTooLargeError(error)) return { ok: false, kind: 'invalid', reason: 'file_too_large' }
    return { ok: false, kind: 'invalid' }
  } finally {
    await deleteTemporaryImportCopy(importUri, { assumeTemporaryCopy: true })
  }
}
