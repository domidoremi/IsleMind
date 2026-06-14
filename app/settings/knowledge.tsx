import { useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { createLazyComponent } from '@/utils/lazyLoad'
import { SettingsPageShell } from '@/components/settings/SettingsPageShell'
import { useSettingsStore } from '@/store/settingsStore'

// 懒加载知识面板组件
const ContextPanel = createLazyComponent(
  () => import('@/components/settings/ContextPanel').then((module) => ({ default: module.ContextPanel }))
)

export default function KnowledgeSettingsScreen() {
  const { t } = useTranslation()
  const providers = useSettingsStore((state) => state.providers)
  const params = useLocalSearchParams<{ focus?: string }>()
  const focus = params.focus === 'import' ? 'import' : undefined
  return (
    <SettingsPageShell title={t('settings.knowledge')} subtitle={t('settings.knowledgeDescription')} focusKey={params.focus}>
      <ContextPanel providers={providers} section="knowledge" focus={focus} />
    </SettingsPageShell>
  )
}
