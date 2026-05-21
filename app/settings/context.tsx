import { ContextPanel } from '@/components/settings/ContextPanel'
import { SettingsPageShell } from '@/components/settings/SettingsPageShell'
import { useSettingsStore } from '@/store/settingsStore'
import { useTranslation } from 'react-i18next'

export default function ContextSettingsScreen() {
  const { t } = useTranslation()
  const providers = useSettingsStore((state) => state.providers)
  return (
    <SettingsPageShell title={t('settings.context')} subtitle={t('settings.contextDescription')}>
      <ContextPanel providers={providers} section="context" />
    </SettingsPageShell>
  )
}
