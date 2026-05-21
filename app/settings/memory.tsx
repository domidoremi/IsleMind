import { ContextPanel } from '@/components/settings/ContextPanel'
import { SettingsPageShell } from '@/components/settings/SettingsPageShell'
import { useSettingsStore } from '@/store/settingsStore'
import { useTranslation } from 'react-i18next'

export default function MemorySettingsScreen() {
  const { t } = useTranslation()
  const providers = useSettingsStore((state) => state.providers)
  return (
    <SettingsPageShell title={t('settings.memory')} subtitle={t('settings.memoryDescription')}>
      <ContextPanel providers={providers} section="memory" />
    </SettingsPageShell>
  )
}
