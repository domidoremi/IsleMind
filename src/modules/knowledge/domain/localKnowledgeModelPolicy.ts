export type LocalKnowledgeModelCapability = 'embedding' | 'reranker' | 'colbert' | 'compressor'

export interface LocalKnowledgeModelView {
  model: {
    files: readonly unknown[]
    sizeBytes: number
  }
}

export interface LocalKnowledgeCapabilitySettings {
  embeddingMode?: 'provider' | 'local' | 'hybrid'
  ragCrossEncoderEnabled?: boolean
  ragColbertEnabled?: boolean
  ragLlmlinguaEnabled?: boolean
}

export function isDownloadableLocalModel(view: LocalKnowledgeModelView): boolean {
  return view.model.files.length > 0 && view.model.sizeBytes > 0
}

export function splitLocalModelViews<T extends LocalKnowledgeModelView>(
  views: readonly T[],
): { downloadable: T[]; planned: T[] } {
  return {
    downloadable: views.filter(isDownloadableLocalModel),
    planned: views.filter((view) => !isDownloadableLocalModel(view)),
  }
}

export function localCapabilityEnabled(
  capability: LocalKnowledgeModelCapability,
  settings: LocalKnowledgeCapabilitySettings,
): boolean {
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
