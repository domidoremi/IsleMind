import { useEffect, useMemo, useRef, useState } from 'react'
import { BackHandler, Platform, ScrollView, StyleSheet, View } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { Text } from '@/components/ui/AppText'
import { IsleButton, IsleInput, IslePressable } from '@/components/ui/isle'
import { PageFeedbackBoundary } from '@/components/ui/PageFeedback'
import { WorkspaceTabs } from '@/presentation/layout/WorkspaceTabs'
import { WorkspaceSurface } from '@/presentation/layout/WorkspaceSurface'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import { ThemeDetailFrame } from '@/presentation/app-shell/ThemeDetailFrame'
import { normalizeModelRoutingPlan, sameModelRoute, type ModelRouteTarget, type ModelRoutingPlan } from '@/core/modelRoutingPlan'
import { buildChatModelPickerCandidates, filterChatModelPickerCandidates } from '@/components/chat/chatModelPickerPresentation'
import { resolveProviderModelAliasAccess } from '@/bootstrap/providerModelAccess'
import { SettingsEditBoundary, useSettingsDraft } from '@/components/settings/SettingsEditBoundary'

export function RoutingPlansScreen({ planId }: { planId?: string } = {}) {
  return <PageFeedbackBoundary><SettingsEditBoundary><RoutingPlansContent planId={planId} /></SettingsEditBoundary></PageFeedbackBoundary>
}

export function RoutingPlansContent({ planId }: { planId?: string } = {}) {
  const { t } = useTranslation()
  const { colors } = useAppTheme()
  const providers = useSettingsStore(state => state.providers)
  const settings = useSettingsStore(state => state.settings)
  const savePlan = useSettingsStore(state => state.saveRoutingPlan)
  const removePlan = useSettingsStore(state => state.removeRoutingPlan)
  const [draft, setDraft] = useState<ModelRoutingPlan>()
  const [original, setOriginal] = useState('')
  const [target, setTarget] = useState<'primary' | 'backup'>()
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [retryDelete, setRetryDelete] = useState<string>()
  const [discard, setDiscard] = useState(false)
  const inFlight = useRef(false)
  const openedPlan = useRef<string | undefined>(undefined)
  const [missingReference, setMissingReference] = useState(false)
  const plans = settings.modelRoutingPlans ?? []
  const dirty = !!draft && JSON.stringify(draft) !== original
  useSettingsDraft(dirty, busy, () => { setDraft(undefined); setTarget(undefined); setDiscard(false) }, JSON.stringify(draft))
  const leave = () => {
    if (inFlight.current) return
    if (draft) {
      if (dirty) { setDiscard(true); return }
      setDraft(undefined); setTarget(undefined); return
    }
    if (router.canGoBack()) router.back()
    else router.replace('/settings/providers')
  }
  useEffect(() => {
    if (Platform.OS !== 'android') return
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { leave(); return true })
    return () => listener.remove()
  }, [draft, dirty, busy])
  const candidates = useMemo(() => buildChatModelPickerCandidates({
    providers, currentProviderId: null, currentModel: null, providerFallbackName: t('providerSettings.customProvider'),
    displayAliases: settings.modelDisplayAliases,
  }), [providers, settings.modelDisplayAliases, t])
  const matches = useMemo(() => filterChatModelPickerCandidates({ candidates, scope: { kind: 'all' }, query }), [candidates, query])
  const currentPage = Math.min(page, Math.max(0, Math.ceil(matches.length / 25) - 1))
  const label = (route?: ModelRouteTarget) => route ? `${providers.find(provider => provider.id === route.providerId)?.name ?? route.providerId} · ${route.model}` : t('routing.chooseModel')
  const targetIssue = (route?: ModelRouteTarget) => {
    if (!route?.model || !route.providerId) return t('routing.chooseModel')
    const provider = providers.find(item => item.id === route.providerId)
    return !provider ? t('routing.connectionMissing') : !provider.enabled ? t('routing.connectionDisabled')
      : !resolveProviderModelAliasAccess({ provider, model: route.model, settings }).allowed ? t('routing.accessBlocked') : undefined
  }
  function edit(plan?: ModelRoutingPlan) {
    const next: ModelRoutingPlan = plan ? normalizeModelRoutingPlan(plan)! : {
      schema: 'islemind.model-routing-plan.v1', id: `route-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: '', mode: 'fallback', primary: { providerId: '', model: '' }, crossProvider: 'ask',
    }
    setDraft(next); setOriginal(JSON.stringify(next)); setTarget(undefined); setError(false); setDiscard(false)
  }
  useEffect(() => {
    if (!planId || openedPlan.current === planId || draft || inFlight.current) return
    openedPlan.current = planId
    const plan = plans.find(item => item.id === planId)
    setMissingReference(!plan)
    if (plan) edit(plan)
  }, [planId, plans, draft])
  async function persist(plan?: ModelRoutingPlan, deleteId?: string) {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError(false); setRetryDelete(undefined)
    try {
      if (deleteId) await removePlan(deleteId)
      else if (plan) await savePlan(plan)
      setDraft(undefined); setTarget(undefined); setDiscard(false)
    } catch { setError(true); setRetryDelete(deleteId) }
    finally { inFlight.current = false; setBusy(false) }
  }
  const valid = draft && normalizeModelRoutingPlan({ ...draft, name: draft.name.trim() })
  const canSave = valid && !targetIssue(valid.primary) && (valid.mode === 'fixed' || !targetIssue(valid.backup))
  const typography = colors.design!.semantic.typography
  const textStyle = { ...typography.body, color: colors.textSecondary }
  const rowStyle = { paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.ui.section.divider, gap: 10 }
  return <ThemeDetailFrame kind="providers" title={t('routing.title')} contextLabel={t('settings.title')} backLabel={t('common.back')} onBack={leave}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
      <View style={styles.content}>
        <Text style={textStyle}>{t('routing.description')}</Text>
        {missingReference ? <Text accessibilityRole="alert" style={textStyle}>{t('connectionReferences.missing')}</Text> : null}
        {error ? <View accessibilityRole="alert" style={rowStyle}>
          <Text style={textStyle}>{t('routing.saveFailed')}</Text>
          {retryDelete ? <IsleButton label={t('common.retry')} disabled={busy} onPress={() => void persist(undefined, retryDelete)} /> : null}
        </View> : null}
        {!draft ? <>
          <IsleButton testID="routing-add" label={t('routing.add')} disabled={busy || plans.length >= 50} onPress={() => edit()} />
          {!plans.length ? <Text style={textStyle}>{t('routing.empty')}</Text> : null}
          {plans.map(plan => <View key={plan.id} testID={`routing-saved-${plan.id}`} style={rowStyle}>
            <Text style={[typography.title, { color: colors.text }]}>{plan.name}</Text>
            <Text style={textStyle}>{t(`routing.${plan.mode}`)}{plan.mode === 'fallback' ? ` · ${t(`routing.${plan.crossProvider}`)}` : ''}</Text>
            <Text style={textStyle}>{t('routing.primary')}: {label(plan.primary)}</Text>
            {plan.backup ? <Text style={textStyle}>{t('routing.backup')}: {label(plan.backup)}</Text> : null}
            {[targetIssue(plan.primary), plan.backup ? targetIssue(plan.backup) : undefined].filter(Boolean).map((issue, i) => <Text key={i} style={textStyle}>{issue}</Text>)}
            <View style={styles.actions}>
              <IsleButton label={t('common.edit')} disabled={busy} onPress={() => edit(plan)} />
              <IslePressable accessibilityRole="button" accessibilityLabel={t('common.delete')} disabled={busy}
                accessibilityState={{ disabled: busy }} onPress={() => void persist(undefined, plan.id)} style={styles.textAction}>
                <Text style={[typography.label, { color: colors.ui.tone.danger.foreground }]}>{t('common.delete')}</Text>
              </IslePressable>
            </View>
          </View>)}
          <Text style={textStyle}>{t('routing.templateHint')}</Text>
        </> : <View testID="routing-editor" style={{ gap: 16 }}>
          <Text style={[typography.label, { color: colors.text }]}>{t('routing.name')}</Text>
          <IsleInput testID="routing-name" accessibilityLabel={t('routing.name')} value={draft.name} editable={!busy}
            maxLength={80} placeholder={t('routing.name')} placeholderTextColor={colors.textTertiary}
            onChangeText={name => setDraft({ ...draft, name })} inputStyle={typography.body} />
          <WorkspaceTabs role="radio" accessibilityLabel={t('routing.title')} disabled={busy}
            testID="routing-mode" value={draft.mode}
            tabs={(['fixed', 'fallback'] as const).map(value => ({ value, label: t(`routing.${value}`) }))}
            onChange={mode => setDraft({ ...draft, mode })} />
          {(['primary', ...(draft.mode === 'fallback' ? ['backup'] : [])] as ('primary' | 'backup')[]).map(role => <View key={role} style={rowStyle}>
            <Text style={[typography.label, { color: colors.text }]}>{t(`routing.${role}`)}</Text>
            <Text style={textStyle}>{label(draft[role])}</Text>
            {targetIssue(draft[role]) ? <Text style={textStyle}>{targetIssue(draft[role])}</Text> : null}
            <IsleButton testID={`routing-choose-${role}`} label={t('routing.chooseModel')} disabled={busy}
              onPress={() => { setTarget(role); setQuery(''); setPage(0) }} />
          </View>)}
          {target ? <View testID="routing-target-picker" style={rowStyle}>
            <Text style={[typography.label, { color: colors.text }]}>{t(`routing.${target}`)}</Text>
            <IsleInput testID="routing-search" accessibilityLabel={t('chat.searchProviderOrModel')} value={query}
              editable={!busy}
              onChangeText={value => { setQuery(value); setPage(0) }} autoCapitalize="none" autoCorrect={false}
              placeholder={t('chat.searchProviderOrModel')} placeholderTextColor={colors.textTertiary}
              inputStyle={typography.body} />
            {matches.slice(currentPage * 25, (currentPage + 1) * 25).map(candidate => {
              const issue = targetIssue({ providerId: candidate.provider.id, model: candidate.id })
              return <IslePressable key={candidate.key} testID={`routing-target-${candidate.provider.id}-${candidate.id}`}
                accessibilityRole="button" disabled={!!issue || busy} accessibilityState={{ disabled: !!issue || busy }}
                onPress={() => { setDraft({ ...draft, [target]: { providerId: candidate.provider.id, model: candidate.id } }); setTarget(undefined) }}
                style={{ minHeight: 48, paddingVertical: 8, gap: 3, opacity: issue ? 0.5 : 1 }}>
                <Text style={[typography.body, { color: colors.text }]}>{candidate.provider.name} · {candidate.id}</Text>
                {issue ? <Text style={textStyle}>{issue}</Text> : null}
              </IslePressable>
            })}
            {!matches.length ? <Text style={textStyle}>{t('chat.noProviderModelMatches')}</Text> : null}
            <View style={styles.actions}>
              <IsleButton label={t('routing.previous')} disabled={busy || currentPage === 0} onPress={() => setPage(currentPage - 1)} />
              <IsleButton label={t('routing.next')} disabled={busy || (currentPage + 1) * 25 >= matches.length} onPress={() => setPage(currentPage + 1)} />
              <IsleButton label={t('common.close')} disabled={busy} onPress={() => setTarget(undefined)} />
            </View>
          </View> : null}
          {draft.mode === 'fallback' ? <View style={{ gap: 8 }}>
            <Text style={textStyle}>{t('routing.crossProvider')}</Text>
            <WorkspaceTabs role="radio" accessibilityLabel={t('routing.crossProvider')} disabled={busy}
              testID="routing-consent" value={draft.crossProvider}
              tabs={(['ask', 'allow'] as const).map(value => ({ value, label: t(`routing.${value}`) }))}
              onChange={crossProvider => setDraft({ ...draft, crossProvider })} />
            <Text style={textStyle}>{t('routing.backupConsentHint')}</Text>
          </View> : null}
          <WorkspaceSurface role="reading" testID="routing-preview" style={{ gap: 12 }}>
            {draft.mode === 'fallback' && draft.backup && sameModelRoute(draft.primary, draft.backup)
              ? <Text accessibilityRole="alert" style={textStyle}>{t('routing.duplicateTarget')}</Text> : null}
            <Text style={[typography.label, { color: colors.text }]}>{t('routing.preview')}</Text>
            <Text style={textStyle}>{label(draft.primary)}{draft.mode === 'fallback' ? ` → ${label(draft.backup)}` : ''}</Text>
            <Text style={textStyle}>{t(draft.mode === 'fixed' ? 'routing.fixedHint' : 'routing.fallbackHint')}</Text>
            <Text style={textStyle}>{t('routing.previewHint')}</Text>
          </WorkspaceSurface>
          {discard ? <View style={rowStyle}>
            <Text style={textStyle}>{t('routing.unsaved')}</Text>
            <View style={styles.actions}>
              <IsleButton label={t('routing.keepEditing')} onPress={() => setDiscard(false)} />
              <IsleButton label={t('routing.discard')} onPress={() => { setDraft(undefined); setTarget(undefined); setDiscard(false) }} />
            </View>
          </View> : null}
          <View style={styles.actions}>
            <IsleButton testID="routing-save" label={t('common.save')} tone="primary" busy={busy} disabled={!canSave || busy}
              onPress={() => { if (valid && canSave) void persist(valid) }} />
            <IsleButton label={t('common.cancel')} disabled={busy} onPress={leave} />
          </View>
        </View>}
      </View>
    </ScrollView>
  </ThemeDetailFrame>
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 64, alignItems: 'center' },
  content: { width: '100%', maxWidth: 860, minWidth: 0, gap: 20 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  textAction: { minHeight: 44, minWidth: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
})
