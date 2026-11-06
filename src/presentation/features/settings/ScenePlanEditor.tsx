import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Text } from '@/components/ui/AppText'
import { IsleButton, IsleInput, IslePressable, IsleSelect } from '@/components/ui/isle'
import { SettingsReferenceField } from '@/components/settings/SettingsReferenceField'
import { useAppTheme } from '@/hooks/useAppTheme'
import { WorkspaceTabs } from '@/presentation/layout/WorkspaceTabs'
import { buildChatModelPickerCandidates, filterChatModelPickerCandidates } from '@/components/chat/chatModelPickerPresentation'
import { normalizeModelRoutingPlan, type ModelRoutingPlan, type ScenePlanConfiguration } from '@/core'
import type { AIProvider } from '@/types/providerContracts'
import type { ScenePlanForm } from './scenePlanForm'
import type { ScenePlanCatalog } from './scenePlanWorkspacePort'

const MODEL_PAGE_SIZE = 15

export function ScenePlanEditor({ form, catalog, providers, routingPlans, disabled, onChange, reloadCatalog, catalogFailed }: {
  form: ScenePlanForm
  catalog?: ScenePlanCatalog
  providers: AIProvider[]
  routingPlans: ModelRoutingPlan[]
  disabled: boolean
  onChange(form: ScenePlanForm): void
  reloadCatalog(): void
  catalogFailed: boolean
}) {
  const { t } = useTranslation()
  const { colors } = useAppTheme()
  const typography = colors.design!.semantic.typography
  const [section, setSection] = useState<'conversation' | 'resources' | 'context'>('conversation')
  const [modelPicker, setModelPicker] = useState(false)
  const [modelQuery, setModelQuery] = useState('')
  const [modelPage, setModelPage] = useState(0)
  const configuration = form.plan.configuration
  const body = { ...typography.body, color: colors.textSecondary }
  const label = { ...typography.label, color: colors.text }
  const updateConfiguration = (updates: Partial<ScenePlanConfiguration>) => onChange({ ...form, plan: { ...form.plan, configuration: { ...configuration, ...updates } } })
  const mode = <Value extends string>(testID: string, title: string, value: Value, values: readonly Value[], onSelect: (value: Value) => void) =>
    <WorkspaceTabs testID={testID} accessibilityLabel={title} role="radio" value={value} disabled={disabled}
      tabs={values.map(item => ({ value: item, label: t(`scenes.${item}`) }))} onChange={onSelect} />
  const list = (value: string) => [...new Set(value.split(/[,，\n]/).map(id => id.trim()).filter(Boolean))]
  const candidates = useMemo(() => buildChatModelPickerCandidates({ providers, currentProviderId: null, currentModel: null,
    providerFallbackName: t('providerSettings.customProvider') }), [providers, t])
  const matches = useMemo(() => filterChatModelPickerCandidates({ candidates, scope: { kind: 'all' }, query: modelQuery }), [candidates, modelQuery])
  const page = Math.min(modelPage, Math.max(0, Math.ceil(matches.length / MODEL_PAGE_SIZE) - 1))
  const modelMode = form.modelMode
  const resourceField = (field: 'skillIds' | 'enabledTools' | 'knowledgeSources') => {
    const options = field === 'skillIds' ? catalog?.skills.map(skill => ({ value: skill.id, label: skill.name })) ?? []
      : field === 'enabledTools' ? catalog?.tools.map(tool => ({ value: tool.id, label: tool.serverName ? `${tool.serverName} / ${tool.name}` : tool.name })) ?? [] : catalog?.knowledge ?? []
    const value = configuration[field]
    const selection = form.resourceModes[field]
    const title = t(`scenes.${field}`)
    return <View key={field} style={styles.section}>
      <Text style={label}>{title}</Text>
      {mode(`scene-${field}-mode`, title, selection, ['keep', 'selected', 'none'] as const, next => {
        onChange({ ...form, resourceModes: { ...form.resourceModes, [field]: next },
          plan: { ...form.plan, configuration: { ...configuration, [field]: next === 'keep' ? undefined : next === 'none' ? [] : value ?? [] } } })
      })}
      {selection === 'selected' ? <SettingsReferenceField label={title} value={(value ?? []).join('\n')} options={options}
        catalogReady={!!catalog && !catalogFailed} disabled={disabled} onChange={text => updateConfiguration({ [field]: list(text) })} /> : null}
    </View>
  }
  const variableDefinitions = [...new Map((configuration.skillIds ?? []).flatMap(id => catalog?.skillVariables[id] ?? []).map(variable => [variable.name, variable])).values()]
  return <View testID="scene-editor" style={styles.root}>
    <Text style={body}>{t('scenes.editorHint')}</Text>
    <IsleInput testID="scene-name" label={t('scenes.name')} accessibilityLabel={t('scenes.name')} value={form.plan.name}
      maxLength={80} editable={!disabled} onChangeText={name => onChange({ ...form, plan: { ...form.plan, name } })} />
    <IsleInput testID="scene-description" label={t('scenes.description')} accessibilityLabel={t('scenes.description')} value={form.plan.description ?? ''}
      maxLength={240} editable={!disabled} onChangeText={description => onChange({ ...form, plan: { ...form.plan, description } })} />
    <WorkspaceTabs testID="scene-editor-sections" accessibilityLabel={t('scenes.configuration')} role="tab" value={section}
      disabled={disabled} tabs={(['conversation', 'resources', 'context'] as const).map(value => ({ value, label: t(`scenes.${value}`) }))} onChange={setSection} />
    {section === 'conversation' ? <>
      <View style={styles.section}>
        <Text style={label}>{t('scenes.model')}</Text>
        {mode('scene-model-mode', t('scenes.model'), modelMode, ['keep', 'single', 'routing'] as const, value => {
          const model = value === 'keep' ? undefined : value === 'routing' && routingPlans[0]
            ? { target: { ...routingPlans[0].primary }, routingPlan: normalizeModelRoutingPlan(routingPlans[0]) } : configuration.model
          onChange({ ...form, modelMode: value, plan: { ...form.plan, configuration: { ...configuration, model } } })
          setModelPicker(value === 'single'); setModelQuery(''); setModelPage(0)
        })}
        {configuration.model ? <Text testID="scene-model-value" selectable style={body}>
          {modelMode === 'routing' && configuration.model.routingPlan?.name ? `${configuration.model.routingPlan.name} · ` : ''}
          {providers.find(provider => provider.id === configuration.model?.target.providerId)?.name ?? configuration.model.target.providerId} · {configuration.model.target.model}
        </Text> : null}
        {modelMode === 'routing' ? <>
          <IsleSelect accessibilityLabel={t('scenes.chooseRouting')} placeholder={t('scenes.chooseRouting')} disabled={disabled}
            options={routingPlans.map(plan => ({ value: plan.id, label: plan.name }))}
            onChange={id => { const plan = routingPlans.find(item => item.id === id); if (plan) updateConfiguration({ model: { target: { ...plan.primary }, routingPlan: normalizeModelRoutingPlan(plan) } }) }} />
          <Text style={body}>{t('scenes.routingSnapshotHint')}</Text>
        </> : null}
        {modelMode === 'routing' && !routingPlans.length ? <Text style={body}>{t('scenes.noRoutingPlans')}</Text> : null}
        <IsleButton testID="scene-choose-model" label={t('routing.chooseModel')} disabled={disabled}
          onPress={() => { onChange({ ...form, modelMode: 'single' }); setModelPicker(open => !open); setModelQuery(''); setModelPage(0) }} />
        {modelPicker ? <View testID="scene-model-picker" style={styles.section}>
          <IsleInput testID="scene-model-search" accessibilityLabel={t('chat.searchProviderOrModel')} placeholder={t('chat.searchProviderOrModel')}
            value={modelQuery} editable={!disabled} autoCapitalize="none" autoCorrect={false}
            onChangeText={value => { setModelQuery(value); setModelPage(0) }} />
          {matches.slice(page * MODEL_PAGE_SIZE, (page + 1) * MODEL_PAGE_SIZE).map(candidate => <IslePressable key={candidate.key}
            testID={`scene-model-${candidate.provider.id}-${candidate.id}`} accessibilityRole="button"
            accessibilityLabel={`${candidate.provider.name} · ${candidate.id}`} disabled={disabled}
            onPress={() => { onChange({ ...form, modelMode: 'single', plan: { ...form.plan, configuration: { ...configuration,
              model: { target: { providerId: candidate.provider.id, model: candidate.id } } } } }); setModelPicker(false) }}
            style={[styles.modelRow, { borderColor: colors.ui.section.divider }]}>
            <Text style={[typography.body, { color: colors.text }]}>{candidate.provider.name} · {candidate.id}</Text>
            {candidate.upstreamModel !== candidate.id ? <Text style={body}>{t('scenes.aliasTarget', { model: candidate.upstreamModel })}</Text> : null}
          </IslePressable>)}
          {!matches.length ? <Text style={body}>{t('chat.noProviderModelMatches')}</Text> : null}
          <View style={styles.actions}>
            <IsleButton label={t('routing.previous')} disabled={disabled || page === 0} onPress={() => setModelPage(page - 1)} />
            <IsleButton label={t('routing.next')} disabled={disabled || (page + 1) * MODEL_PAGE_SIZE >= matches.length} onPress={() => setModelPage(page + 1)} />
            <IsleButton label={t('common.close')} disabled={disabled} onPress={() => setModelPicker(false)} />
          </View>
        </View> : null}
      </View>
      <View style={styles.section}>
        <Text style={label}>{t('scenes.systemPrompt')}</Text>
        {mode('scene-prompt-mode', t('scenes.systemPrompt'), configuration.systemPrompt === undefined ? 'keep' : 'replace', ['keep', 'replace'] as const,
          value => updateConfiguration({ systemPrompt: value === 'keep' ? undefined : configuration.systemPrompt ?? '' }))}
        {configuration.systemPrompt !== undefined ? <IsleInput testID="scene-system-prompt" accessibilityLabel={t('scenes.systemPrompt')}
          value={configuration.systemPrompt} editable={!disabled} multiline numberOfLines={5} maxLength={16000}
          onChangeText={systemPrompt => updateConfiguration({ systemPrompt })} /> : null}
        <Text style={body}>{t('scenes.promptHint')}</Text>
      </View>
    </> : section === 'resources' ? <>
      <Text style={body}>{t('scenes.resourcesHint')}</Text>
      {!catalog ? <View style={styles.section}><Text accessibilityRole={catalogFailed ? 'alert' : undefined} style={body}>{t(catalogFailed ? 'scenes.catalogFailed' : 'common.loading')}</Text>
        {catalogFailed ? <IsleButton label={t('common.retry')} disabled={disabled} onPress={reloadCatalog} /> : null}</View> : null}
      {resourceField('skillIds')}
      {variableDefinitions.length ? <View style={styles.section}>
        <Text style={label}>{t('scenes.variables')}</Text>
        {variableDefinitions.map(variable => <View key={variable.name} style={styles.section}>
          <Text style={label}>{variable.label ?? variable.name}{variable.required ? ` · ${t('scenes.required')}` : ''}</Text>
          {variable.type === 'boolean' || variable.type === 'choice' ? <IsleSelect accessibilityLabel={variable.label ?? variable.name}
            placeholder={t('scenes.useDefault')} disabled={disabled} value={form.variableDrafts[variable.name]}
            options={variable.type === 'boolean' ? [{ value: 'true', label: t('scenes.true') }, { value: 'false', label: t('scenes.false') }]
              : (variable.options ?? []).map(value => ({ value, label: value }))}
            onChange={value => onChange({ ...form, variableDrafts: { ...form.variableDrafts, [variable.name]: value } })} />
            : <IsleInput accessibilityLabel={variable.label ?? variable.name} value={form.variableDrafts[variable.name] ?? ''}
              placeholder={variable.defaultValue === undefined ? t('scenes.useDefault') : String(variable.defaultValue)} editable={!disabled} maxLength={1000}
              keyboardType={variable.type === 'number' ? 'decimal-pad' : 'default'}
              onChangeText={value => onChange({ ...form, variableDrafts: { ...form.variableDrafts, [variable.name]: value } })} />}
          {form.variableDrafts[variable.name] ? <IsleButton compact label={t('scenes.useDefault')} disabled={disabled}
            onPress={() => onChange({ ...form, variableDrafts: { ...form.variableDrafts, [variable.name]: '' } })} /> : null}
        </View>)}
      </View> : null}
      {resourceField('enabledTools')}
      {resourceField('knowledgeSources')}
    </> : <>
      <View style={styles.section}>
        <Text style={label}>{t('scenes.contextPolicy')}</Text>
        {mode('scene-context-mode', t('scenes.contextPolicy'), configuration.contextPolicy === undefined ? 'keep' : configuration.contextPolicy === null ? 'inherit' : 'custom',
          ['keep', 'inherit', 'custom'] as const, value => updateConfiguration({ contextPolicy: value === 'keep' ? undefined : value === 'inherit' ? null
            : { schema: 'islemind.conversation-context-policy.v1', remoteCompactThreshold: 0.8 } }))}
        {configuration.contextPolicy ? <IsleInput testID="scene-threshold" accessibilityLabel={t('scenes.threshold')} label={t('scenes.threshold')}
          value={form.thresholdText} editable={!disabled} keyboardType="decimal-pad" maxLength={8}
          onChangeText={thresholdText => onChange({ ...form, thresholdText })} /> : null}
        <Text style={body}>{t('scenes.contextHint')}</Text>
      </View>
      <View style={styles.section}>
        <Text style={label}>{t('scenes.toolDeclarationMode')}</Text>
        {mode('scene-declaration-mode', t('scenes.toolDeclarationMode'), configuration.toolDeclarationMode === undefined ? 'keep' : configuration.toolDeclarationMode === null ? 'inherit' : configuration.toolDeclarationMode,
          ['keep', 'inherit', 'full', 'auto'] as const, value => updateConfiguration({ toolDeclarationMode: value === 'keep' ? undefined : value === 'inherit' ? null : value }))}
        <Text style={body}>{t('scenes.declarationHint')}</Text>
      </View>
    </>}
  </View>
}

const styles = StyleSheet.create({
  root: { gap: 18, minWidth: 0 },
  section: { gap: 10, minWidth: 0 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  modelRow: { minHeight: 48, paddingVertical: 10, gap: 4, borderTopWidth: StyleSheet.hairlineWidth },
})
