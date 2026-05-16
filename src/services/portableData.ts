import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { exportAllData, importAllData } from '@/services/storage'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'

export async function exportToJsonFile(): Promise<string> {
  const json = await exportAllData()
  const filename = `islemind-export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  const uri = `${FileSystem.documentDirectory ?? FileSystem.cacheDirectory}${filename}`
  await FileSystem.writeAsStringAsync(uri, json, { encoding: FileSystem.EncodingType.UTF8 })
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/json',
      dialogTitle: '导出 IsleMind 对话 JSON',
      UTI: 'public.json',
    })
  }
  return uri
}

export async function importFromJsonFile(): Promise<boolean> {
  const picked = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    type: ['application/json', 'text/json', 'text/plain'],
  })
  if (picked.canceled || !picked.assets[0]) return false
  const raw = await FileSystem.readAsStringAsync(picked.assets[0].uri, { encoding: FileSystem.EncodingType.UTF8 })
  const ok = await importAllData(raw)
  if (ok) {
    await Promise.all([useChatStore.getState().load(), useSettingsStore.getState().load()])
  }
  return ok
}
