import { useEffect, useRef, useState } from 'react'
import { Platform, View } from 'react-native'
import { Text } from '@/components/ui/AppText'
import { useNavigation } from 'expo-router'
import { usePreventRemove } from 'expo-router/react-navigation'
import { useTranslation } from 'react-i18next'
import { IsleButton, IslePressable, IsleInput, IslePanel, IsleSelect, useIsleDialog } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import { AGENT_ACTION_CAPABILITIES, type AgentDefinition } from '@/modules/assistant-runtime'
import { AgentDefinitionConflictError } from '@/modules/assistant-runtime'
import type { AgentDefinitionManagement } from '@/modules/assistant-runtime'
import { agentDefinitionFromForm, agentDefinitionToForm, type AgentDefinitionForm } from './agentDefinitionForm'
import { resolveProviderDisplayName } from './providerPresentation'
import type { AIProvider } from '@/types/providerContracts'
import { SettingsReferenceField, type SettingsReferenceOption } from '@/components/settings/SettingsReferenceField'
import { getProviderPreferredModel, getProviderSelectableModels } from '@/utils/providerModels'

const PAGE_SIZE = 20
type TextField = Exclude<keyof AgentDefinitionForm, 'source' | 'actionCapability' | 'reviewerMode'>

/** Local definition management only. No execution controller or permission-grant actions live here. */
export function AgentDefinitionsScreen({ management, resolveModelBinding, loadReferences }: { management: AgentDefinitionManagement;
  loadReferences?: () => Promise<Record<'tools' | 'knowledge' | 'skills' | 'agents', SettingsReferenceOption[]>>;
  resolveModelBinding?: (provider: AIProvider, modelId: string) => AgentDefinition['modelBinding'] }) {
  const { t } = useTranslation()
  const { colors } = useAppTheme()
  const dialog = useIsleDialog()
  const navigation = useNavigation()
  const providers = useSettingsStore((state) => state.providers)
  const [items, setItems] = useState<AgentDefinition[]>([])
  const [afterId, setAfterId] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [readFailed, setReadFailed] = useState(false)
  const [form, setForm] = useState<AgentDefinitionForm>()
  const [expectedRevision, setExpectedRevision] = useState<number>()
  const [dirty, setDirty] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string>()
  const [references, setReferences] = useState<Record<'tools' | 'knowledge' | 'skills' | 'agents', SettingsReferenceOption[]>>({ tools: [], knowledge: [], skills: [], agents: [] })
  const [referenceState, setReferenceState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [referenceRefresh, setReferenceRefresh] = useState(0)
  const locked = useRef(false)
  const lifetime = useRef<AbortController | undefined>(undefined)
  useEffect(() => {
    lifetime.current = new AbortController()
    return () => lifetime.current?.abort()
  }, [])
  useEffect(() => {
    let cancelled = false
    setLoading(true); setReadFailed(false)
    void management.list({ afterId, limit: PAGE_SIZE }).then((page) => { if (!cancelled) setItems(page) })
      .catch(() => { if (!cancelled) { setItems([]); setReadFailed(true) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [management, afterId, refresh])
  useEffect(() => {
    if (!form || !advancedOpen || !loadReferences) return
    let cancelled = false
    setReferenceState('loading')
    void loadReferences().then(value => { if (!cancelled) { setReferences(value); setReferenceState('ready') } })
      .catch(() => { if (!cancelled) setReferenceState('failed') })
    return () => { cancelled = true }
  }, [loadReferences, form?.source.id, advancedOpen, referenceRefresh])

  const bodyStyle = { color: colors.textSecondary, fontSize: 14, lineHeight: 20 }
  const headingStyle = { color: colors.text, fontSize: 16, fontWeight: '700' as const }
  const rowsStyle = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 }
  async function operation(work: () => Promise<void>, failure: string) {
    if (locked.current) return
    locked.current = true; setBusy(true); setFeedback(undefined)
    try { await work() }
    catch (error) { if (!lifetime.current?.signal.aborted) setFeedback(error instanceof AgentDefinitionConflictError ? 'conflict' : failure) }
    finally { locked.current = false; if (!lifetime.current?.signal.aborted) setBusy(false) }
  }
  async function canReplaceDraft() {
    return !dirty || dialog.confirm({ title: t('agents.discardTitle'), message: t('agents.discardMessage'), signal: lifetime.current?.signal })
  }
  usePreventRemove(dirty || busy, ({ data }) => {
    if (locked.current) return
    void canReplaceDraft().then((confirmed) => {
      if (confirmed && !locked.current && !lifetime.current?.signal.aborted) navigation.dispatch(data.action)
    })
  })
  useEffect(() => {
    if (Platform.OS !== 'web' || (!dirty && !busy)) return
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [dirty, busy])
  function openDraft(definition: AgentDefinition, revision?: number) {
    if (lifetime.current?.signal.aborted) return
    setAdvancedOpen(false)
    setForm(agentDefinitionToForm(definition)); setExpectedRevision(revision); setDirty(revision === undefined)
  }
  const update = (key: TextField, value: string) => {
    setForm((current) => current ? { ...current, [key]: value,
      ...(key === 'providerId' || key === 'modelId' ? { actionCapability: 'text_only' as const, capabilityRevision: 'unverified' } : {}) } : current)
    setDirty(true); setFeedback(undefined)
  }
  function field(key: TextField, options: { maxLength?: number; multiline?: boolean; numeric?: boolean; disabled?: boolean } = {}) {
    return <IsleInput key={key} label={t(`agents.fields.${key}`)} accessibilityLabel={t(`agents.fields.${key}`)}
      value={form?.[key] ?? ''} onChangeText={(value) => update(key, value)} maxLength={options.maxLength ?? (options.numeric ? 16 : 128)}
      multiline={options.multiline} numberOfLines={options.multiline ? 4 : 1} keyboardType={options.numeric ? 'decimal-pad' : 'default'}
      autoCapitalize="none" autoCorrect={false} editable={!busy && !options.disabled} />
  }
  const configuredProvider = providers.find((provider) => provider.id === form?.providerId)
  const providerOptions = providers.map((provider) => ({ value: provider.id, label: resolveProviderDisplayName(provider, t('providerSettings.customProvider')) }))
  if (form && !configuredProvider) providerOptions.unshift({ value: form.providerId, label: `${form.providerId} (${t('agents.unresolved')})` })
  const feedbackIsError = feedback === 'invalid' || feedback === 'conflict' || feedback?.endsWith('Failed')
  const feedbackNotice = feedback ? <Text accessibilityRole={feedbackIsError ? 'alert' : undefined} accessibilityLiveRegion="polite"
    style={[bodyStyle, feedbackIsError ? { color: colors.ui.tone.warning.foreground } : undefined]}>{t(`agents.${feedback}`)}</Text> : null

  return <View style={{ gap: 16 }} testID="agent-definitions-screen">
    <Text style={bodyStyle}>{t('agents.managementOnly')}</Text>
    <View style={rowsStyle}>
      <IsleButton label={t('agents.create')} disabled={busy || !providers.length} onPress={() => { void operation(async () => {
        if (!await canReplaceDraft()) return
        const provider = providers[0]
        openDraft(management.newDraft({ name: t('agents.newName'), providerId: provider.id, modelId: getProviderPreferredModel(provider) || 'unbound-model' }))
      }, 'saveFailed') }} />
      <IsleButton label={t('agents.import')} disabled={busy} onPress={() => { void operation(async () => {
        if (!await canReplaceDraft()) return
        const imported = await management.importDraft(lifetime.current?.signal)
        if (imported && !lifetime.current?.signal.aborted) { openDraft(imported); setFeedback('importPreview') }
      }, 'importFailed') }} />
    </View>
    {!providers.length ? <Text style={bodyStyle}>{t('agents.noProviders')}</Text> : null}
    {!form ? feedbackNotice : null}
    {form ? <IslePanel contentStyle={{ padding: 14, gap: 12 }}>
      <Text style={headingStyle}>{t(expectedRevision === undefined ? 'agents.newDefinition' : 'agents.editDefinition')}</Text>
      <Text selectable style={bodyStyle}>{form.source.id} · {t('agents.revision', { revision: form.source.revision })}</Text>
      <Text style={bodyStyle}>{t('agents.saveHint')}</Text>
      {field('name', { maxLength: 120 })}
      {field('instructions', { multiline: true, maxLength: 24_000 })}
      <Text style={headingStyle}>{t('agents.fields.providerId')}</Text>
      <IsleSelect value={form.providerId} options={providerOptions} onChange={(value) => { if (!busy) update('providerId', value) }} />
      {!configuredProvider ? <Text style={bodyStyle}>{t('agents.missingProvider')}</Text> : null}
      {configuredProvider && getProviderSelectableModels(configuredProvider).length ? <>
        <Text style={headingStyle}>{t('agents.fields.modelId')}</Text>
        <IsleSelect value={form.modelId} options={Array.from(new Set([form.modelId, ...getProviderSelectableModels(configuredProvider)])).filter(Boolean).map(value => ({ value, label: value }))} onChange={value => { if (!busy) update('modelId', value) }} />
      </> : field('modelId', { maxLength: 512 })}
      <Text style={headingStyle}>{t('agents.actionCapability')}</Text>
      <IsleSelect value={form.actionCapability} options={AGENT_ACTION_CAPABILITIES.map((value) => ({ value, label: t(`agents.capabilities.${value}`) }))}
        onChange={(value) => { if (!busy) { setForm({ ...form, actionCapability: value as AgentDefinitionForm['actionCapability'] }); setDirty(true) } }} />
      {resolveModelBinding && configuredProvider ? <IsleButton label={t('agents.bindCapabilities')} disabled={busy}
        onPress={() => { setForm({ ...form, ...resolveModelBinding(configuredProvider, form.modelId) }); setDirty(true) }} /> : null}
      <Text style={bodyStyle}>{t('agents.capabilityHint')}</Text>
      {form.actionCapability === 'text_only' ? <Text accessibilityLiveRegion="polite" style={bodyStyle}>{t('agents.textOnlyWarning')}</Text> : null}
      <IslePressable accessibilityRole="button" accessibilityLabel={t('settingsWorkspace.advanced')} accessibilityState={{ expanded: advancedOpen }} onPress={() => setAdvancedOpen(value => !value)} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={headingStyle}>{t('settingsWorkspace.advanced')} {advancedOpen ? '−' : '+'}</Text></IslePressable>
      {advancedOpen ? <View style={{ gap: 12 }}>
      {field('capabilityRevision')}
      {loadReferences && referenceState !== 'ready' ? <Text accessibilityLiveRegion="polite" style={bodyStyle}>{t(referenceState === 'failed' ? 'settingsSubsystem.loadFailed' : 'common.loading')}</Text> : null}
      {loadReferences && referenceState === 'failed' ? <IsleButton label={t('common.retry')} onPress={() => setReferenceRefresh(value => value + 1)} /> : null}
      <SettingsReferenceField label={t('agents.fields.allowedToolIds')} value={form.allowedToolIds} catalogReady={referenceState === 'ready'} options={references.tools} onChange={value => update('allowedToolIds', value)} disabled={busy || form.actionCapability === 'text_only'} />
      <SettingsReferenceField label={t('agents.fields.knowledgeIds')} value={form.knowledgeIds} catalogReady={referenceState === 'ready'} options={references.knowledge} onChange={value => update('knowledgeIds', value)} disabled={busy} />
      <SettingsReferenceField label={t('agents.fields.skillIds')} value={form.skillIds} catalogReady={referenceState === 'ready'} options={references.skills} onChange={value => update('skillIds', value)} disabled={busy} />
      <SettingsReferenceField label={t('agents.fields.delegateAgentIds')} value={form.delegateAgentIds} catalogReady={referenceState === 'ready'} options={references.agents.filter(agent => agent.value !== form.source.id)} onChange={value => update('delegateAgentIds', value)} disabled={busy} />
      <Text style={bodyStyle}>{t('agents.referencesHint')}</Text>
      <Text style={headingStyle}>{t('agents.reviewer')}</Text>
      <IsleSelect value={form.reviewerMode} options={(['off', 'read_only'] as const).map((value) => ({ value, label: t(`agents.reviewerModes.${value}`) }))}
        onChange={(value) => { if (!busy) { setForm({ ...form, reviewerMode: value as AgentDefinitionForm['reviewerMode'], maxReviews: value === 'off' ? '0' : form.maxReviews === '0' ? '1' : form.maxReviews }); setDirty(true) } }} />
      {form.reviewerMode === 'read_only' ? <><SettingsReferenceField label={t('agents.fields.reviewerAgentId')} value={form.reviewerAgentId} catalogReady={referenceState === 'ready'} options={references.agents.filter(agent => agent.value !== form.source.id)} multiple={false} onChange={value => update('reviewerAgentId', value)} disabled={busy} />{field('maxReviews', { numeric: true })}</> : null}
      <Text style={headingStyle}>{t('agents.budget')}</Text>
      {(['modelRequests', 'tools', 'tokens', 'activeMinutes', 'amountUsd'] as const).map((key) => field(key, { numeric: true }))}
      {form.amountUsd ? <Text style={bodyStyle}>{t('agents.priceWarning')}</Text> : null}
      <Text style={headingStyle}>{t('agents.children')}</Text>
      {(['maxConcurrent', 'maxTotal', 'maxDepth'] as const).map((key) => field(key, { numeric: true }))}
      </View> : null}
      {feedbackNotice}
      <View style={rowsStyle}>
        <IsleButton label={t('common.save')} tone="primary" busy={busy} disabled={busy || !dirty} onPress={() => { void operation(async () => {
          let definition: AgentDefinition
          try { definition = agentDefinitionFromForm(form) } catch { setAdvancedOpen(true); setFeedback('invalid'); return }
          const saved = await management.save(definition, expectedRevision)
          if (!lifetime.current?.signal.aborted) { openDraft(saved, saved.revision); setFeedback('saved'); setRefresh((value) => value + 1) }
        }, 'saveFailed') }} />
        <IsleButton label={t('common.cancel')} disabled={busy} onPress={() => { void operation(async () => {
          if (await canReplaceDraft() && !lifetime.current?.signal.aborted) { setForm(undefined); setDirty(false) }
        }, 'saveFailed') }} />
      </View>
    </IslePanel> : null}
    <Text style={headingStyle}>{t('agents.savedDefinitions')}</Text>
    {readFailed ? <Text accessibilityRole="alert" style={bodyStyle}>{t('agents.readFailed')}</Text> : null}
    {loading ? <Text style={bodyStyle}>{t('common.loading')}</Text> : !readFailed && !items.length ? <Text style={bodyStyle}>{t('agents.empty')}</Text> : null}
    {items.map((item) => <IslePanel key={item.id} contentStyle={{ padding: 14, gap: 8 }}>
      <Text style={headingStyle}>{item.name}</Text>
      <Text selectable style={bodyStyle}>{item.id} · {t('agents.revision', { revision: item.revision })}</Text>
      <Text style={bodyStyle}>{providers.find(provider => provider.id === item.modelBinding.providerId)?.name ?? `${item.modelBinding.providerId} (${t('agents.unresolved')})`} · {item.modelBinding.modelId} · {t(`agents.capabilities.${item.modelBinding.actionCapability}`)}</Text>
      <View style={rowsStyle}>
        <IsleButton compact label={t('common.edit')} accessibilityLabel={t('agents.editNamed', { name: item.name })} disabled={busy} onPress={() => { void operation(async () => {
          if (!await canReplaceDraft()) return
          const saved = await management.get(item.id)
          if (!saved) throw new AgentDefinitionConflictError()
          openDraft(saved, saved.revision)
        }, 'readFailed') }} />
        <IsleButton compact label={t('agents.export')} disabled={busy} onPress={() => { void operation(async () => {
          if (!await dialog.confirm({ title: t('agents.export'), message: t('agents.exportWarning'), signal: lifetime.current?.signal })) return
          await management.exportSaved(item.id)
          if (!lifetime.current?.signal.aborted) setFeedback('exported')
        }, 'exportFailed') }} />
        <IsleButton compact tone="danger" label={t('common.delete')} disabled={busy} onPress={() => { void operation(async () => {
          if (!await dialog.confirm({ title: t('agents.deleteTitle'), message: t('agents.deleteMessage', { name: item.name }), tone: 'danger', signal: lifetime.current?.signal })) return
          await management.remove(item.id, item.revision)
          if (!lifetime.current?.signal.aborted) {
            if (form?.source.id === item.id) { setForm(undefined); setDirty(false) }
            setFeedback('deleted'); setRefresh((value) => value + 1)
          }
        }, 'deleteFailed') }} />
      </View>
    </IslePanel>)}
    <View style={rowsStyle}>
      <IsleButton label={t('agents.firstPage')} disabled={loading || busy} onPress={() => { setAfterId(''); setRefresh((value) => value + 1) }} />
      <IsleButton label={t('agents.nextPage')} disabled={loading || busy || items.length < PAGE_SIZE} onPress={() => setAfterId(items[items.length - 1].id)} />
    </View>
  </View>
}
