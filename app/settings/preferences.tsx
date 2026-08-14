import { useTranslation } from 'react-i18next'
import { createLazyComponentWithPreload } from '@/utils/lazyLoad'
import { SettingsPageShell } from '@/components/settings/SettingsPageShell'

// 懒加载偏好设置内容
const PreferenceSettingsContent = createLazyComponentWithPreload(
  () => import('@/components/settings/PreferenceSettingsContent').then((module) => ({ default: module.PreferenceSettingsContent }))
)

export default function PreferencesSettingsScreen() {
  const { t } = useTranslation()
  return (
    <SettingsPageShell title={t('settings.preferences')} subtitle={t('settings.preferencesDescription')}>
      <PreferenceSettingsContent />
    </SettingsPageShell>
  )
}
