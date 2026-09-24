import { router, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { createLazyComponent } from '@/utils/lazyLoad'
import { ThemeDetailFrame } from '@/presentation/app-shell/ThemeDetailFrame'

const Content = createLazyComponent(async () => {
  const [{ AgentTasksScreen }, { agentTaskRuntime }] = await Promise.all([
    import('@/presentation/features/agents/AgentTasksScreen'), import('@/bootstrap/agentTaskRuntime'),
  ])
  return { default: ({ conversationId }: { conversationId?: string }) => <AgentTasksScreen runtime={agentTaskRuntime} conversationId={conversationId}
    onOpenRun={(runId) => router.push({ pathname: '/agent/run/[runId]', params: { runId } })}
    onManageAgents={() => router.push('/settings/agents')} /> }
})
export default function AgentTasksRoute() {
  const { t } = useTranslation(); const params = useLocalSearchParams<{ conversationId?: string }>()
  return <ThemeDetailFrame kind="agents" title={t('agentTasks.title')} onBack={() => router.canGoBack() ? router.back() : router.replace('/')} backLabel={t('common.back')}>
    <Content conversationId={typeof params.conversationId === 'string' ? params.conversationId : undefined} />
  </ThemeDetailFrame>
}
