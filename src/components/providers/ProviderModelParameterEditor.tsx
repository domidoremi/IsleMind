import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { GenerationParameterKey } from '@/core'
import type { AIProvider, ProviderModelParameterConfiguration } from '@/types/providerContracts'
import { applyProviderModelParameterOverrides, parseProviderModelParameterConfiguration, PROVIDER_MODEL_PARAMETERS_SCHEMA } from '@/modules/providers'
import { resolveProviderModelExecutionProfile } from '@/bootstrap/providerModelExecutionProfile'
import { resolveProviderRequestParameters } from '@/bootstrap/providerRequestPolicies'
import { Text } from '@/components/ui/AppText'
import { IsleButton, IsleField, IsleSearchField } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'

export type ProviderModelParameterDrafts = Record<string, Partial<Record<GenerationParameterKey, string>>>
const parameterKeys: readonly GenerationParameterKey[] = ['temperature', 'topP', 'topK', 'maxTokens']

export function modelParameterDrafts(configuration: AIProvider['modelParameterOverrides']): ProviderModelParameterDrafts {
  const drafts: ProviderModelParameterDrafts = {}
  for (const [model, values] of Object.entries(parseProviderModelParameterConfiguration(configuration)?.models ?? {})) {
    drafts[model] = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]))
  }
  return drafts
}

export function parseModelParameterDrafts(drafts: ProviderModelParameterDrafts): ProviderModelParameterConfiguration | undefined {
  const models: ProviderModelParameterConfiguration['models'] = {}
  for (const [model, fields] of Object.entries(drafts)) {
    const values: Partial<Record<GenerationParameterKey, number>> = {}
    for (const key of parameterKeys) {
      const text = fields[key]?.trim()
      if (!text) continue
      if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/u.test(text)) throw new Error('Invalid model parameter draft.')
      values[key] = Number(text)
    }
    if (Object.keys(values).length) models[model] = values
  }
  return parseProviderModelParameterConfiguration({ schema: PROVIDER_MODEL_PARAMETERS_SCHEMA, models })
}

export function ProviderModelParameterEditor({ provider, models, initialModel, selectedModel, onSelectedModelChange, search: controlledSearch, onSearchChange, disabled, drafts, onChange }: {
  provider: AIProvider
  models: string[]
  initialModel?: string
  selectedModel?: string
  onSelectedModelChange?: (model: string) => void
  search?: string
  onSearchChange?: (value: string) => void
  disabled?: boolean
  drafts: ProviderModelParameterDrafts
  onChange: (drafts: ProviderModelParameterDrafts) => void
}) {
  const { t } = useTranslation()
  const { colors } = useAppTheme()
  const [localSelected, setSelected] = useState(initialModel ?? models[0] ?? '')
  const selected = selectedModel ?? localSelected
  const [localSearch, setSearch] = useState('')
  const search = controlledSearch ?? localSearch
  const [showUnsupported, setShowUnsupported] = useState(false)
  const choices = useMemo(() => models.filter(model => model.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 20), [models, search])
  const profile = useMemo(() => selected ? resolveProviderModelExecutionProfile({ provider, model: selected }) : undefined, [provider, selected])
  const preview = useMemo(() => {
    if (!selected) return undefined
    try {
      return resolveProviderRequestParameters(applyProviderModelParameterOverrides({
        provider: { ...provider, modelParameterOverrides: parseModelParameterDrafts({ [selected]: drafts[selected] ?? {} }) },
        model: profile?.upstreamModel ?? selected, requestedModel: selected, messages: [],
        generationParameterSources: { temperature: 'provider-default', topP: 'provider-default', topK: 'provider-default', maxTokens: 'provider-default' },
      }))
    } catch { return undefined }
  }, [drafts, provider, selected, profile?.upstreamModel])
  const support = useMemo(() => resolveProviderRequestParameters({
    provider, model: profile?.upstreamModel ?? selected,
    generationParameterSources: { temperature: 'provider-default', topP: 'provider-default', topK: 'provider-default', maxTokens: 'provider-default' },
  }).parameterPlan, [provider, profile?.upstreamModel, selected])
  const unsupportedCount = parameterKeys.filter(key => support.entries[key].reason === 'unsupported-model'
    || support.entries[key].reason === 'unsupported-endpoint' || support.entries[key].reason === 'reasoning-conflict').length
  const typography = colors.design!.semantic.typography
  if (!models.length) return <Text style={[typography.body, { color: colors.textSecondary }]}>{t('providerSettings.addModelHint')}</Text>
  return <View testID="provider-model-parameters" style={{ gap: 14, paddingVertical: 12 }}>
    <Text accessibilityRole="header" style={[typography.title, { color: colors.text }]}>{t('usage.modelParameters')}</Text>
    <Text style={[typography.body, { color: colors.textSecondary }]}>{t('usage.parameterScopeHint')}</Text>
    <IsleSearchField value={search} onChangeText={value => (onSearchChange ?? setSearch)(value)} placeholder={t('providerSettings.searchModels')}
      accessibilityLabel={t('providerSettings.searchModels')} clearAccessibilityLabel={t('common.clear')} />
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {choices.map(model => <IsleButton key={model} compact label={model} tone={model === selected ? 'primary' : 'default'}
        disabled={disabled} onPress={() => (onSelectedModelChange ?? setSelected)(model)} />)}
    </View>
    <Text style={[typography.label, { color: colors.text }]}>{selected}</Text>
    {profile ? <Text style={[typography.body, { color: colors.textSecondary }]}>{t('usage.modelBounds', {
      context: profile.modelConfig.contextWindow.toLocaleString(),
      output: profile.modelConfig.outputTokenLimit?.tokens.toLocaleString() ?? t('usage.executionNotReported'),
      source: t(`usage.modelSource.${profile.modelConfig.outputTokenLimit?.source ?? 'unknown'}`),
    })}</Text> : null}
    {parameterKeys.map(key => {
      const entry = preview?.parameterPlan.entries[key]
      const supportReason = support.entries[key].reason
      const supported = supportReason !== 'unsupported-model' && supportReason !== 'unsupported-endpoint' && supportReason !== 'reasoning-conflict'
      if (!supported && !showUnsupported) return null
      return <View key={key} style={{ gap: 6 }}>
        <IsleField label={t(`usage.parameter.${key}`)} note={supported
          ? t(key === 'maxTokens' ? 'usage.outputDefaultPolicyHint' : 'usage.parameterDefaultHint') : t('usage.parameterUnsupported')}
          inputProps={{
            testID: `provider-parameter-${key}`, value: drafts[selected]?.[key] ?? '',
            editable: supported && !disabled, keyboardType: 'decimal-pad', placeholder: t('usage.modelDefault'),
            onChangeText: text => onChange({ ...drafts, [selected]: { ...drafts[selected], [key]: text } }),
          }} />
        <Text style={[typography.body, { color: colors.textSecondary }]}>{t('usage.parameterPreview', {
          value: entry?.decision === 'included' && entry.value !== undefined ? entry.value : t('usage.modelDefault'),
        })}</Text>
      </View>
    })}
    {!preview ? <Text accessibilityRole="alert" style={[typography.body, { color: colors.ui.tone.warning.foreground }]}>{t('usage.parameterInvalid')}</Text> : null}
    {unsupportedCount ? <IsleButton label={t(showUnsupported ? 'usage.hideUnsupportedParameters' : 'usage.showUnsupportedParameters', { count: unsupportedCount })}
      disabled={disabled} onPress={() => setShowUnsupported(value => !value)} /> : null}
    <IsleButton label={t('usage.restoreModelDefaults')} disabled={disabled} onPress={() => {
      const next = { ...drafts }
      delete next[selected]
      onChange(next)
    }} />
  </View>
}
