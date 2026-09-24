import { router, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { createLazyComponent } from '@/utils/lazyLoad'
import { ThemeDetailFrame } from '@/presentation/app-shell/ThemeDetailFrame'

const Content = createLazyComponent(async () => {
  const [{ AgentRunScreen }, { agentTaskRuntime }] = await Promise.all([
    import('@/presentation/features/agents/AgentRunScreen'), import('@/bootstrap/agentTaskRuntime'),
  ])
  return { default: ({ runId }: { runId: string }) => <AgentRunScreen runtime={agentTaskRuntime} runId={runId}
    onFreshRun={(conversationId) => router.push({ pathname: '/agent', params: { conversationId } })}
    onOpenRun={(id) => router.push({ pathname: '/agent/run/[runId]', params: { runId: id } })} /> }
})
/** Stable notification target. Navigation is deliberately not an approval/resume action. */
export default function AgentRunRoute() {
  const { t } = useTranslation(); const params = useLocalSearchParams<{ runId?: string }>()
  return <ThemeDetailFrame kind="agents" title={t('agentTasks.title')} onBack={() => router.canGoBack() ? router.back() : router.replace('/agent')} backLabel={t('common.back')}>
    <Content runId={typeof params.runId === 'string' ? params.runId : ''} />
  </ThemeDetailFrame>
}
