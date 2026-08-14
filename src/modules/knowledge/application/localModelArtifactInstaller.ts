import type {
  LocalModelFileInfo,
  LocalModelFileIntegrityPort,
} from './localModelFileIntegrity'

export type LocalModelDownloadStage = 'preparing' | 'downloading' | 'verifying' | 'retrying' | 'finalizing'

export interface LocalModelArtifactFileDescriptor {
  path: string
  bytes: number
  sha256: string
}

export interface LocalModelArtifactDescriptor {
  id: string
  name: string
  sizeBytes: number
  downloadBaseUrl: string
  files: readonly LocalModelArtifactFileDescriptor[]
}

export interface LocalModelDownloadProgress {
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
  stage: LocalModelDownloadStage
  sourceUrl: string
}

export interface LocalModelArtifactDownloadResult {
  status: number
}

export interface LocalModelArtifactInstallerPort extends LocalModelFileIntegrityPort {
  ensureDirectory(uri: string, signal?: AbortSignal): Promise<void>
  listDirectory(uri: string, signal?: AbortSignal): Promise<string[]>
  delete(uri: string, signal?: AbortSignal): Promise<void>
  move(from: string, to: string, signal?: AbortSignal): Promise<void>
  download(
    sourceUrl: string,
    targetUri: string,
    onProgress: (bytesWritten: number) => void,
    signal?: AbortSignal,
  ): Promise<LocalModelArtifactDownloadResult | null>
}

export interface LocalModelArtifactInstallOptions {
  rootDirectory: string
  mirrorBaseUrl?: string
  onProgress?(progress: LocalModelDownloadProgress): void
  signal?: AbortSignal
}

export interface LocalModelArtifactInstallResult {
  modelId: string
  directoryUri: string
  bytes: number
  sha256: Record<string, string>
}

export interface LocalModelArtifactInstallerDependencies {
  now?(): number
}

export interface LocalModelArtifactInstaller {
  install(
    model: LocalModelArtifactDescriptor,
    options: LocalModelArtifactInstallOptions,
  ): Promise<LocalModelArtifactInstallResult>
  cleanupStaleDirectories(modelId: string, rootDirectory: string, signal?: AbortSignal): Promise<void>
  deleteInstalledModel(modelId: string, rootDirectory: string, signal?: AbortSignal): Promise<void>
}

export function createLocalModelArtifactInstaller(
  port: LocalModelArtifactInstallerPort,
  dependencies: LocalModelArtifactInstallerDependencies = {},
): LocalModelArtifactInstaller {
  const now = dependencies.now ?? Date.now

  async function install(
    model: LocalModelArtifactDescriptor,
    options: LocalModelArtifactInstallOptions,
  ): Promise<LocalModelArtifactInstallResult> {
    if (!model.files.length || model.sizeBytes <= 0) {
      throw new Error(`Model ${model.id} is listed as an optional capability, but downloadable files are not packaged in this catalog yet.`)
    }
    if (!options.rootDirectory) throw new Error('File storage is unavailable.')
    throwIfAborted(options.signal)
    await port.ensureDirectory(options.rootDirectory, options.signal)
    await cleanupStaleDirectories(model.id, options.rootDirectory, options.signal)
    const temporaryDirectory = `${options.rootDirectory}${model.id}.tmp-${now()}/`
    const finalDirectory = `${options.rootDirectory}${model.id}/`
    await port.delete(temporaryDirectory, options.signal)
    await port.ensureDirectory(temporaryDirectory, options.signal)
    const hashes: Record<string, string> = {}
    let bytes = 0
    let completedBytes = 0
    const totalBytes = model.files.reduce((total, file) => total + file.bytes, 0)
    const mirrorBaseUrl = normalizeLocalModelMirrorBaseUrl(options.mirrorBaseUrl)

    function emit(
      file: LocalModelArtifactFileDescriptor,
      index: number,
      stage: LocalModelDownloadStage,
      sourceUrl: string,
      fileBytesWritten = 0,
    ): void {
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
        throwIfAborted(options.signal)
        const targetUri = `${temporaryDirectory}${file.path}`
        await port.ensureDirectory(parentDirectory(targetUri), options.signal)
        const officialUrl = buildLocalModelDownloadUrl(model.downloadBaseUrl, file.path)
        emit(file, index, 'preparing', officialUrl)
        let sha256: string
        try {
          sha256 = await downloadAndVerifyFile(file, index, targetUri, officialUrl, emit, options.signal)
        } catch (officialError) {
          throwIfAborted(options.signal)
          if (!mirrorBaseUrl) throw officialError
          const mirrorUrl = buildLocalModelMirrorUrl(model.downloadBaseUrl, mirrorBaseUrl, file.path)
          await port.delete(targetUri, options.signal)
          emit(file, index, 'retrying', mirrorUrl)
          try {
            sha256 = await downloadAndVerifyFile(file, index, targetUri, mirrorUrl, emit, options.signal)
          } catch (mirrorError) {
            throwIfAborted(options.signal)
            throw new Error(`${errorMessage(mirrorError)}; official source also failed: ${errorMessage(officialError)}`)
          }
        }
        const info = await port.getInfo(targetUri, options.signal)
        if (!info.exists) throw new Error(`Downloaded file is missing: ${file.path}`)
        hashes[file.path] = sha256
        bytes += info.size
        completedBytes += file.bytes
      }

      const lastFile = model.files[model.files.length - 1]
      emit(lastFile, model.files.length - 1, 'finalizing', '')
      await replaceStagedDirectory(model.id, options.rootDirectory, temporaryDirectory, finalDirectory, options.signal)
      return {
        modelId: model.id,
        directoryUri: finalDirectory,
        bytes,
        sha256: hashes,
      }
    } catch (error) {
      await port.delete(temporaryDirectory).catch(() => undefined)
      throw error
    }
  }

  async function downloadAndVerifyFile(
    file: LocalModelArtifactFileDescriptor,
    index: number,
    targetUri: string,
    sourceUrl: string,
    emit: (
      file: LocalModelArtifactFileDescriptor,
      index: number,
      stage: LocalModelDownloadStage,
      sourceUrl: string,
      fileBytesWritten?: number,
    ) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    throwIfAborted(signal)
    const result = await port.download(
      sourceUrl,
      targetUri,
      (bytesWritten) => emit(file, index, 'downloading', sourceUrl, bytesWritten),
      signal,
    )
    throwIfAborted(signal)
    if (!result) throw new Error(`Download cancelled: ${file.path}`)
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`Download failed: HTTP ${result.status} (${file.path})`)
    }
    emit(file, index, 'verifying', sourceUrl, file.bytes)
    const info = await port.getInfo(targetUri, signal)
    if (!info.exists || info.size !== file.bytes) {
      throw new Error(`Downloaded file size mismatch: ${file.path}`)
    }
    const sha256 = await port.sha256File(targetUri, signal)
    if (sha256 !== file.sha256) {
      throw new Error(`Downloaded file checksum mismatch: ${file.path}`)
    }
    return sha256
  }

  async function replaceStagedDirectory(
    modelId: string,
    rootDirectory: string,
    temporaryDirectory: string,
    finalDirectory: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const backupDirectory = `${rootDirectory}${modelId}.bak-${now()}/`
    const finalInfo = await port.getInfo(finalDirectory, signal)
    try {
      throwIfAborted(signal)
      if (finalInfo.exists) {
        await port.move(finalDirectory, backupDirectory, signal)
      }
      throwIfAborted(signal)
      await port.move(temporaryDirectory, finalDirectory, signal)
      throwIfAborted(signal)
      await port.delete(backupDirectory, signal)
    } catch (error) {
      await port.delete(finalDirectory).catch(() => undefined)
      const backupInfo = await port.getInfo(backupDirectory)
      if (backupInfo.exists) {
        await port.move(backupDirectory, finalDirectory).catch(() => undefined)
      }
      throw error
    }
  }

  async function cleanupStaleDirectories(
    modelId: string,
    rootDirectory: string,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!rootDirectory.startsWith('file://')) return
    throwIfAborted(signal)
    let entries: string[] = []
    try {
      entries = await port.listDirectory(rootDirectory, signal)
    } catch {
      throwIfAborted(signal)
      return
    }
    const staleNames = entries.filter((name) => isStaleLocalModelDirectoryName(modelId, name))
    await Promise.all(staleNames.map(async (name) => {
      try {
        await port.delete(`${rootDirectory}${name}`, signal)
      } catch {
        throwIfAborted(signal)
      }
    }))
  }

  async function deleteInstalledModel(
    modelId: string,
    rootDirectory: string,
    signal?: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal)
    await port.delete(`${rootDirectory}${modelId}/`, signal)
    await cleanupStaleDirectories(modelId, rootDirectory, signal)
  }

  return { install, cleanupStaleDirectories, deleteInstalledModel }
}

export function buildLocalModelDownloadUrl(baseUrl: string, filePath: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${filePath.replace(/^\/+/, '')}`
}

export function normalizeLocalModelMirrorBaseUrl(url: string | undefined): string | undefined {
  const value = url?.trim()
  if (!value) return undefined
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    if (parsed.username || parsed.password) return undefined
    return value.replace(/\/+$/, '')
  } catch {
    return undefined
  }
}

export function buildLocalModelMirrorUrl(
  officialBaseUrl: string,
  mirrorBaseUrl: string,
  filePath: string,
): string {
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

export function isStaleLocalModelDirectoryName(modelId: string, entryName: string): boolean {
  return entryName.startsWith(`${modelId}.tmp-`) || entryName.startsWith(`${modelId}.bak-`)
}

function parentDirectory(uri: string): string {
  return uri.slice(0, uri.lastIndexOf('/') + 1)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  throw error
}
