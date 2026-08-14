import * as FileSystem from 'expo-file-system/legacy'
import {
  createExpoLocalModelFileIntegrityPort,
  type ExpoLocalModelFileSystem,
  type LocalModelFileIntegrityPort,
} from './expoLocalModelFileIntegrity'

/** Minimal download result contract consumed by the knowledge installer. */
export interface LocalModelArtifactDownloadResult {
  status: number
}

/** Structural installer port implemented by this Expo adapter. */
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

export interface ExpoLocalModelArtifactFileSystem extends ExpoLocalModelFileSystem {
  makeDirectoryAsync(uri: string, options: { intermediates: boolean }): Promise<unknown>
  readDirectoryAsync(uri: string): Promise<string[]>
  deleteAsync(uri: string, options: { idempotent: boolean }): Promise<unknown>
  moveAsync(options: { from: string; to: string }): Promise<unknown>
  createDownloadResumable(
    sourceUrl: string,
    targetUri: string,
    options: Record<string, unknown>,
    onProgress: (progress: { totalBytesWritten: number }) => void,
  ): {
    downloadAsync(): Promise<{ status: number } | null | undefined>
    pauseAsync?(): Promise<unknown>
  }
}

export function createExpoLocalModelArtifactInstallerPort(
  fileSystem: ExpoLocalModelArtifactFileSystem = FileSystem as unknown as ExpoLocalModelArtifactFileSystem,
): LocalModelArtifactInstallerPort {
  const integrity = createExpoLocalModelFileIntegrityPort(fileSystem)

  async function ensureDirectory(uri: string, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    if (!uri.startsWith('file://')) return
    await fileSystem.makeDirectoryAsync(uri, { intermediates: true })
    throwIfAborted(signal)
  }

  async function listDirectory(uri: string, signal?: AbortSignal): Promise<string[]> {
    throwIfAborted(signal)
    const entries = await fileSystem.readDirectoryAsync(uri)
    throwIfAborted(signal)
    return entries
  }

  async function deleteUri(uri: string, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    await fileSystem.deleteAsync(uri, { idempotent: true })
  }

  async function move(from: string, to: string, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    await fileSystem.moveAsync({ from, to })
  }

  async function download(
    sourceUrl: string,
    targetUri: string,
    onProgress: (bytesWritten: number) => void,
    signal?: AbortSignal,
  ): Promise<LocalModelArtifactDownloadResult | null> {
    throwIfAborted(signal)
    const resumable = fileSystem.createDownloadResumable(
      sourceUrl,
      targetUri,
      {},
      (progress) => {
        if (!signal?.aborted) onProgress(progress.totalBytesWritten)
      },
    )
    const abort = () => {
      void resumable.pauseAsync?.().catch(() => undefined)
    }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const result = await resumable.downloadAsync()
      throwIfAborted(signal)
      return result ? { status: result.status } : null
    } finally {
      signal?.removeEventListener('abort', abort)
    }
  }

  return {
    ...integrity,
    ensureDirectory,
    listDirectory,
    delete: deleteUri,
    move,
    download,
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  throw error
}
