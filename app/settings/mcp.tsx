import { useTranslation } from 'react-i18next'
import { SettingsPageShell } from '@/components/settings/SettingsPageShell'
import { createLazyComponent } from '@/utils/lazyLoad'

// 懒加载 MCP 设置内容
const McpSettingsContent = createLazyComponent(
  () => import('@/components/settings/McpSettingsContent').then((module) => ({ default: module.McpSettingsContent }))
)

export default function McpSettingsScreen() {
  const { t } = useTranslation()
  return (
    <SettingsPageShell title={t('settings.mcp')} subtitle={t('settings.mcpDescription')}>
      <McpSettingsContent />
    </SettingsPageShell>
  )
}
