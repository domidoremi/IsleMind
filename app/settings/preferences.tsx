import { useTranslation } from 'react-i18next'
import { PreferenceSettingsContent } from '@/components/settings/PreferenceSettingsContent'
import { SettingsPageShell } from '@/components/settings/SettingsPageShell'

export default function PreferencesSettingsScreen() {
  const { t } = useTranslation()
  return (
    <SettingsPageShell title={t('settings.preferences')} subtitle={t('settings.preferencesDescription')}>
      <PreferenceSettingsContent />
    </SettingsPageShell>
  )
}
