import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { exportAllData, importAllDataDetailed, type ImportAllDataResult } from '@/services/storage'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { st } from '@/i18n/service'

export async function exportToJsonFile(): Promise<string> {
  const json = await exportAllData()
  const filename = `islemind-export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  const uri = `${FileSystem.documentDirectory ?? FileSystem.cacheDirectory}${filename}`
  await FileSystem.writeAsStringAsync(uri, json, { encoding: FileSystem.EncodingType.UTF8 })
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/json',
      dialogTitle: st('portableData.exportDialogTitle'),
      UTI: 'public.json',
    })
  }
  return uri
}

export async function importFromJsonFile(): Promise<boolean> {
  return (await importFromJsonFileDetailed()).ok
}

export async function importFromJsonFileDetailed(): Promise<ImportAllDataResult> {
  const picked = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    type: ['application/json', 'text/json', 'text/plain'],
  })
  if (picked.canceled || !picked.assets[0]) return { ok: false, kind: 'invalid' }
  const raw = await FileSystem.readAsStringAsync(picked.assets[0].uri, { encoding: FileSystem.EncodingType.UTF8 })
  const result = await importAllDataDetailed(raw)
  if (result.ok) {
    await Promise.all([useChatStore.getState().load(), useSettingsStore.getState().load()])
  }
  return result
}
