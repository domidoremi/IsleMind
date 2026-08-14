import { createPortableKnowledgeSnapshotService } from '@/modules/knowledge'
import { st } from '@/i18n/service'
import { knowledgeRepository, replaceKnowledgeContextSnapshot } from './knowledgeRepository'

/** Composition-root binding for portable knowledge backup and review imports. */
export const portableKnowledgeSnapshot = createPortableKnowledgeSnapshotService({
  repository: knowledgeRepository,
  replaceSnapshot: replaceKnowledgeContextSnapshot,
  clock: { now: () => Date.now() },
  fallbackChunkTitle: () => st('contextStore.knowledgeChunk'),
})

export type { PortableKnowledgeSnapshot as ContextSnapshot } from '@/modules/knowledge'
