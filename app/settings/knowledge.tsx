import { useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { ContextPanel } from '@/components/settings/ContextPanel'
import { SettingsPageShell } from '@/components/settings/SettingsPageShell'
import { useSettingsStore } from '@/store/settingsStore'

export default function KnowledgeSettingsScreen() {
  const { t } = useTranslation()
  const providers = useSettingsStore((state) => state.providers)
  const params = useLocalSearchParams<{ focus?: string }>()
  return (
    <SettingsPageShell title={t('settings.knowledge')} subtitle={t('settings.knowledgeDescription')} focusKey={params.focus}>
      <ContextPanel providers={providers} section="knowledge" />
    </SettingsPageShell>
  )
}
