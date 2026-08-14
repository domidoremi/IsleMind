import * as FileSystem from 'expo-file-system/legacy'
import {
  createLocalModelArtifactInstaller,
  type LocalModelArtifactDescriptor,
  type LocalModelArtifactInstallOptions,
  type LocalModelArtifactInstallResult,
} from '@/modules/knowledge'
import { createExpoLocalModelArtifactInstallerPort } from '@/platform/localModels'

export const LOCAL_MODEL_ROOT_DIRECTORY = `${FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? ''}islemind-models/`

export const localModelArtifactInstaller = createLocalModelArtifactInstaller(
  createExpoLocalModelArtifactInstallerPort(),
)

export function installLocalModelArtifacts(
  model: LocalModelArtifactDescriptor,
  options: Omit<LocalModelArtifactInstallOptions, 'rootDirectory'> = {},
): Promise<LocalModelArtifactInstallResult> {
  return localModelArtifactInstaller.install(model, {
    ...options,
    rootDirectory: LOCAL_MODEL_ROOT_DIRECTORY,
  })
}

export function deleteInstalledLocalModelArtifacts(modelId: string, signal?: AbortSignal): Promise<void> {
  return localModelArtifactInstaller.deleteInstalledModel(modelId, LOCAL_MODEL_ROOT_DIRECTORY, signal)
}
