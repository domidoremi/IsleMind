import { useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SettingsPageShell } from '@/components/settings/SettingsPageShell'
import { createLazyComponent } from '@/utils/lazyLoad'
import type { AgentWorkflowSettingsFocus } from '@/components/settings/SkillSettingsContent'

// 懒加载技能设置内容
const SkillSettingsContent = createLazyComponent(
  () => import('@/components/settings/SkillSettingsContent')
)

export default function SkillsSettingsScreen() {
  const { t } = useTranslation()
  const params = useLocalSearchParams<{
    focus?: string
    reason?: string
    workflowId?: string
    workflowName?: string
    workflowExpectedOutput?: string
  }>()
  const workflowFocus: AgentWorkflowSettingsFocus | undefined = params.focus === 'agent-workflow'
    ? {
        focus: 'agent-workflow',
        reason: params.reason,
        workflowId: params.workflowId,
        workflowName: params.workflowName,
        workflowExpectedOutput: params.workflowExpectedOutput,
      }
    : undefined
  return (
    <SettingsPageShell title={t('settings.skills')} subtitle={t('settings.skillsDescription')} focusKey={workflowFocus ? [workflowFocus.focus, workflowFocus.workflowId, workflowFocus.workflowName, workflowFocus.reason].filter(Boolean).join(':') : undefined}>
      <SkillSettingsContent workflowFocus={workflowFocus} />
    </SettingsPageShell>
  )
}
