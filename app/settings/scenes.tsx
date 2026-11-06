import { useLocalSearchParams, router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SettingsPageShell } from '@/components/settings/SettingsPageShell'
import { createLazyComponent } from '@/utils/lazyLoad'
import { scenePlanRuntime } from '@/bootstrap/scenePlanRuntime'
import { usageRouteIdentity } from '@/presentation/features/settings/usageNavigation'

const ScenePlansScreen = createLazyComponent(() => import('@/presentation/features/settings/ScenePlansScreen')
  .then(module => ({ default: module.ScenePlansScreen })))

export default function ScenePlansRoute() {
  const { t } = useTranslation()
  const params = useLocalSearchParams<{ conversationId?: string; action?: string; planId?: string | string[] }>()
  const conversationId = typeof params.conversationId === 'string' ? params.conversationId : undefined
  return <SettingsPageShell title={t('scenes.title')} subtitle={t('scenes.subtitle')}>
    <ScenePlansScreen port={scenePlanRuntime} conversationId={conversationId}
      planId={usageRouteIdentity(params.planId)}
      captureOnOpen={params.action === 'capture'}
      onOpenConversation={id => router.replace({ pathname: '/chat/[id]', params: { id } })} />
  </SettingsPageShell>
}
