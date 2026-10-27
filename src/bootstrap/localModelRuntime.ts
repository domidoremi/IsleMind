import {
  deleteInstalledLocalModelArtifacts,
  installLocalModelArtifacts,
} from '@/bootstrap/localModelArtifactInstaller'
import { snapshotPlainData } from '@/core/plainDataSnapshot'
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
  type LocalModelStateRecoveryReview,
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

export async function reviewLocalEmbeddingModelStateRecovery(
  signal?: AbortSignal,
): Promise<LocalModelStateRecoveryReview | null> {
  throwIfAborted(signal)
  try {
    const review = await localModelStateRepository.reviewInvalidState({ signal })
    throwIfAborted(signal)
    return review
  } catch (error) {
    throwIfAborted(signal)
    throw error
  }
}

export async function downloadLocalEmbeddingModel(
  modelId: string,
  options: LocalEmbeddingDownloadOptions = {},
): Promise<LocalEmbeddingModelRecord> {
  const operationOptions = { ...options }
  throwIfAborted(operationOptions.signal)
  const model = snapshotPlainData(localEmbeddingModelCatalogPolicy.requireModel(modelId))
  await localModelStateRepository.loadState({ signal: operationOptions.signal })
  throwIfAborted(operationOptions.signal)
  try {
    const installed = await installLocalModelArtifacts(model, operationOptions)
    throwIfAborted(operationOptions.signal)
    const record: LocalEmbeddingModelRecord = {
      modelId: model.id,
      source: 'downloaded',
      downloadedAt: Date.now(),
      verifiedAt: Date.now(),
      bytes: installed.bytes,
      sha256: installed.sha256,
    }
    await localModelStateRepository.recordInstalledModel(record, { signal: operationOptions.signal })
    return record
  } catch (error) {
    throwIfAborted(operationOptions.signal)
    try {
      await markLocalEmbeddingModelFailure(model.id, errorMessage(error), operationOptions.signal)
    } catch {
      // A diagnostic write cannot replace the failure that stopped installation.
      throwIfAborted(operationOptions.signal)
    }
    throw error
  }
}

export async function deleteDownloadedLocalEmbeddingModel(
  modelId: string,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal)
  await localModelStateRepository.loadState({ signal })
  throwIfAborted(signal)
  const { releaseOnnxEmbeddingResources } = await import('./knowledgeEmbeddingProvider')
  throwIfAborted(signal)
  await releaseOnnxEmbeddingResources()
  throwIfAborted(signal)
  await deleteInstalledLocalModelArtifacts(modelId, signal)
  throwIfAborted(signal)
  await localModelStateRepository.removeModel(modelId, { signal })
}

export async function clearLocalEmbeddingModelState(signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  const { releaseOnnxEmbeddingResources } = await import('./knowledgeEmbeddingProvider')
  throwIfAborted(signal)
  await releaseOnnxEmbeddingResources()
  throwIfAborted(signal)
  await localModelStateRepository.clear({ signal })
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
