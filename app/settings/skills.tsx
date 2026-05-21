import { useTranslation } from 'react-i18next'
import { SettingsPageShell } from '@/components/settings/SettingsPageShell'
import { SkillSettingsContent } from '@/components/settings/SkillSettingsContent'

export default function SkillsSettingsScreen() {
  const { t } = useTranslation()
  return (
    <SettingsPageShell title={t('settings.skills')} subtitle={t('settings.skillsDescription')}>
      <SkillSettingsContent />
    </SettingsPageShell>
  )
}
