import * as FileSystem from 'expo-file-system/legacy'
import * as ImagePicker from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'
import type { Attachment, AttachmentType } from '@/types'

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

const MAX_FILE_SIZE = 20 * 1024 * 1024

function assertFileSize(size?: number) {
  if (size && size > MAX_FILE_SIZE) {
    throw new Error('error.fileTooLarge')
  }
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

  const asset = result.assets[0]
  assertFileSize(asset.fileSize)
  const base64 = await fileToBase64(asset.uri)

  return {
    id: generateId(),
    type: 'image',
    uri: asset.uri,
    name: asset.fileName || 'image.jpg',
    mimeType: asset.mimeType || 'image/jpeg',
    size: asset.fileSize || 0,
    base64,
  }
}

export async function takePhoto(): Promise<Attachment | null> {
  const result = await ImagePicker.launchCameraAsync({
    quality: 0.85,
    base64: false,
  })

  if (result.canceled || !result.assets[0]) return null

  const asset = result.assets[0]
  assertFileSize(asset.fileSize)
  const base64 = await fileToBase64(asset.uri)

  return {
    id: generateId(),
    type: 'image',
    uri: asset.uri,
    name: asset.fileName || 'photo.jpg',
    mimeType: asset.mimeType || 'image/jpeg',
    size: asset.fileSize || 0,
    base64,
  }
}

export async function pickDocument(): Promise<Attachment | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['image/*', 'application/pdf', 'text/*', 'application/json', 'application/javascript', 'application/xml', 'text/xml'],
    copyToCacheDirectory: true,
  })

  if (result.canceled || !result.assets[0]) return null

  const asset = result.assets[0]

  assertFileSize(asset.size)

  const type = getAttachmentType(asset.mimeType || '')
  const base64 = await fileToBase64(asset.uri)

  return {
    id: generateId(),
    type,
    uri: asset.uri,
    name: asset.name,
    mimeType: asset.mimeType || 'application/octet-stream',
    size: asset.size || 0,
    base64,
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
