import { useEffect, useRef, useState } from 'react'
import { Platform, Text, View } from 'react-native'
import { useNavigation } from 'expo-router'
import { usePreventRemove } from 'expo-router/react-navigation'
import { useTranslation } from 'react-i18next'
import { IsleButton, IsleInput, IslePanel, IsleSelect, useIsleDialog } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import { AGENT_ACTION_CAPABILITIES, type AgentDefinition } from '@/modules/assistant-runtime/agentDefinition'
import { AgentDefinitionConflictError } from '@/modules/assistant-runtime/agentDefinitionRepository'
import type { AgentDefinitionManagement } from '@/modules/assistant-runtime/application/agentDefinitionManagement'
import { agentDefinitionFromForm, agentDefinitionToForm, type AgentDefinitionForm } from './agentDefinitionForm'
import { resolveProviderDisplayName } from './providerPresentation'
import type { AIProvider } from '@/types/providerContracts'

const PAGE_SIZE = 20
type TextField = Exclude<keyof AgentDefinitionForm, 'source' | 'actionCapability' | 'reviewerMode'>

/** Local definition management only. No execution controller or permission-grant actions live here. */
export function AgentDefinitionsScreen({ management, resolveModelBinding }: { management: AgentDefinitionManagement;
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
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string>()
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

  const bodyStyle = { color: colors.textSecondary, fontSize: 13, lineHeight: 19 }
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

  return <View style={{ gap: 16 }} testID="agent-definitions-screen">
    <Text style={bodyStyle}>{t('agents.managementOnly')}</Text>
    <Text style={bodyStyle}>{t('agents.dataOnly')}</Text>
    <Text style={bodyStyle}>{t('agents.backupHint')}</Text>
    <View style={rowsStyle}>
      <IsleButton label={t('agents.create')} disabled={busy || !providers.length} onPress={() => { void operation(async () => {
        if (!await canReplaceDraft()) return
        const provider = providers[0]
        openDraft(management.newDraft({ name: t('agents.newName'), providerId: provider.id, modelId: provider.models[0] || 'unbound-model' }))
      }, 'saveFailed') }} />
      <IsleButton label={t('agents.import')} disabled={busy} onPress={() => { void operation(async () => {
        if (!await canReplaceDraft()) return
        const imported = await management.importDraft(lifetime.current?.signal)
        if (imported && !lifetime.current?.signal.aborted) { openDraft(imported); setFeedback('importPreview') }
      }, 'importFailed') }} />
    </View>
    {!providers.length ? <Text style={bodyStyle}>{t('agents.noProviders')}</Text> : null}
    {feedback ? <Text accessibilityLiveRegion="polite" style={bodyStyle}>{t(`agents.${feedback}`)}</Text> : null}
    {form ? <IslePanel contentStyle={{ padding: 14, gap: 12 }}>
      <Text style={headingStyle}>{t(expectedRevision === undefined ? 'agents.newDefinition' : 'agents.editDefinition')}</Text>
      <Text selectable style={bodyStyle}>{form.source.id} · {t('agents.revision', { revision: form.source.revision })}</Text>
      <Text style={bodyStyle}>{t('agents.saveHint')}</Text>
      {field('name', { maxLength: 120 })}
      {field('instructions', { multiline: true, maxLength: 24_000 })}
      <Text style={headingStyle}>{t('agents.fields.providerId')}</Text>
      <IsleSelect value={form.providerId} options={providerOptions} onChange={(value) => { if (!busy) update('providerId', value) }} />
      {!configuredProvider ? <Text style={bodyStyle}>{t('agents.missingProvider')}</Text> : null}
      {field('modelId', { maxLength: 512 })}
      <Text style={headingStyle}>{t('agents.actionCapability')}</Text>
      <IsleSelect value={form.actionCapability} options={AGENT_ACTION_CAPABILITIES.map((value) => ({ value, label: t(`agents.capabilities.${value}`) }))}
        onChange={(value) => { if (!busy) { setForm({ ...form, actionCapability: value as AgentDefinitionForm['actionCapability'] }); setDirty(true) } }} />
      {field('capabilityRevision')}
      {resolveModelBinding && configuredProvider ? <IsleButton label={t('agents.bindCapabilities')} disabled={busy}
        onPress={() => { setForm({ ...form, ...resolveModelBinding(configuredProvider, form.modelId) }); setDirty(true) }} /> : null}
      <Text style={bodyStyle}>{t('agents.capabilityHint')}</Text>
      {form.actionCapability === 'text_only' ? <Text accessibilityLiveRegion="polite" style={bodyStyle}>{t('agents.textOnlyWarning')}</Text> : null}
      {field('allowedToolIds', { maxLength: 16_512, disabled: form.actionCapability === 'text_only' })}
      {field('knowledgeIds', { maxLength: 16_512 })}
      {field('skillIds', { maxLength: 16_512 })}
      {field('delegateAgentIds', { maxLength: 780 })}
      <Text style={bodyStyle}>{t('agents.referencesHint')}</Text>
      <Text style={headingStyle}>{t('agents.reviewer')}</Text>
      <IsleSelect value={form.reviewerMode} options={(['off', 'read_only'] as const).map((value) => ({ value, label: t(`agents.reviewerModes.${value}`) }))}
        onChange={(value) => { if (!busy) { setForm({ ...form, reviewerMode: value as AgentDefinitionForm['reviewerMode'], maxReviews: value === 'off' ? '0' : form.maxReviews === '0' ? '1' : form.maxReviews }); setDirty(true) } }} />
      {form.reviewerMode === 'read_only' ? <>{field('reviewerAgentId')}{field('maxReviews', { numeric: true })}</> : null}
      <Text style={headingStyle}>{t('agents.budget')}</Text>
      {(['modelRequests', 'tools', 'tokens', 'activeMinutes', 'amountUsd'] as const).map((key) => field(key, { numeric: true }))}
      {form.amountUsd ? <Text style={bodyStyle}>{t('agents.priceWarning')}</Text> : null}
      <Text style={headingStyle}>{t('agents.children')}</Text>
      {(['maxConcurrent', 'maxTotal', 'maxDepth'] as const).map((key) => field(key, { numeric: true }))}
      <View style={rowsStyle}>
        <IsleButton label={t('common.save')} tone="primary" busy={busy} disabled={busy || !dirty} onPress={() => { void operation(async () => {
          let definition: AgentDefinition
          try { definition = agentDefinitionFromForm(form) } catch { setFeedback('invalid'); return }
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
      <Text style={bodyStyle}>{item.modelBinding.providerId} · {item.modelBinding.modelId} · {t(`agents.capabilities.${item.modelBinding.actionCapability}`)}</Text>
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
