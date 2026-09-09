import { createLazyComponent } from '@/utils/lazyLoad'
import type { KnowledgeLocalSourceReader } from '@/modules/knowledge'

const SourceDetailScreen = createLazyComponent(
  () => import('@/presentation/features/conversations/SourceDetailScreen'),
)

const readLocalSource: KnowledgeLocalSourceReader['readLocalSource'] = async (reference, options) => {
  const { knowledgeRepository } = await import('@/bootstrap/knowledgeRepository')
  return knowledgeRepository.readLocalSource(reference, options)
}

export default function SourceRoute() {
  return <SourceDetailScreen readLocalSource={readLocalSource} />
}
