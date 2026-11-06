import { useLocalSearchParams } from 'expo-router'
import { PageFeedbackBoundary } from '@/components/ui/PageFeedback'
import { createLazyComponent } from '@/utils/lazyLoad'
import { parseUsageDetailReference } from '@/presentation/features/settings/usageNavigation'
import type { UsageStatisticsService } from '@/modules/diagnostics'

const UsageExecutionDetailScreen = createLazyComponent(
  () => import('@/components/settings/UsageExecutionDetailScreen').then(module => ({ default: module.UsageExecutionDetailScreen })),
)
const loadDetail: UsageStatisticsService['detail'] = async reference => {
  const { loadUsageExecutionDetail } = await import('@/bootstrap/usageStatisticsRuntime')
  return loadUsageExecutionDetail(reference)
}

export default function RequestDetailRoute() {
  const params = useLocalSearchParams()
  const reference = parseUsageDetailReference(params)
  return <PageFeedbackBoundary scopeKey={JSON.stringify(reference)}>
    <UsageExecutionDetailScreen key={JSON.stringify(reference)} reference={reference} params={params} loadDetail={loadDetail} />
  </PageFeedbackBoundary>
}
