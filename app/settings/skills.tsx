import { useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SettingsPageShell } from '@/components/settings/SettingsPageShell'
import { type AgentWorkflowSettingsFocus, type PluginManifestSettingsFocus } from '@/components/settings/SkillSettingsContent'
import { createLazyComponent } from '@/utils/lazyLoad'

// 懒加载技能设置内容
const SkillSettingsContent = createLazyComponent(
  () => import('@/components/settings/SkillSettingsContent').then((module) => ({ default: module.SkillSettingsContent }))
)

export default function SkillsSettingsScreen() {
  const { t } = useTranslation()
  const params = useLocalSearchParams() as SkillsSettingsRouteParams
  const requestedFocus = routeParamText(params.focus)
  const runtimeRepairSource = routeParamText(params.source)
  const runtimeRepairTarget = routeParamText(params.target)
  const workflowFocus: AgentWorkflowSettingsFocus | undefined = requestedFocus === 'agent-workflow'
    ? {
        focus: 'agent-workflow',
        reason: routeParamText(params.reason),
        workflowId: routeParamText(params.workflowId),
        workflowName: routeParamText(params.workflowName),
        workflowExpectedOutput: routeParamText(params.workflowExpectedOutput),
      }
    : undefined
  const pluginManifestFocus: PluginManifestSettingsFocus | undefined = requestedFocus === 'plugin-manifest' || (runtimeRepairSource === 'runtime-repair' && runtimeRepairTarget === 'plugin-settings')
    ? {
        focus: 'plugin-manifest',
        source: runtimeRepairSource === 'runtime-repair' ? 'runtime-repair' : undefined,
        action: routeParamText(params.action),
        target: runtimeRepairTarget,
        event: routeParamText(params.event),
        issueCodes: routeParamList(params.issueCodes),
        summary: routeParamText(params.summary),
        latestEventId: routeParamText(params.latestEventId),
        sourceEventIds: routeParamList(params.sourceEventIds),
        eventCount: routeParamPositiveInteger(params.eventCount),
      }
    : undefined
  const focusKey = workflowFocus
    ? [workflowFocus.focus, workflowFocus.workflowId, workflowFocus.workflowName, workflowFocus.reason].filter(Boolean).join(':')
    : pluginManifestFocus
      ? [pluginManifestFocus.focus, pluginManifestFocus.action, pluginManifestFocus.target, pluginManifestFocus.latestEventId, pluginManifestFocus.eventCount].filter(Boolean).join(':')
      : undefined

  return (
    <SettingsPageShell title={t('settings.skills')} subtitle={t('settings.skillsDescription')} focusKey={focusKey}>
      <SkillSettingsContent workflowFocus={workflowFocus} pluginManifestFocus={pluginManifestFocus} />
    </SettingsPageShell>
  )
}

type SkillsSettingsRouteParam = string | string[] | undefined

interface SkillsSettingsRouteParams {
  focus?: SkillsSettingsRouteParam
  reason?: SkillsSettingsRouteParam
  workflowId?: SkillsSettingsRouteParam
  workflowName?: SkillsSettingsRouteParam
  workflowExpectedOutput?: SkillsSettingsRouteParam
  source?: SkillsSettingsRouteParam
  action?: SkillsSettingsRouteParam
  target?: SkillsSettingsRouteParam
  event?: SkillsSettingsRouteParam
  issueCodes?: SkillsSettingsRouteParam
  sourceEventIds?: SkillsSettingsRouteParam
  latestEventId?: SkillsSettingsRouteParam
  eventCount?: SkillsSettingsRouteParam
  summary?: SkillsSettingsRouteParam
}

function routeParamText(value: SkillsSettingsRouteParam): string | undefined {
  const text = Array.isArray(value) ? value[0] : value
  return typeof text === 'string' && text.trim() ? text : undefined
}

function routeParamList(value: SkillsSettingsRouteParam): string[] {
  const text = routeParamText(value)
  if (!text) return []
  return text.split(',').map((item) => item.trim()).filter(Boolean).slice(0, 8)
}

function routeParamPositiveInteger(value: SkillsSettingsRouteParam): number | undefined {
  const number = Number.parseInt(routeParamText(value) ?? '', 10)
  return Number.isFinite(number) && number > 0 ? number : undefined
}
