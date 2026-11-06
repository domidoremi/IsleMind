import { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Text } from '@/components/ui/AppText'
import { IsleButton, IsleSelect, useIsleDialog } from '@/components/ui/isle'
import { SettingsNavigationRow } from '@/components/settings/SettingsNavigationRow'
import { SettingsTaskWorkspace } from '@/components/settings/SettingsTaskWorkspace'
import { useSettingsDraft, useSettingsLeave, useSettingsLifetime } from '@/components/settings/SettingsEditBoundary'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import { useChatStore } from '@/store/chatStore'
import type { ScenePlan } from '@/core'
import { SCENE_PLAN_CONFLICT, SCENE_PLAN_LIMIT } from '@/modules/settings'
import { CONVERSATION_SCENE_PLAN_BUSY, CONVERSATION_SCENE_PLAN_CONFLICT, CONVERSATION_SCENE_PLAN_MISSING } from '@/modules/conversations'
import { ScenePlanEditor } from './ScenePlanEditor'
import { ScenePlanPreview } from './ScenePlanPreview'
import { scenePlanFromForm, scenePlanToForm, type ScenePlanForm } from './scenePlanForm'
import type { ScenePlanCatalog, ScenePlanPreview as Preview, ScenePlanTarget, ScenePlanWorkspacePort } from './scenePlanWorkspacePort'

export function ScenePlansScreen({ port, conversationId, captureOnOpen = false, planId, onOpenConversation }: {
  port: ScenePlanWorkspacePort
  conversationId?: string
  captureOnOpen?: boolean
  planId?: string
  onOpenConversation(conversationId: string): void
}) {
  const { t } = useTranslation()
  const { colors } = useAppTheme()
  const typography = colors.design!.semantic.typography
  const settings = useSettingsStore(state => state.settings)
  const providers = useSettingsStore(state => state.providers)
  const savePlan = useSettingsStore(state => state.saveScenePlan)
  const removePlan = useSettingsStore(state => state.removeScenePlan)
  const conversations = useChatStore(state => state.conversations)
  const currentId = useChatStore(state => state.currentId)
  const plans = settings.scenePlans ?? []
  const threshold = settings.remoteCompactThreshold ?? 0.8
  const [task, setTask] = useState<'edit' | 'apply'>()
  const [form, setForm] = useState<ScenePlanForm>()
  const [base, setBase] = useState<{ signature: string; revision: number | null }>()
  const [selected, setSelected] = useState<ScenePlan>()
  const [target, setTarget] = useState<ScenePlanTarget>(() => conversationId || currentId
    ? { kind: 'conversation', conversationId: conversationId ?? currentId! } : { kind: 'new' })
  const [preview, setPreview] = useState<Preview>()
  const [previewInvalid, setPreviewInvalid] = useState(false)
  const [applied, setApplied] = useState<{ conversationId: string; persisted: boolean }>()
  const [catalog, setCatalog] = useState<ScenePlanCatalog>()
  const [catalogFailed, setCatalogFailed] = useState(false)
  const [catalogRefresh, setCatalogRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ key: string; error: boolean }>()
  const inFlight = useRef(false)
  const capturedRoute = useRef(false)
  const openedPlan = useRef<string | undefined>(undefined)
  const lifetime = useSettingsLifetime()
  const dialog = useIsleDialog()
  const leave = useSettingsLeave()
  const signature = JSON.stringify(form)
  const dirty = !!form && !!base && (base.revision === null || signature !== base.signature)
  const formConflict = !!form && !!base && (plans.find(plan => plan.id === form.plan.id)?.revision ?? null) !== base.revision
  const valid = form ? scenePlanFromForm(form, catalog) : undefined
  const stale = previewInvalid || !!preview && plans.find(plan => plan.id === preview.plan.id)?.revision !== preview.plan.revision
  function clearDraft() { setForm(undefined); setBase(undefined) }
  useSettingsDraft(dirty, busy, clearDraft, signature)

  useEffect(() => {
    let active = true
    setCatalogFailed(false)
    void port.loadCatalog().then(value => { if (active) setCatalog(value) })
      .catch(() => { if (active) { setCatalog(undefined); setCatalogFailed(true) } })
    return () => { active = false }
  }, [port, catalogRefresh])

  function edit(plan?: ScenePlan) {
    if (inFlight.current) return
    const source: ScenePlan = plan ?? { schema: 'islemind.scene-plan.v1', id: `scene-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: '', revision: 1, configuration: {} }
    const next = scenePlanToForm(source, threshold)
    setForm(next); setBase({ signature: JSON.stringify(next), revision: plan?.revision ?? null })
    setTask('edit'); setPreview(undefined); setApplied(undefined); setFeedback(undefined)
  }
  async function operation(work: (signal: AbortSignal) => Promise<void>, fallback: string) {
    const signal = lifetime.current?.signal
    if (inFlight.current || !signal || signal.aborted) return
    inFlight.current = true; setBusy(true); setFeedback(undefined)
    try { await work(signal) }
    catch (error) {
      if (!signal.aborted) {
        const code = error instanceof Error ? error.message : ''
        const key = code === SCENE_PLAN_CONFLICT ? 'scenes.templateConflict'
          : code === CONVERSATION_SCENE_PLAN_CONFLICT ? 'scenes.previewExpired'
            : code === CONVERSATION_SCENE_PLAN_BUSY ? 'scenes.busy'
              : code === CONVERSATION_SCENE_PLAN_MISSING ? 'scenes.missing' : fallback
        setFeedback({ key, error: true })
        if (code === CONVERSATION_SCENE_PLAN_CONFLICT) setPreviewInvalid(true)
      }
    } finally { inFlight.current = false; if (!signal.aborted) setBusy(false) }
  }
  async function capture(signal: AbortSignal) {
    if (!conversationId) return
    const configuration = await port.capture(conversationId)
    if (signal.aborted) return
    const source: ScenePlan = { schema: 'islemind.scene-plan.v1', id: `scene-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: '', revision: 1, configuration }
    const next = scenePlanToForm(source, threshold)
    setForm(next); setBase({ signature: JSON.stringify(next), revision: null }); setTask('edit')
  }
  useEffect(() => {
    if (!captureOnOpen || !conversationId || capturedRoute.current) return
    capturedRoute.current = true
    void operation(capture, 'scenes.captureFailed')
  }, [captureOnOpen, conversationId, port])
  useEffect(() => {
    if (!planId || openedPlan.current === planId || form || task || inFlight.current || captureOnOpen) return
    openedPlan.current = planId
    const plan = plans.find(item => item.id === planId)
    if (plan) edit(plan)
    else setFeedback({ key: 'connectionReferences.missing', error: true })
  }, [planId, plans, form, task, captureOnOpen])

  function openPlan(plan: ScenePlan) {
    if (inFlight.current) return
    setSelected(plan); setTask('apply'); setPreview(undefined); setApplied(undefined)
    setPreviewInvalid(false); setFeedback(undefined)
  }
  async function makePreview(signal: AbortSignal) {
    if (!selected) return
    const result = await port.preview(selected.id, target)
    if (!signal.aborted) { setPreview(result); setPreviewInvalid(false); setApplied(undefined) }
  }
  const notice = feedback ? <Text testID="scene-feedback" accessibilityRole={feedback.error ? 'alert' : undefined} accessibilityLiveRegion="polite"
    style={[typography.body, { color: feedback.error ? colors.ui.tone.warning.foreground : colors.textSecondary }]}>{t(feedback.key)}</Text> : null
  const overview = <View style={styles.root}>
    {notice}
    {captureOnOpen && conversationId && feedback?.error ? <IsleButton label={t('common.retry')} disabled={busy}
      onPress={() => void operation(capture, 'scenes.captureFailed')} /> : null}
    <Text style={[typography.label, { color: colors.text }]}>{t('scenes.savedPlans', { count: plans.length })}</Text>
    {!plans.length ? <Text style={[typography.body, { color: colors.textSecondary }]}>{t('scenes.empty')}</Text> : null}
    {plans.map((plan, index) => <View key={plan.id} style={styles.saved}>
      <SettingsNavigationRow id={`scene-saved-${plan.id}`} title={plan.name} icon="layers" last={index === plans.length - 1}
        status={t('scenes.revision', { revision: plan.revision })} detail={plan.description || t('scenes.openHint')}
        onPress={() => openPlan(plan)} />
      <IsleButton testID={`scene-edit-${plan.id}`} compact label={t('common.edit')} disabled={busy} onPress={() => edit(plan)} />
    </View>)}
    <Text style={[typography.body, { color: colors.textSecondary }]}>{t('scenes.templateHint')}</Text>
  </View>
  const editor = form ? <View style={styles.root}>
    {notice}
    {formConflict ? <View style={styles.root}>
      <Text testID="scene-template-conflict" accessibilityRole="alert" style={[typography.body, { color: colors.ui.tone.warning.foreground }]}>{t('scenes.templateConflict')}</Text>
      <IsleButton label={t('scenes.reloadTemplate')} disabled={busy || !plans.some(plan => plan.id === form.plan.id)}
        onPress={() => { const latest = plans.find(plan => plan.id === form.plan.id); if (latest) void leave(() => edit(latest)) }} />
      <IsleButton testID="scene-save-as-new" label={t('scenes.saveAsNew')} disabled={busy || plans.length >= SCENE_PLAN_LIMIT}
        onPress={() => {
          const next = { ...form, plan: { ...form.plan, id: `scene-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, revision: 1 } }
          setForm(next); setBase({ signature: JSON.stringify(next), revision: null }); setFeedback(undefined)
        }} />
    </View> : null}
    <ScenePlanEditor form={form} catalog={catalog} catalogFailed={catalogFailed} providers={providers}
      routingPlans={settings.modelRoutingPlans ?? []} disabled={busy} reloadCatalog={() => setCatalogRefresh(value => value + 1)}
      onChange={value => { if (!inFlight.current) { setForm(value); setFeedback(undefined) } }} />
    {!valid && form.plan.name.trim() ? <Text testID="scene-invalid" style={[typography.body, { color: colors.ui.tone.warning.foreground }]}>{t('scenes.invalid')}</Text> : null}
    <View style={styles.actions}>
      <IsleButton testID="scene-save" label={t('common.save')} tone="primary" busy={busy} disabled={!valid || busy || formConflict || !base}
        onPress={() => { if (valid && base) void operation(async signal => {
          await savePlan(valid, base.revision)
          if (!signal.aborted) { clearDraft(); setTask(undefined); setFeedback({ key: 'scenes.saved', error: false }) }
        }, 'scenes.saveFailed') }} />
      <IsleButton label={t('common.cancel')} disabled={busy} onPress={() => void leave(() => { clearDraft(); setTask(undefined) })} />
      {base?.revision !== null && base?.revision !== undefined ? <IsleButton testID="scene-delete" label={t('common.delete')} tone="danger" disabled={busy}
        onPress={() => void operation(async signal => {
          if (!await dialog.confirm({ title: t('scenes.deleteTitle'), message: t('scenes.deleteMessage', { name: form.plan.name }),
            confirmLabel: t('common.delete'), cancelLabel: t('common.cancel'), tone: 'danger', signal }) || signal.aborted) return
          await removePlan(form.plan.id, base.revision!)
          if (!signal.aborted) { clearDraft(); setTask(undefined); setFeedback({ key: 'scenes.deleted', error: false }) }
        }, 'scenes.deleteFailed')} /> : null}
    </View>
  </View> : null
  const targetValue = target.kind === 'new' ? 'new' : `conversation:${target.conversationId}`
  const targetOptions = [{ value: 'new', label: t('scenes.newConversation') },
    ...conversations.map(conversation => ({ value: `conversation:${conversation.id}`, label: conversation.title || t('chat.newConversation') }))]
  if (target.kind === 'conversation' && !targetOptions.some(option => option.value === targetValue)) targetOptions.push({ value: targetValue, label: target.conversationId })
  const application = selected ? <View style={styles.root}>
    {notice}
    {applied ? <View testID="scene-applied" style={styles.root}>
      <Text accessibilityLiveRegion="polite" style={[typography.body, { color: colors.text }]}>{t(applied.persisted ? 'scenes.applied' : 'scenes.draftApplied')}</Text>
      <IsleButton testID="scene-open-conversation" label={t('scenes.openConversation')} onPress={() => onOpenConversation(applied.conversationId)} />
    </View> : <>
      <Text style={[typography.body, { color: colors.textSecondary }]}>{t('scenes.chooseTargetHint')}</Text>
      <Text style={[typography.label, { color: colors.text }]}>{t('scenes.target')}</Text>
      <IsleSelect testID="scene-target" accessibilityLabel={t('scenes.target')} value={targetValue} options={targetOptions} disabled={busy}
        onChange={value => {
          if (inFlight.current) return
          setTarget(value === 'new' ? { kind: 'new' } : { kind: 'conversation', conversationId: value.slice('conversation:'.length) })
          setPreview(undefined); setPreviewInvalid(false); setFeedback(undefined)
        }} />
      {!preview ? <IsleButton testID="scene-preview" label={t('scenes.preview')} tone="primary" busy={busy} disabled={busy}
        onPress={() => void operation(makePreview, 'scenes.previewFailed')} /> : <ScenePlanPreview
          preview={preview} providers={providers} threshold={threshold} declarationMode={settings.toolDeclarationMode ?? 'full'} stale={stale} busy={busy}
          onRefresh={() => void operation(makePreview, 'scenes.previewFailed')}
          onApply={() => { if (!stale) void operation(async signal => {
            const result = await port.apply(preview, signal)
            if (!signal.aborted) setApplied({ conversationId: result.conversation.id, persisted: result.persisted })
          }, 'scenes.applyFailed') }} />}
    </>}
    <IsleButton label={t('scenes.editTemplate')} disabled={busy} onPress={() => {
      const latest = plans.find(plan => plan.id === selected.id)
      if (latest) edit(latest)
    }} />
  </View> : null
  return <View testID="scene-plans-screen" style={styles.root}>
    <SettingsTaskWorkspace value={task ?? null}
      onTaskChange={id => {
        if (inFlight.current) return
        if (id === 'edit' && !form) {
          if (plans.length < SCENE_PLAN_LIMIT) edit()
          else setFeedback({ key: 'scenes.limit', error: true })
          return
        }
        setTask(id === 'edit' || id === 'apply' ? id : undefined)
        if (!id) { clearDraft(); setSelected(undefined); setPreview(undefined); setApplied(undefined) }
      }}
      tasks={[{ id: 'edit', title: form ? t(base?.revision === null ? 'scenes.create' : 'scenes.editTemplate') : t('scenes.create'),
        description: t('scenes.createHint'), icon: 'layers', content: editor },
      ...(selected ? [{ id: 'apply', title: selected.name, description: t('scenes.openHint'), icon: 'layers' as const, content: application }] : [])]}
      overview={overview} />
  </View>
}

const styles = StyleSheet.create({
  root: { minWidth: 0, gap: 18 },
  saved: { minWidth: 0, gap: 4, alignItems: 'stretch' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
})
