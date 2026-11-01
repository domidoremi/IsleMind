import { createLazyComponent } from '@/utils/lazyLoad'
import type { KnowledgeLocalSourceReader } from '@/modules/knowledge'
import { useLocalSearchParams } from 'expo-router'
import { PageFeedbackBoundary } from '@/components/ui/PageFeedback'

const SourceDetailScreen = createLazyComponent(
  () => import('@/presentation/features/conversations/SourceDetailScreen'),
)

const readLocalSource: KnowledgeLocalSourceReader['readLocalSource'] = async (reference, options) => {
  const { knowledgeRepository } = await import('@/bootstrap/knowledgeRepository')
  return knowledgeRepository.readLocalSource(reference, options)
}

export default function SourceRoute() {
  const params = useLocalSearchParams()
  const scope = JSON.stringify([params.conversationId, params.messageId, params.citationId, params.kind, params.url])
  return <PageFeedbackBoundary scopeKey={scope}><SourceDetailScreen readLocalSource={readLocalSource} /></PageFeedbackBoundary>
}
