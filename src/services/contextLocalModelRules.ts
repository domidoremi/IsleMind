import type { LocalRagModelCapability, Settings } from '@/types'
import type { LocalEmbeddingModelView } from '@/services/localEmbeddingModels'

export function isDownloadableLocalModel(view: LocalEmbeddingModelView): boolean {
  return view.model.files.length > 0 && view.model.sizeBytes > 0
}

export function splitLocalModelViews(views: LocalEmbeddingModelView[]): { downloadable: LocalEmbeddingModelView[]; planned: LocalEmbeddingModelView[] } {
  return {
    downloadable: views.filter(isDownloadableLocalModel),
    planned: views.filter((view) => !isDownloadableLocalModel(view)),
  }
}

export function localCapabilityEnabled(capability: LocalRagModelCapability, settings: Settings): boolean {
  switch (capability) {
    case 'reranker':
      return settings.ragCrossEncoderEnabled !== false
    case 'colbert':
      return settings.ragColbertEnabled !== false
    case 'compressor':
      return settings.ragLlmlinguaEnabled !== false
    case 'embedding':
      return (settings.embeddingMode ?? 'hybrid') !== 'provider'
  }
}
