import * as FileSystem from 'expo-file-system/legacy'
import * as ImagePicker from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'
import type { Attachment, AttachmentType } from '@/types'
import { smartCompressImage } from './imageCompression'
import { assertImportFileSizeByUri, deleteTemporaryImportCopy, MAX_IMPORT_TEXT_FILE_BYTES } from './fileImportGuards'

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

async function assertFileSize(uri: string, size?: number): Promise<number> {
  return (await assertImportFileSizeByUri(uri, { size, limitBytes: MAX_IMPORT_TEXT_FILE_BYTES })) ?? 0
}

function getAttachmentType(mimeType: string): AttachmentType {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType.startsWith('text/') || mimeType.includes('json') || mimeType.includes('javascript') || mimeType.includes('xml')) return 'text'
  return 'document'
}

async function fileToBase64(uri: string): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  })
  return base64
}

export async function pickImage(): Promise<Attachment | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.85,
    base64: false,
  })

  if (result.canceled || !result.assets[0]) return null

  return buildCompressedImageAttachment(result.assets[0], 'image.jpg')
}

export async function takePhoto(): Promise<Attachment | null> {
  const result = await ImagePicker.launchCameraAsync({
    quality: 0.85,
    base64: false,
  })

  if (result.canceled || !result.assets[0]) return null

  return buildCompressedImageAttachment(result.assets[0], 'photo.jpg')
}

export async function pickDocument(): Promise<Attachment | null> {
  let importUri: string | undefined
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['image/*', 'application/pdf', 'text/*', 'application/json', 'application/javascript', 'application/xml', 'text/xml'],
      copyToCacheDirectory: true,
    })

    if (result.canceled || !result.assets[0]) return null

    const asset = result.assets[0]
    importUri = asset.uri

    const size = await assertFileSize(importUri, asset.size)

    const type = getAttachmentType(asset.mimeType || '')
    const base64 = await fileToBase64(importUri)

    return {
      id: generateId(),
      type,
      uri: importUri,
      name: asset.name,
      mimeType: asset.mimeType || 'application/octet-stream',
      size,
      base64,
    }
  } finally {
    await deleteTemporaryImportCopy(importUri, { assumeTemporaryCopy: true })
  }
}

export function getAttachmentIcon(type: AttachmentType): string {
  switch (type) {
    case 'image': return 'image'
    case 'pdf': return 'file-text'
    case 'text': return 'file-code'
    case 'document': return 'file'
  }
}

async function cleanupImageAttachmentCopies(input: {
  originalUri?: string
  compressedUri?: string
}): Promise<void> {
  const cleanup: Promise<void>[] = []
  if (input.originalUri) {
    cleanup.push(deleteTemporaryImportCopy(input.originalUri))
  }
  if (input.compressedUri) {
    cleanup.push(deleteTemporaryImportCopy(input.compressedUri, { assumeTemporaryCopy: true }))
  }
  await Promise.all(cleanup)
}

async function buildCompressedImageAttachment(
  asset: {
    uri: string
    fileName?: string | null
    mimeType?: string | null
    fileSize?: number | null
  },
  defaultName: string
): Promise<Attachment> {
  let compressedUri: string | undefined
  try {
    await assertFileSize(asset.uri, asset.fileSize ?? undefined)

    // 自动压缩图片
    const compressed = await smartCompressImage(asset.uri)
    compressedUri = compressed.uri
    const compressedSize = await assertFileSize(compressedUri, compressed.compressedSize)
    const base64 = await fileToBase64(compressedUri)

    return {
      id: generateId(),
      type: 'image',
      uri: compressedUri,
      name: asset.fileName || defaultName,
      mimeType: asset.mimeType || 'image/jpeg',
      size: compressedSize,
      base64,
    }
  } finally {
    await cleanupImageAttachmentCopies({ originalUri: asset.uri, compressedUri })
  }
}
