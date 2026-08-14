export interface LocalModelFileInfo {
  exists: boolean
  size: number
}

export interface LocalModelFileIntegrityPort {
  getInfo(uri: string, signal?: AbortSignal): Promise<LocalModelFileInfo>
  sha256File(uri: string, signal?: AbortSignal): Promise<string>
}

export interface LocalModelArtifactFile {
  uri: string
  bytes: number
  sha256: string
}

export interface LocalModelFileIntegrityPolicy {
  verifyFile(file: LocalModelArtifactFile, signal?: AbortSignal): Promise<boolean>
  verifyFiles(files: readonly LocalModelArtifactFile[], signal?: AbortSignal): Promise<boolean>
}

export function createLocalModelFileIntegrityPolicy(
  port: LocalModelFileIntegrityPort,
): LocalModelFileIntegrityPolicy {
  async function verifyFile(file: LocalModelArtifactFile, signal?: AbortSignal): Promise<boolean> {
    throwIfAborted(signal)
    const info = await port.getInfo(file.uri, signal)
    throwIfAborted(signal)
    if (!info.exists || info.size !== file.bytes) return false
    const sha256 = await port.sha256File(file.uri, signal)
    throwIfAborted(signal)
    return sha256 === file.sha256
  }

  async function verifyFiles(
    files: readonly LocalModelArtifactFile[],
    signal?: AbortSignal,
  ): Promise<boolean> {
    for (const file of files) {
      if (!await verifyFile(file, signal)) return false
    }
    return true
  }

  return { verifyFile, verifyFiles }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  throw error
}
