import { useTranslation } from 'react-i18next'
import { createLazyComponent } from '@/utils/lazyLoad'
import { SettingsPageShell } from '@/components/settings/SettingsPageShell'

// 懒加载偏好设置内容
const PreferenceSettingsContent = createLazyComponent(
  () => import('@/components/settings/PreferenceSettingsContent')
)

export default function PreferencesSettingsScreen() {
  const { t } = useTranslation()
  return (
    <SettingsPageShell title={t('settings.preferences')} subtitle={t('settings.preferencesDescription')}>
      <PreferenceSettingsContent />
    </SettingsPageShell>
  )
}
