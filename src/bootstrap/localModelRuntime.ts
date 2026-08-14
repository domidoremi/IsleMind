import {
  deleteInstalledLocalModelArtifacts,
  installLocalModelArtifacts,
} from '@/bootstrap/localModelArtifactInstaller'
import {
  localEmbeddingModelCatalogPolicy,
  localEmbeddingModels,
  localRagModelCapabilities,
  resolveConfiguredLocalEmbeddingModel,
} from '@/bootstrap/localModelCatalog'
import { localModelStateRepository } from '@/bootstrap/localModelStateRepository'
import {
  formatLocalModelBytes,
  type LocalEmbeddingModel,
  type LocalEmbeddingModelPreference,
  type LocalEmbeddingModelSource,
  type LocalEmbeddingModelStatus,
  type LocalEmbeddingModelView,
  type LocalEmbeddingTokenizer,
  type LocalModelDownloadProgress,
  type LocalModelStateRecord,
} from '@/modules/knowledge'

export type {
  LocalEmbeddingModel,
  LocalEmbeddingModelSource,
  LocalEmbeddingModelStatus,
  LocalEmbeddingModelView,
  LocalEmbeddingTokenizer,
} from '@/modules/knowledge'

export type LocalEmbeddingModelRecord = LocalModelStateRecord
export type LocalEmbeddingDownloadProgress = LocalModelDownloadProgress

export interface LocalEmbeddingDownloadOptions {
  mirrorBaseUrl?: string
  onProgress?: (progress: LocalEmbeddingDownloadProgress) => void
  signal?: AbortSignal
}

export const LOCAL_EMBEDDING_MODELS = localEmbeddingModels
export const LOCAL_RAG_MODEL_CAPABILITIES = localRagModelCapabilities

export function formatModelBytes(bytes: number): string {
  return formatLocalModelBytes(bytes)
}

export function listLocalEmbeddingModelViews(
  preference: LocalEmbeddingModelPreference,
  signal?: AbortSignal,
): Promise<LocalEmbeddingModelView[]> {
  return localEmbeddingModelCatalogPolicy.listModelViews(preference, { signal })
}

export async function downloadLocalEmbeddingModel(
  modelId: string,
  options: LocalEmbeddingDownloadOptions = {},
): Promise<LocalEmbeddingModelRecord> {
  const model = localEmbeddingModelCatalogPolicy.requireModel(modelId)
  try {
    const installed = await installLocalModelArtifacts(model, options)
    const record: LocalEmbeddingModelRecord = {
      modelId: model.id,
      source: 'downloaded',
      downloadedAt: Date.now(),
      verifiedAt: Date.now(),
      bytes: installed.bytes,
      sha256: installed.sha256,
    }
    await localModelStateRepository.recordInstalledModel(record, { signal: options.signal })
    return record
  } catch (error) {
    throwIfAborted(options.signal)
    await markLocalEmbeddingModelFailure(model.id, errorMessage(error), options.signal)
    throw error
  }
}

export async function deleteDownloadedLocalEmbeddingModel(
  modelId: string,
  signal?: AbortSignal,
): Promise<void> {
  await deleteInstalledLocalModelArtifacts(modelId, signal)
  await localModelStateRepository.removeModel(modelId, { signal })
}

export function clearLocalEmbeddingModelState(signal?: AbortSignal): Promise<void> {
  return localModelStateRepository.clear({ signal })
}

export function resolveActiveLocalEmbeddingModel(
  preference: LocalEmbeddingModelPreference,
  signal?: AbortSignal,
): Promise<{ model: LocalEmbeddingModel; source: LocalEmbeddingModelSource; directoryUri: string } | null> {
  return resolveConfiguredLocalEmbeddingModel(preference, signal)
}

export function markLocalEmbeddingModelFailure(
  modelId: string,
  message: string,
  signal?: AbortSignal,
): Promise<void> {
  return localModelStateRepository.markModelFailure(modelId, message, { signal })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  const error = new Error('The local-model operation was aborted.')
  error.name = 'AbortError'
  throw error
}
