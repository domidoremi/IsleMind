import { NativeModules, Platform } from 'react-native'

interface AndroidDeviceToolsNativeModule {
  publishPortableJsonFileToDownloads?: (
    sourceUri: string,
    displayName: string,
    mimeType: string
  ) => Promise<string>
}

const androidDeviceTools = NativeModules.AndroidDeviceTools as AndroidDeviceToolsNativeModule | undefined

export async function publishPortableJsonFileToDownloads(
  sourceUri: string,
  displayName: string
): Promise<string | null> {
  if (Platform.OS !== 'android') return null
  const safeName = sanitizePortableDownloadName(displayName)
  if (!safeName || !androidDeviceTools?.publishPortableJsonFileToDownloads) return null
  try {
    const publicUri = await androidDeviceTools.publishPortableJsonFileToDownloads(sourceUri, safeName, 'application/json')
    return typeof publicUri === 'string' && publicUri.trim() ? publicUri : null
  } catch {
    return null
  }
}

function sanitizePortableDownloadName(value: string): string | null {
  const cleaned = value.trim()
  if (!/^islemind-export-[^/\\:*?"<>|\u0000-\u001F]+\.json$/.test(cleaned)) return null
  return cleaned
}
