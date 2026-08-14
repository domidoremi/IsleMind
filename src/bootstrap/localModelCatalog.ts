import { Platform } from 'react-native'

import catalog from '../../assets/models/catalog.json'
import { BUNDLED_LOCAL_EMBEDDING_MODELS } from '@/generated/modelBundle'
import {
  createLocalEmbeddingModelCatalogPolicy,
  type LocalEmbeddingModel,
  type LocalEmbeddingModelPreference,
  type LocalEmbeddingModelSelection,
  type LocalEmbeddingModelSource,
} from '@/modules/knowledge'
import { verifyLocalModelFiles } from '@/bootstrap/localModelFileIntegrity'
import { LOCAL_MODEL_ROOT_DIRECTORY } from '@/bootstrap/localModelArtifactInstaller'
import { localModelStateRepository } from '@/bootstrap/localModelStateRepository'

const BUNDLED_ASSET_ROOT = Platform.OS === 'android' ? 'asset:///islemind-models/' : ''
const bundledModelIds = new Set(BUNDLED_LOCAL_EMBEDDING_MODELS)

export const localEmbeddingModelCatalogPolicy = createLocalEmbeddingModelCatalogPolicy({
  catalog,
  bundledModelIds: BUNDLED_LOCAL_EMBEDDING_MODELS,
  stateRepository: localModelStateRepository,
  availability: {
    verify: verifyCatalogModel,
  },
})

export const localEmbeddingModels = localEmbeddingModelCatalogPolicy.models
export const localRagModelCapabilities = localEmbeddingModelCatalogPolicy.capabilities

export function localEmbeddingModelDirectory(
  modelId: string,
  source: LocalEmbeddingModelSource = 'downloaded',
): string {
  if (source === 'bundled') return `${BUNDLED_ASSET_ROOT}${modelId}/`
  return `${LOCAL_MODEL_ROOT_DIRECTORY}${modelId}/`
}

export function localEmbeddingModelFileUri(
  modelId: string,
  relativePath: string,
  source: LocalEmbeddingModelSource,
): string {
  return `${localEmbeddingModelDirectory(modelId, source)}${relativePath}`
}

export function verifyConfiguredLocalEmbeddingModel(
  modelId: string,
  source: LocalEmbeddingModelSource,
  signal?: AbortSignal,
): Promise<boolean> {
  const model = localEmbeddingModelCatalogPolicy.getModel(modelId)
  if (!model) return Promise.resolve(false)
  return verifyCatalogModel(model, source, signal)
}

export async function resolveConfiguredLocalEmbeddingModel(
  preference: LocalEmbeddingModelPreference,
  signal?: AbortSignal,
): Promise<(LocalEmbeddingModelSelection & { directoryUri: string }) | null> {
  const selected = await localEmbeddingModelCatalogPolicy.resolveActiveModel(preference, { signal })
  return selected
    ? { ...selected, directoryUri: localEmbeddingModelDirectory(selected.model.id, selected.source) }
    : null
}

async function verifyCatalogModel(
  model: LocalEmbeddingModel,
  source: LocalEmbeddingModelSource,
  signal?: AbortSignal,
): Promise<boolean> {
  throwIfAborted(signal)
  if (source === 'bundled') {
    return Platform.OS === 'android' && bundledModelIds.has(model.id)
  }
  return verifyLocalModelFiles(model.files.map((file) => ({
    uri: localEmbeddingModelFileUri(model.id, file.path, source),
    bytes: file.bytes,
    sha256: file.sha256,
  })), signal)
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  const error = new Error('The local-model catalog operation was aborted.')
  error.name = 'AbortError'
  throw error
}
