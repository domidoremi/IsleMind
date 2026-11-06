import { createLazyComponent } from '@/utils/lazyLoad'
import { SettingsPageShell } from '@/components/settings/SettingsPageShell'
import { useSettingsStore } from '@/store/settingsStore'
import { useTranslation } from 'react-i18next'
import { useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { usageRouteIdentity, routeValue } from '@/presentation/features/settings/usageNavigation'

// 懒加载上下文面板组件
const ContextPanel = createLazyComponent(
  () => import('@/components/settings/ContextPanel').then((module) => ({ default: module.ContextPanel }))
)
const ConversationContextWorkspace = createLazyComponent(
  () => import('@/components/settings/ConversationContextWorkspace').then(module => ({ default: module.ConversationContextWorkspace }))
)

export default function ContextSettingsScreen() {
  const { t } = useTranslation()
  const providers = useSettingsStore((state) => state.providers)
  const params = useLocalSearchParams<{ conversationId?: string | string[]; scope?: string | string[] }>()
  const conversationId = usageRouteIdentity(params.conversationId)
  const [globalOpen, setGlobalOpen] = useState(false)
  const globalOnly = !conversationId || routeValue(params.scope) === 'global'
  const conversationScope = Boolean(conversationId) && !globalOnly
  return (
    <SettingsPageShell title={t(conversationScope ? 'usage.contextSettings' : 'settings.context')}
      subtitle={conversationScope ? undefined : t('settings.contextDescription')}>
      {conversationId && !globalOnly ? <ConversationContextWorkspace key={conversationId} conversationId={conversationId} onOpenGlobal={() => setGlobalOpen(true)} /> : null}
      {globalOnly || globalOpen ? <ContextPanel providers={providers} section="context" /> : null}
    </SettingsPageShell>
  )
}
