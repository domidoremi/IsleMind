import * as FileSystem from 'expo-file-system/legacy'
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
const SHA256_READ_CHUNK_BYTES = 1024 * 1024

const typedCatalog = catalog as {
  models: LocalEmbeddingModel[]
}

export const LOCAL_EMBEDDING_MODELS: LocalEmbeddingModel[] = typedCatalog.models
export const LOCAL_RAG_MODEL_CAPABILITIES: LocalRagModelCapability[] = ['embedding', 'reranker', 'colbert', 'compressor']

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]

let cachedState: LocalEmbeddingModelState | null = null

export function sha256BytesForTest(bytes: Uint8Array): string {
  const digest = new Sha256Digest()
  digest.update(bytes)
  return digest.finalize()
}

export function sha256ChunksForTest(chunks: Uint8Array[]): string {
  const digest = new Sha256Digest()
  chunks.forEach((chunk) => digest.update(chunk))
  return digest.finalize()
}

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

export async function sha256File(uri: string): Promise<string> {
  const info = await FileSystem.getInfoAsync(uri)
  if (!info.exists) throw new Error(`Downloaded file is missing: ${uri}`)
  const digest = new Sha256Digest()
  for (let position = 0; position < info.size; position += SHA256_READ_CHUNK_BYTES) {
    const length = Math.min(SHA256_READ_CHUNK_BYTES, info.size - position)
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
      position,
      length,
    })
    digest.update(base64ToBytes(base64))
  }
  return digest.finalize()
}

class Sha256Digest {
  private readonly h = new Uint32Array([
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19,
  ])
  private readonly buffer = new Uint8Array(64)
  private bufferLength = 0
  private bytesHashed = 0
  private finished = false

  update(bytes: Uint8Array): void {
    if (this.finished) throw new Error('SHA-256 digest is already finalized.')
    let offset = 0
    this.bytesHashed += bytes.length
    if (this.bufferLength > 0) {
      const needed = Math.min(64 - this.bufferLength, bytes.length)
      this.buffer.set(bytes.subarray(0, needed), this.bufferLength)
      this.bufferLength += needed
      offset += needed
      if (this.bufferLength === 64) {
        this.processBlock(this.buffer)
        this.bufferLength = 0
      }
    }
    for (; offset + 64 <= bytes.length; offset += 64) {
      this.processBlock(bytes.subarray(offset, offset + 64))
    }
    if (offset < bytes.length) {
      this.buffer.set(bytes.subarray(offset), 0)
      this.bufferLength = bytes.length - offset
    }
  }

  finalize(): string {
    if (this.finished) throw new Error('SHA-256 digest is already finalized.')
    this.finished = true
    const bitLengthHigh = Math.floor(this.bytesHashed / 0x20000000)
    const bitLengthLow = (this.bytesHashed << 3) >>> 0
    this.buffer[this.bufferLength] = 0x80
    this.buffer.fill(0, this.bufferLength + 1)
    if (this.bufferLength >= 56) {
      this.processBlock(this.buffer)
      this.buffer.fill(0)
    }
    this.buffer[56] = (bitLengthHigh >>> 24) & 0xff
    this.buffer[57] = (bitLengthHigh >>> 16) & 0xff
    this.buffer[58] = (bitLengthHigh >>> 8) & 0xff
    this.buffer[59] = bitLengthHigh & 0xff
    this.buffer[60] = (bitLengthLow >>> 24) & 0xff
    this.buffer[61] = (bitLengthLow >>> 16) & 0xff
    this.buffer[62] = (bitLengthLow >>> 8) & 0xff
    this.buffer[63] = bitLengthLow & 0xff
    this.processBlock(this.buffer)
    return Array.from(this.h).map((word) => word.toString(16).padStart(8, '0')).join('')
  }

  private processBlock(block: Uint8Array): void {
    const w = new Uint32Array(64)
    for (let index = 0; index < 16; index += 1) {
      const base = index * 4
      w[index] = ((block[base] << 24) | (block[base + 1] << 16) | (block[base + 2] << 8) | block[base + 3]) >>> 0
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotateRight(w[index - 15], 7) ^ rotateRight(w[index - 15], 18) ^ (w[index - 15] >>> 3)
      const s1 = rotateRight(w[index - 2], 17) ^ rotateRight(w[index - 2], 19) ^ (w[index - 2] >>> 10)
      w[index] = (w[index - 16] + s0 + w[index - 7] + s1) >>> 0
    }

    let a = this.h[0]
    let b = this.h[1]
    let c = this.h[2]
    let d = this.h[3]
    let e = this.h[4]
    let f = this.h[5]
    let g = this.h[6]
    let h = this.h[7]

    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (h + s1 + ch + SHA256_K[index] + w[index]) >>> 0
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (s0 + maj) >>> 0
      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }

    this.h[0] = (this.h[0] + a) >>> 0
    this.h[1] = (this.h[1] + b) >>> 0
    this.h[2] = (this.h[2] + c) >>> 0
    this.h[3] = (this.h[3] + d) >>> 0
    this.h[4] = (this.h[4] + e) >>> 0
    this.h[5] = (this.h[5] + f) >>> 0
    this.h[6] = (this.h[6] + g) >>> 0
    this.h[7] = (this.h[7] + h) >>> 0
  }
}

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits))
}

function base64ToBytes(base64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, '')
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0
  const output = new Uint8Array(Math.max(0, Math.floor((clean.length * 3) / 4) - padding))
  let offset = 0
  for (let index = 0; index < clean.length; index += 4) {
    const a = chars.indexOf(clean[index])
    const b = chars.indexOf(clean[index + 1])
    const c = clean[index + 2] === '=' ? -1 : chars.indexOf(clean[index + 2])
    const d = clean[index + 3] === '=' ? -1 : chars.indexOf(clean[index + 3])
    if (a < 0 || b < 0) continue
    if (offset < output.length) output[offset++] = (a << 2) | (b >> 4)
    if (c >= 0 && offset < output.length) output[offset++] = ((b & 15) << 4) | (c >> 2)
    if (d >= 0 && c >= 0 && offset < output.length) output[offset++] = ((c & 3) << 6) | d
  }
  return offset === output.length ? output : output.subarray(0, offset)
}
