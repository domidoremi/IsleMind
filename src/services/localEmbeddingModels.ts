import * as FileSystem from 'expo-file-system/legacy'
import * as Crypto from 'expo-crypto'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import catalog from '../../assets/models/catalog.json'
import { BUNDLED_LOCAL_EMBEDDING_MODELS } from '@/generated/modelBundle'
import type { Settings } from '@/types'
import type { LocalRagModelCapability } from '@/types'

export type LocalEmbeddingModelStatus = 'not-downloaded' | 'downloading' | 'downloaded' | 'bundled' | 'enabled' | 'verify-failed' | 'runtime-unavailable' | 'planned'
export type LocalEmbeddingModelSource = 'bundled' | 'downloaded'
export type LocalEmbeddingTokenizer = 'wordpiece' | 'unigram'

export interface LocalEmbeddingModelFile {
  path: string
  bytes: number
  sha256: string
}

export interface LocalEmbeddingModel {
  id: string
  version: string
  name: string
  capability?: LocalRagModelCapability
  language: string
  useCase: string
  dimension: number
  tokenizer: LocalEmbeddingTokenizer
  maxTokens: number
  sizeBytes: number
  downloadBaseUrl: string
  sourceUrl?: string
  publisher?: string
  upstreamModel?: string
  upstreamContributors?: string[]
  license?: string
  attribution?: string
  bundledIn: string[]
  files: LocalEmbeddingModelFile[]
}

export interface LocalEmbeddingModelRecord {
  modelId: string
  source: LocalEmbeddingModelSource
  downloadedAt?: number
  verifiedAt?: number
  bytes?: number
  sha256?: Record<string, string>
}

export interface LocalEmbeddingModelView {
  model: LocalEmbeddingModel
  status: LocalEmbeddingModelStatus
  source: LocalEmbeddingModelSource | 'none'
  active: boolean
  downloaded: boolean
  bundled: boolean
  bytes: number
}

export type LocalEmbeddingDownloadStage = 'preparing' | 'downloading' | 'verifying' | 'retrying' | 'finalizing'

export interface LocalEmbeddingDownloadProgress {
  modelId: string
  modelName: string
  filePath: string
  fileIndex: number
  fileCount: number
  bytesWritten: number
  totalBytes: number
  fileBytesWritten: number
  fileTotalBytes: number
  percent: number
  stage: LocalEmbeddingDownloadStage
  sourceUrl: string
}

export interface LocalEmbeddingDownloadOptions {
  mirrorBaseUrl?: string
  onProgress?: (progress: LocalEmbeddingDownloadProgress) => void
}

interface LocalEmbeddingModelState {
  records: Record<string, LocalEmbeddingModelRecord>
  failed: Record<string, string>
}

const STORAGE_KEY = '@islemind/local-embedding-models'
const MODEL_ROOT = `${FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? ''}islemind-models/`
const BUNDLED_ASSET_ROOT = Platform.OS === 'android' ? 'asset:///islemind-models/' : ''

const typedCatalog = catalog as {
  models: LocalEmbeddingModel[]
}

export const LOCAL_EMBEDDING_MODELS: LocalEmbeddingModel[] = typedCatalog.models
export const LOCAL_RAG_MODEL_CAPABILITIES: LocalRagModelCapability[] = ['embedding', 'reranker', 'colbert', 'compressor']

let cachedState: LocalEmbeddingModelState | null = null

export function formatModelBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function getLocalEmbeddingModel(modelId: string | null | undefined): LocalEmbeddingModel | null {
  if (!modelId) return null
  return LOCAL_EMBEDDING_MODELS.find((model) => model.id === modelId) ?? null
}

export async function listLocalEmbeddingModelViews(settings: Settings): Promise<LocalEmbeddingModelView[]> {
  const state = await loadLocalModelState()
  return LOCAL_EMBEDDING_MODELS.map((model) => {
    const planned = !model.files.length || model.sizeBytes <= 0
    const record = state.records[model.id]
    const bundled = isModelBundled(model.id)
    const downloaded = record?.source === 'downloaded'
    const active = !planned && settings.localEmbeddingModelId === model.id && settings.localEmbeddingModelSource !== 'none'
    const failed = state.failed[model.id]
    const source = active
      ? settings.localEmbeddingModelSource === 'downloaded' || settings.localEmbeddingModelSource === 'bundled'
        ? settings.localEmbeddingModelSource
        : bundled
          ? 'bundled'
          : downloaded
            ? 'downloaded'
            : 'none'
      : downloaded
        ? 'downloaded'
        : bundled
          ? 'bundled'
          : 'none'
    const status: LocalEmbeddingModelStatus = planned
      ? 'planned'
      : active
        ? 'enabled'
        : failed
          ? 'verify-failed'
          : downloaded
            ? 'downloaded'
            : bundled
              ? 'bundled'
              : 'not-downloaded'
    return {
      model,
      status,
      source,
      active,
      downloaded,
      bundled,
      bytes: record?.bytes ?? model.sizeBytes,
    }
  })
}

export async function downloadLocalEmbeddingModel(modelId: string, options: LocalEmbeddingDownloadOptions = {}): Promise<LocalEmbeddingModelRecord> {
  const model = requireModel(modelId)
  if (!model.files.length || model.sizeBytes <= 0) {
    throw new Error(`Model ${model.id} is listed as an optional capability, but downloadable files are not packaged in this catalog yet.`)
  }
  if (!MODEL_ROOT) throw new Error('File storage is unavailable.')
  await ensureDirectory(MODEL_ROOT)
  const tempDirectory = tempModelDirectory(model.id)
  const finalDirectory = modelDirectory(model.id)
  await FileSystem.deleteAsync(tempDirectory, { idempotent: true })
  await ensureDirectory(tempDirectory)
  const hashes: Record<string, string> = {}
  let bytes = 0
  let completedBytes = 0
  const totalBytes = model.files.reduce((total, file) => total + file.bytes, 0)
  const mirrorBaseUrl = normalizeMirrorBaseUrl(options.mirrorBaseUrl)

  function emit(file: LocalEmbeddingModelFile, index: number, stage: LocalEmbeddingDownloadStage, sourceUrl: string, fileBytesWritten = 0) {
    const written = Math.min(totalBytes, completedBytes + Math.max(0, fileBytesWritten))
    options.onProgress?.({
      modelId: model.id,
      modelName: model.name,
      filePath: file.path,
      fileIndex: index + 1,
      fileCount: model.files.length,
      bytesWritten: written,
      totalBytes,
      fileBytesWritten,
      fileTotalBytes: file.bytes,
      percent: totalBytes > 0 ? Math.max(0, Math.min(100, Math.round((written / totalBytes) * 100))) : 0,
      stage,
      sourceUrl,
    })
  }

  try {
    for (const [index, file] of model.files.entries()) {
      const targetUri = tempModelFileUri(model.id, file.path, tempDirectory)
      await ensureDirectory(parentDirectory(targetUri))
      const officialUrl = modelFileDownloadUrl(model.downloadBaseUrl, file.path)
      emit(file, index, 'preparing', officialUrl)
      let sha256: string
      try {
        sha256 = await downloadAndVerifyFile({ model, file, index, targetUri, sourceUrl: officialUrl, emit })
      } catch (officialError) {
        if (!mirrorBaseUrl) throw officialError
        const mirrorUrl = mirrorModelFileUrl(model.downloadBaseUrl, mirrorBaseUrl, file.path)
        await FileSystem.deleteAsync(targetUri, { idempotent: true })
        emit(file, index, 'retrying', mirrorUrl)
        try {
          sha256 = await downloadAndVerifyFile({ model, file, index, targetUri, sourceUrl: mirrorUrl, emit })
        } catch (mirrorError) {
          throw new Error(`${errorMessage(mirrorError)}; official source also failed: ${errorMessage(officialError)}`)
        }
      }
      const info = await FileSystem.getInfoAsync(targetUri)
      if (!info.exists) throw new Error(`Downloaded file is missing: ${file.path}`)
      hashes[file.path] = sha256
      bytes += info.size
      completedBytes += file.bytes
    }

    const lastFile = model.files[model.files.length - 1]
    emit(lastFile, model.files.length - 1, 'finalizing', '')
    await replaceDownloadedModelDirectory(model.id, tempDirectory, finalDirectory)

    const record: LocalEmbeddingModelRecord = {
      modelId: model.id,
      source: 'downloaded',
      downloadedAt: Date.now(),
      verifiedAt: Date.now(),
      bytes,
      sha256: hashes,
    }
    const state = await loadLocalModelState()
    state.records[model.id] = record
    delete state.failed[model.id]
    await saveLocalModelState(state)
    return record
  } catch (error) {
    await FileSystem.deleteAsync(tempDirectory, { idempotent: true }).catch(() => undefined)
    const message = errorMessage(error)
    await markLocalEmbeddingModelFailure(model.id, message)
    throw error
  }
}

export async function verifyLocalEmbeddingModel(modelId: string, source: LocalEmbeddingModelSource): Promise<boolean> {
  const model = getLocalEmbeddingModel(modelId)
  if (!model) return false
  if (source === 'bundled') return isModelBundled(model.id) && Platform.OS === 'android'
  for (const file of model.files) {
    const uri = modelFileUri(model.id, file.path, 'downloaded')
    const info = await FileSystem.getInfoAsync(uri)
    if (!info.exists || info.size !== file.bytes) return false
    const sha256 = await sha256File(uri)
    if (sha256 !== file.sha256) return false
  }
  return true
}

export async function deleteDownloadedLocalEmbeddingModel(modelId: string): Promise<void> {
  const state = await loadLocalModelState()
  await FileSystem.deleteAsync(modelDirectory(modelId), { idempotent: true })
  delete state.records[modelId]
  delete state.failed[modelId]
  await saveLocalModelState(state)
}

export async function resolveActiveLocalEmbeddingModel(settings: Settings): Promise<{ model: LocalEmbeddingModel; source: LocalEmbeddingModelSource; directoryUri: string } | null> {
  const requested = getLocalEmbeddingModel(settings.localEmbeddingModelId)
  if (requested && settings.localEmbeddingModelSource && settings.localEmbeddingModelSource !== 'none') {
    const source = settings.localEmbeddingModelSource
    if (await verifyLocalEmbeddingModel(requested.id, source)) {
      return { model: requested, source, directoryUri: modelDirectory(requested.id, source) }
    }
  }

  const state = await loadLocalModelState()
  for (const model of LOCAL_EMBEDDING_MODELS) {
    if (state.records[model.id]?.source === 'downloaded' && await verifyLocalEmbeddingModel(model.id, 'downloaded')) {
      return { model, source: 'downloaded', directoryUri: modelDirectory(model.id, 'downloaded') }
    }
  }
  for (const modelId of BUNDLED_LOCAL_EMBEDDING_MODELS) {
    const model = getLocalEmbeddingModel(modelId)
    if (model && isModelBundled(model.id)) {
      return { model, source: 'bundled', directoryUri: modelDirectory(model.id, 'bundled') }
    }
  }
  return null
}

export async function markLocalEmbeddingModelFailure(modelId: string, message: string): Promise<void> {
  const state = await loadLocalModelState()
  state.failed[modelId] = message
  await saveLocalModelState(state)
}

export function localModelCacheKey(settings: Pick<Settings, 'localEmbeddingModelId' | 'localEmbeddingModelSource'>): string {
  const id = settings.localEmbeddingModelId ?? 'auto'
  const source = settings.localEmbeddingModelSource ?? 'none'
  const bundled = BUNDLED_LOCAL_EMBEDDING_MODELS.join(',')
  return `local:${source}:${id}:bundled:${bundled}`
}

function isModelBundled(modelId: string): boolean {
  return BUNDLED_LOCAL_EMBEDDING_MODELS.includes(modelId)
}

function requireModel(modelId: string): LocalEmbeddingModel {
  const model = getLocalEmbeddingModel(modelId)
  if (!model) throw new Error(`Unknown local embedding model: ${modelId}`)
  return model
}

async function loadLocalModelState(): Promise<LocalEmbeddingModelState> {
  if (cachedState) return cachedState
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    cachedState = {
      records: parsed && typeof parsed.records === 'object' ? parsed.records : {},
      failed: parsed && typeof parsed.failed === 'object' ? parsed.failed : {},
    }
  } catch {
    cachedState = { records: {}, failed: {} }
  }
  return cachedState
}

async function saveLocalModelState(state: LocalEmbeddingModelState): Promise<void> {
  cachedState = state
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function modelDirectory(modelId: string, source: LocalEmbeddingModelSource = 'downloaded'): string {
  if (source === 'bundled') return `${BUNDLED_ASSET_ROOT}${modelId}/`
  return `${MODEL_ROOT}${modelId}/`
}

function tempModelDirectory(modelId: string): string {
  return `${MODEL_ROOT}${modelId}.tmp-${Date.now()}/`
}

function backupModelDirectory(modelId: string): string {
  return `${MODEL_ROOT}${modelId}.bak-${Date.now()}/`
}

function modelFileUri(modelId: string, relativePath: string, source: LocalEmbeddingModelSource): string {
  return `${modelDirectory(modelId, source)}${relativePath}`
}

function tempModelFileUri(modelId: string, relativePath: string, tempDirectory: string): string {
  void modelId
  return `${tempDirectory}${relativePath}`
}

function parentDirectory(uri: string): string {
  return uri.slice(0, uri.lastIndexOf('/') + 1)
}

async function downloadAndVerifyFile({
  model,
  file,
  index,
  targetUri,
  sourceUrl,
  emit,
}: {
  model: LocalEmbeddingModel
  file: LocalEmbeddingModelFile
  index: number
  targetUri: string
  sourceUrl: string
  emit: (file: LocalEmbeddingModelFile, index: number, stage: LocalEmbeddingDownloadStage, sourceUrl: string, fileBytesWritten?: number) => void
}): Promise<string> {
  void model
  const download = FileSystem.createDownloadResumable(
    sourceUrl,
    targetUri,
    {},
    (progress) => {
      emit(file, index, 'downloading', sourceUrl, progress.totalBytesWritten)
    }
  )
  const result = await download.downloadAsync()
  if (!result) throw new Error(`Download cancelled: ${file.path}`)
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Download failed: HTTP ${result.status} (${file.path})`)
  }
  emit(file, index, 'verifying', sourceUrl, file.bytes)
  const info = await FileSystem.getInfoAsync(targetUri)
  if (!info.exists || info.size !== file.bytes) {
    throw new Error(`Downloaded file size mismatch: ${file.path}`)
  }
  const sha256 = await sha256File(targetUri)
  if (sha256 !== file.sha256) {
    throw new Error(`Downloaded file checksum mismatch: ${file.path}`)
  }
  return sha256
}

function modelFileDownloadUrl(baseUrl: string, filePath: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${filePath.replace(/^\/+/, '')}`
}

function normalizeMirrorBaseUrl(url: string | undefined): string | undefined {
  const value = url?.trim()
  if (!value) return undefined
  return value.replace(/\/+$/, '')
}

function mirrorModelFileUrl(officialBaseUrl: string, mirrorBaseUrl: string, filePath: string): string {
  try {
    const official = new URL(officialBaseUrl)
    const officialPath = official.pathname.replace(/^\/+|\/+$/g, '')
    const path = official.hostname.includes('huggingface.co')
      ? officialPath
      : `${official.hostname}/${officialPath}`.replace(/\/+$/g, '')
    return `${mirrorBaseUrl}/${path}/${filePath.replace(/^\/+/, '')}`
  } catch {
    return `${mirrorBaseUrl}/${filePath.replace(/^\/+/, '')}`
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function replaceDownloadedModelDirectory(modelId: string, tempDirectory: string, finalDirectory: string): Promise<void> {
  const backupDirectory = backupModelDirectory(modelId)
  const finalInfo = await FileSystem.getInfoAsync(finalDirectory)
  try {
    if (finalInfo.exists) {
      await FileSystem.moveAsync({ from: finalDirectory, to: backupDirectory })
    }
    await FileSystem.moveAsync({ from: tempDirectory, to: finalDirectory })
    await FileSystem.deleteAsync(backupDirectory, { idempotent: true })
  } catch (error) {
    await FileSystem.deleteAsync(finalDirectory, { idempotent: true }).catch(() => undefined)
    const backupInfo = await FileSystem.getInfoAsync(backupDirectory)
    if (backupInfo.exists) {
      await FileSystem.moveAsync({ from: backupDirectory, to: finalDirectory }).catch(() => undefined)
    }
    throw error
  }
}

async function ensureDirectory(uri: string): Promise<void> {
  if (!uri.startsWith('file://')) return
  await FileSystem.makeDirectoryAsync(uri, { intermediates: true })
}

async function sha256File(uri: string): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 })
  const bytes = base64ToBytes(base64)
  const payload = new Uint8Array(new ArrayBuffer(bytes.byteLength))
  payload.set(bytes)
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, payload)
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function base64ToBytes(base64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, '')
  const output: number[] = []
  for (let index = 0; index < clean.length; index += 4) {
    const a = chars.indexOf(clean[index])
    const b = chars.indexOf(clean[index + 1])
    const c = clean[index + 2] === '=' ? -1 : chars.indexOf(clean[index + 2])
    const d = clean[index + 3] === '=' ? -1 : chars.indexOf(clean[index + 3])
    if (a < 0 || b < 0) continue
    output.push((a << 2) | (b >> 4))
    if (c >= 0) output.push(((b & 15) << 4) | (c >> 2))
    if (d >= 0 && c >= 0) output.push(((c & 3) << 6) | d)
  }
  return new Uint8Array(output)
}
