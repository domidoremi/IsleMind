import { createLazyComponent } from '@/utils/lazyLoad'
import { SettingsPageShell } from '@/components/settings/SettingsPageShell'
import { useSettingsStore } from '@/store/settingsStore'
import { useTranslation } from 'react-i18next'

// 懒加载上下文面板组件
const ContextPanel = createLazyComponent(
  () => import('@/components/settings/ContextPanel').then((module) => ({ default: module.ContextPanel }))
)

export default function ContextSettingsScreen() {
  const { t } = useTranslation()
  const providers = useSettingsStore((state) => state.providers)
  return (
    <SettingsPageShell title={t('settings.context')} subtitle={t('settings.contextDescription')}>
      <ContextPanel providers={providers} section="context" />
    </SettingsPageShell>
  )
}
