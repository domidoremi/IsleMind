import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Text } from '@/components/ui/AppText'
import { IsleButton, IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { WorkspaceSurface } from '@/presentation/layout/WorkspaceSurface'
import type { ScenePlanChangeField } from '@/modules/conversations'
import type { AIProvider } from '@/types/providerContracts'
import type { ModelRoutingPlan, ToolDeclarationMode } from '@/core'
import type { ScenePlanPreview as Preview } from './scenePlanWorkspacePort'

export function ScenePlanPreview({ preview, providers, threshold, declarationMode, stale, busy, onApply, onRefresh }: {
  preview: Preview
  providers: AIProvider[]
  threshold: number
  declarationMode: ToolDeclarationMode
  stale: boolean
  busy: boolean
  onApply(): void
  onRefresh(): void
}) {
  const { t } = useTranslation()
  const { colors } = useAppTheme()
  const typography = colors.design!.semantic.typography
  const body = { ...typography.body, color: colors.textSecondary }
  const [expandedPrompt, setExpandedPrompt] = useState(false)
  const modelLabel = (value: { providerId: string | null; model: string | null }) => value.providerId && value.model
    ? `${providers.find(provider => provider.id === value.providerId)?.name ?? value.providerId} · ${value.model}` : t('scenes.unbound')
  function display(field: ScenePlanChangeField, value: unknown): string {
    if (field === 'model') return modelLabel(value as { providerId: string | null; model: string | null })
    if (field === 'routingPlan') {
      const plan = value as ModelRoutingPlan | undefined
      return plan ? `${plan.name} · ${t(`routing.${plan.mode}`)}\n${modelLabel(plan.primary)}${plan.backup ? ` → ${modelLabel(plan.backup)}` : ''}\n${t(`routing.${plan.crossProvider}`)}` : t('scenes.single')
    }
    if (field === 'enabledTools' || field === 'knowledgeSources') {
      const selection = value as { values?: string[]; scope?: 'selected' | 'none' }
      if (selection.scope === 'none') return t('scenes.none')
      if (!selection.values?.length) return t('scenes.unrestricted')
      return selection.values.map(id => {
        if (field === 'enabledTools') {
          const tool = preview.catalog.tools.find(item => item.id === id)
          return tool ? `${tool.serverName ?? tool.serverId ?? tool.source} / ${tool.name}` : id
        }
        const item = preview.catalog.knowledge.find(source => source.value === id)
        return item ? preview.catalog.knowledge.filter(source => source.label === item.label).length > 1 ? `${item.label} (${id})` : item.label : id
      }).join(' · ')
    }
    if (field === 'skillIds') return (value as string[] | undefined)?.map(id => preview.catalog.skills.find(skill => skill.id === id)?.name ?? id).join(' · ') || t('scenes.none')
    if (field === 'systemPrompt') {
      const text = typeof value === 'string' ? value : ''
      return !text ? t('scenes.emptyPrompt') : expandedPrompt || text.length <= 240 ? text : `${text.slice(0, 240)}…`
    }
    if (field === 'contextPolicyOverride') return value
      ? `${(value as { remoteCompactThreshold: number }).remoteCompactThreshold * 100}%`
      : t('scenes.inheritValue', { value: `${threshold * 100}%` })
    if (field === 'toolDeclarationModeOverride') return value ? t(`toolDeclarations.${value as ToolDeclarationMode}`)
      : t('scenes.inheritValue', { value: t(`toolDeclarations.${declarationMode}`) })
    return value === undefined ? '—' : String(value)
  }
  const changeTitle = (field: ScenePlanChangeField) => t(`scenes.${({ routingPlan: 'routing', contextPolicyOverride: 'contextPolicy', toolDeclarationModeOverride: 'toolDeclarationMode' } as Partial<Record<ScenePlanChangeField, string>>)[field] ?? field}`)
  return <View testID="scene-application-preview" style={styles.root}>
    <WorkspaceSurface role="reading" testID="scene-preview-scope" style={styles.root}>
      <Text accessibilityRole="header" style={[typography.title, { color: colors.text }]}>{t('scenes.preview')}</Text>
      <Text style={body}>{t(preview.target.kind === 'new' ? 'scenes.newScope' : 'scenes.conversationScope', {
        title: preview.before.title || t('chat.newConversation'), name: preview.plan.name, revision: preview.plan.revision,
      })}</Text>
      <Text style={body}>{t('scenes.scopeHint')}</Text>
      <Text style={body}>{t('scenes.resourceVersionHint')}</Text>
      <Text style={body}>{t('scenes.resourcesHint')}</Text>
    </WorkspaceSurface>
    {stale ? <Text testID="scene-preview-stale" accessibilityRole="alert" style={[body, { color: colors.ui.tone.warning.foreground }]}>{t('scenes.previewExpired')}</Text> : null}
    {preview.issues.length ? <View testID="scene-preview-issues" accessibilityRole="alert" style={styles.root}>
      <Text style={[typography.label, { color: colors.ui.tone.warning.foreground }]}>{t('scenes.resolveBeforeApply')}</Text>
      {preview.issues.map((issue, index) => <Text key={index} style={body}>{t(`scenes.issues.${issue.kind}`, { label: issue.label })}</Text>)}
    </View> : null}
    {preview.warnings.map((warning, index) => <Text key={index} style={body}>{t(`scenes.warnings.${warning.kind}`, { label: warning.label })}</Text>)}
    <View testID="scene-preview-changes" style={styles.root}>
      {preview.changes.map(change => <View key={change.field} testID={`scene-change-${change.field}`} style={[styles.change, { borderColor: colors.ui.section.divider }]}>
        <View style={styles.heading}>
          <Text style={[typography.label, { flex: 1, minWidth: 0, color: colors.text }]}>{changeTitle(change.field)}</Text>
          <Text style={[typography.caption, { color: colors.textTertiary }]}>{t(change.changed ? 'scenes.willChange' : 'scenes.unchanged')}</Text>
        </View>
        {change.changed ? <Text selectable style={body}>{t('scenes.beforeValue', { value: display(change.field, change.before) })}</Text> : null}
        <Text selectable style={[body, change.changed ? { color: colors.text } : undefined]}>
          {t(change.changed ? 'scenes.afterValue' : 'scenes.currentValue', { value: display(change.field, change.after) })}
        </Text>
        {change.field === 'systemPrompt' && ([change.before, change.after].some(value => typeof value === 'string' && value.length > 240)) ? <IslePressable
          accessibilityRole="button" accessibilityLabel={t(expandedPrompt ? 'scenes.collapsePrompt' : 'scenes.expandPrompt')}
          accessibilityState={{ expanded: expandedPrompt }} onPress={() => setExpandedPrompt(value => !value)} style={styles.textAction}>
          <Text style={body}>{t(expandedPrompt ? 'scenes.collapsePrompt' : 'scenes.expandPrompt')}</Text>
        </IslePressable> : null}
      </View>)}
    </View>
    {!preview.changes.some(change => change.changed) ? <Text style={body}>{t('scenes.noChanges')}</Text> : null}
    <View style={styles.actions}>
      <IsleButton testID="scene-apply" label={t(preview.target.kind === 'new' ? 'scenes.createAndApply' : 'scenes.apply')}
        tone="primary" busy={busy} disabled={busy || stale || !!preview.issues.length} onPress={onApply} />
      <IsleButton testID="scene-refresh-preview" label={t('scenes.refreshPreview')} disabled={busy} onPress={onRefresh} />
    </View>
  </View>
}

const styles = StyleSheet.create({
  root: { gap: 16, minWidth: 0 },
  change: { gap: 8, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14 },
  heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  textAction: { minHeight: 44, justifyContent: 'center' },
})
