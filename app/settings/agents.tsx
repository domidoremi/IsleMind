import { useTranslation } from 'react-i18next'
import { SettingsPageShell } from '@/components/settings/SettingsPageShell'
import { createLazyComponent } from '@/utils/lazyLoad'
import { agentDefinitionManagement } from '@/bootstrap/agentDefinitionManagement'
import { resolveAgentModelBinding } from '@/bootstrap/agentModelBinding'

const AgentDefinitionsScreen = createLazyComponent(() => import('@/presentation/features/settings/AgentDefinitionsScreen')
  .then((module) => ({ default: module.AgentDefinitionsScreen })))

export default function AgentDefinitionsRoute() {
  const { t } = useTranslation()
  return <SettingsPageShell title={t('agents.title')} subtitle={t('agents.description')}>
    <AgentDefinitionsScreen management={agentDefinitionManagement} resolveModelBinding={resolveAgentModelBinding} />
  </SettingsPageShell>
}
