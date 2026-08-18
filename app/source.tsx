import { createLazyComponent } from '@/utils/lazyLoad'

const SourceDetailScreen = createLazyComponent(
  () => import('@/presentation/features/conversations/SourceDetailScreen'),
)

export default SourceDetailScreen
