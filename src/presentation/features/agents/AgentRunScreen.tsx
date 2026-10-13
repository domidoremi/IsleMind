import { useCallback, useEffect, useRef, useState } from 'react'
import { ScrollView, Switch, View } from 'react-native'
import { Text } from '@/components/ui/AppText'
import { useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { IsleButton, IsleInput, IslePanel } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import type { AgentTaskPort } from './agentTaskPort'
import type { AssistantRun, PendingModelOperation } from '@/modules/assistant-runtime'
import { runBudgetTotals, type RunBudgetSnapshot } from '@/modules/assistant-runtime'
import { sanitizeTraceDisplayText } from '@/core'
import { agentConfirmationExpiry, agentConfirmationPreview, agentRecoveryMode, agentRunTone } from './agentRunPresentation'
import { AgentNotice } from './AgentNotice'
import { AgentOperationActivities } from './AgentOperationActivities'
import { AgentTaskEffects } from './AgentTaskEffects'
import { BUILT_IN_CAPABILITY_SERVER_ID } from '@/modules/integrations'

const PAGE = 6_000

export function AgentRunScreen({ runtime, runId, onFreshRun, onOpenRun, loadWorkspaceEditReview }: {
  runtime: AgentTaskPort; runId: string; onFreshRun(conversationId: string): void; onOpenRun(id: string): void
  loadWorkspaceEditReview?: (pending: Pick<PendingModelOperation, 'operationId' | 'continuationState'>, signal: AbortSignal) => Promise<string | undefined>
}) {
  const { t } = useTranslation(); const { colors } = useAppTheme()
  const [run, setRun] = useState<AssistantRun>(); const [budget, setBudget] = useState<RunBudgetSnapshot>()
  const [sources, setSources] = useState<Awaited<ReturnType<AgentTaskPort['sources']>>>([])
  const [loading, setLoading] = useState(true); const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState<{ key: string; detail?: string }>()
  const [now, setNow] = useState(() => Date.now())
  const [steering, setSteering] = useState(''); const [title, setTitle] = useState(''); const [page, setPage] = useState(0)
  const [background, setBackground] = useState(false); const [refresh, setRefresh] = useState(0)
  const locked = useRef(false); const lifetime = useRef(0)
  const pending = run?.pendingModelOperation
  const fileEdit = pending?.operationId === `builtin:${BUILT_IN_CAPABILITY_SERVER_ID}:edit_file`
  const [fileReview, setFileReview] = useState<{ digest: string; diff?: string; failed?: boolean }>()
  useEffect(() => {
    if (!fileEdit || !pending) return
    if (!loadWorkspaceEditReview) { setFileReview({ digest: pending.continuationDigest, failed: true }); return }
    const controller = new AbortController()
    setFileReview(undefined)
    void loadWorkspaceEditReview(pending, controller.signal)
      .then(diff => { if (!controller.signal.aborted) setFileReview({ digest: pending.continuationDigest, diff }) })
      .catch(() => { if (!controller.signal.aborted) setFileReview({ digest: pending.continuationDigest, failed: true }) })
    return () => controller.abort()
  }, [fileEdit, pending?.continuationToken, pending?.continuationDigest, loadWorkspaceEditReview])
  const currentFileReview = fileReview?.digest === pending?.continuationDigest ? fileReview : undefined
  useFocusEffect(useCallback(() => {
    const epoch = ++lifetime.current
    let latestSequence = -1
    const accept = (value: AssistantRun | undefined) => {
      if (epoch !== lifetime.current || (value ? value.journalSequence < latestSequence : latestSequence >= 0)) return
      if (value) latestSequence = value.journalSequence
      setRun(value); setBackground(runtime.backgroundEnabled(runId))
    }
    let reading: Promise<void> | undefined; let again = false
    const loadBudget = (): Promise<void> => {
      if (reading) { again = true; return reading }
      reading = (async () => {
        do {
          again = false
          const [nextBudget, nextSources] = await Promise.all([runtime.budget(runId), runtime.sources(runId)])
          if (epoch === lifetime.current) { setBudget(nextBudget); setSources(nextSources) }
        } while (again && epoch === lifetime.current)
      })().finally(() => { reading = undefined })
      return reading
    }
    const unsubscribe = runtime.subscribe(({ run: value, journalEntry }) => {
      if (value.id !== runId) return
      accept(value)
      // Token events carry the current output snapshot. They must not trigger
      // database reads for every fragment; only usage/citation/lifecycle do.
      if (journalEntry.type === 'stream.event' && !['usage', 'citation'].includes(String(journalEntry.data?.eventType))) return
      void loadBudget().catch(() => { if (epoch === lifetime.current) setFailed(true) })
    })
    setLoading(true); setFailed(false); setRun(undefined); setBudget(undefined); setSources([]); setPage(0)
    // Notification navigation does only reads, after the app's bootstrap recovery barrier.
    void Promise.all([runtime.get(runId).then(accept), loadBudget()])
      .catch(() => { if (epoch === lifetime.current) setFailed(true) })
      .finally(() => { if (epoch === lifetime.current) setLoading(false) })
    return () => { ++lifetime.current; unsubscribe() }
  }, [runtime, runId, refresh]))
  // A visible confirmation deadline must not rely on a stale first render.
  const pendingRequestedAt = run?.pendingModelOperation?.requestedAt
  useEffect(() => {
    if (pendingRequestedAt === undefined) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [pendingRequestedAt])
  const body = { color: colors.textSecondary, fontSize: 14, lineHeight: 21 }
  const row = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 }
  async function command(work: () => Promise<unknown>, success?: string) {
    if (locked.current) return
    const epoch = lifetime.current
    locked.current = true; setBusy(true); setFeedback(undefined)
    try {
      const result = await work()
      if (result && typeof result === 'object' && 'ok' in result && result.ok === false) {
        const error = 'error' in result && result.error && typeof result.error === 'object' && 'message' in result.error ? result.error.message : undefined
        throw new Error(typeof error === 'string' ? error : 'Command rejected')
      }
      if (epoch === lifetime.current) {
        setBackground(runtime.backgroundEnabled(runId))
        if (success) setFeedback({ key: success })
      }
    } catch (error) {
      // The facade message explains which guard refused the command; nothing is retried automatically.
      if (epoch === lifetime.current) setFeedback({ key: 'failed', detail: error instanceof Error ? sanitizeTraceDisplayText(error.message, 400) : undefined })
    } finally { locked.current = false; setBusy(false) }
  }
  const legacy = !!run && !run.engineVersion
  const terminal = !!run && ['succeeded', 'failed', 'cancelled'].includes(run.status)
  const preview = run ? agentConfirmationPreview(run) : undefined
  const expiry = run ? agentConfirmationExpiry(run, now) : undefined
  const recovery = run ? agentRecoveryMode(run) : undefined
  const totals = budget ? runBudgetTotals(budget, Date.now()) : undefined
  const output = run?.result?.outputText ?? run?.checkpoint?.outputText ?? ''
  const offset = Math.min(page * PAGE, Math.max(0, Math.floor((output.length - 1) / PAGE) * PAGE))
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 16 }}>
    {loading ? <Text style={body}>{t('agentTasks.loading')}</Text> : null}
    {failed ? <Text accessibilityRole="alert" style={body}>{t('agentTasks.failed')}</Text> : null}
    {!loading && !run && !failed ? <Text style={body}>{t('agentTasks.missing')}</Text> : null}
    <IsleButton label={t('agentTasks.refresh')} onPress={() => setRefresh((n) => n + 1)} disabled={busy} />
    {feedback ? <AgentNotice tone={feedback.key === 'failed' ? 'danger' : 'mint'} alert={feedback.key === 'failed'}
      label={t(feedback.key === 'failed' ? 'agentTasks.commandRefused' : 'agentTasks.commandDone')} body={t(`agentTasks.${feedback.key}`)}>
      {feedback.detail ? <Text selectable accessibilityLiveRegion="polite" style={body}>{feedback.detail}</Text> : null}
    </AgentNotice> : null}
    {run ? <>
      <AgentNotice testID="agent-run-status" tone={legacy ? 'default' : agentRunTone(run)}
        label={legacy ? t('agentTasks.legacy') : run.cancellationRequestedAt && !terminal ? t('agentTasks.cancelling') : t(`agentTasks.status.${run.status}`)}
        title={run.agentDefinition?.name ?? run.model}>
        <Text selectable style={body}>{run.id}</Text>
        {/* Only resumable runs may invite the user to continue after a restart. */}
        {run.lifecycleCheckpoint?.waitingReason && !(recovery !== 'resumable' && run.lifecycleCheckpoint.waitingReason === 'process_restart')
          ? <Text accessibilityLiveRegion="polite" style={body}>{t(`agentTasks.reason.${run.lifecycleCheckpoint.waitingReason}`)}</Text> : null}
      </AgentNotice>
      {run.lifecycleCheckpoint?.effectCertainty === 'uncertain' || recovery === 'reconciliation' ? <AgentNotice testID="agent-run-recovery" tone="amber" alert
        label={t('agentTasks.needsReview')} title={t('agentTasks.recoveryTitle')} body={t('agentTasks.uncertain')}>
        {recovery === 'reconciliation' && !legacy && !run.parentRunId ? <Text style={body}>{t('agentTasks.recoveryReconcile')}</Text> : null}
      </AgentNotice> : null}
      {run.failure ? <AgentNotice testID="agent-run-error" tone="danger" alert label={t('agentTasks.runError')} body={t('agentTasks.runErrorHint')}>
        <Text selectable style={body}>{sanitizeTraceDisplayText(run.failure.message, 2400)}</Text>
        <Text selectable style={body}>{sanitizeTraceDisplayText(run.failure.code, 120)}</Text>
      </AgentNotice> : null}
      {totals && budget ? <IslePanel contentStyle={{ padding: 14, gap: 6 }}>
        <Text style={body}>{t('agentTasks.budget', { models: totals.modelRequests, modelLimit: budget.limits.modelRequests,
          tools: totals.tools, toolLimit: budget.limits.tools, tokens: totals.chargedTokens, tokenLimit: budget.limits.tokens })}</Text>
        <Text style={body}>{t('agentTasks.usage', { actual: totals.actualTokens, estimated: totals.estimatedTokens, reserved: totals.reservedTokens,
          minutes: Math.ceil(totals.activeMs / 60_000), limit: Math.ceil(budget.limits.activeMs / 60_000) })}</Text>
        <Text style={body}>{t('agentTasks.priceUnknown')}</Text>
      </IslePanel> : null}
      {sources.length ? <IslePanel contentStyle={{ padding: 14, gap: 6 }}>
        <Text style={{ color: colors.text, fontWeight: '700' }}>{t('agentTasks.sources')}</Text>
        {sources.map((source) => <Text key={source.citationId} selectable style={body}>
          {`[${source.citationId}] ${source.title ?? ''}${source.url ? `\n${source.url}` : ''}`}
        </Text>)}
      </IslePanel> : null}
      {run.parentRunId ? <IsleButton label={t('agentTasks.parent')} onPress={() => onOpenRun(run.parentRunId!)} /> : null}
      {run.delegation?.children.length ? <IslePanel contentStyle={{ padding: 14, gap: 8 }}>
        <Text style={{ color: colors.text, fontWeight: '700' }}>{t('agentTasks.children')}</Text>
        {run.delegation.children.map((child) => <IsleButton key={child.runId} label={`${child.agentId} · ${child.role}`}
          onPress={() => onOpenRun(child.runId)} />)}
      </IslePanel> : null}
      {!legacy && !terminal && !run.parentRunId ? <>
        <View style={row}>
          {run.status === 'running' ? <IsleButton label={t('agentTasks.pause')} disabled={busy} onPress={() => { void command(() => runtime.pause(runId)) }} /> : null}
          {recovery === 'resumable' ? <IsleButton label={t('agentTasks.resume')} disabled={busy || failed}
            onPress={() => { void command(() => runtime.resume(runId)) }} /> : null}
          <IsleButton label={t('agentTasks.cancel')} disabled={busy} onPress={() => { void command(() => runtime.cancel(runId)) }} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Text style={[body, { flex: 1 }]}>{t('agentTasks.background')}</Text>
          <Switch value={background} disabled={busy || failed} accessibilityLabel={t('agentTasks.background')}
            trackColor={{ true: colors.ui.control.primaryBackground }} onValueChange={(value) => { void command(() => runtime.setBackground(runId, value)) }} />
        </View>
        <Text style={body}>{t('agentTasks.backgroundHint')}</Text>
        {run.pendingModelOperation ? <AgentNotice testID="agent-run-confirmation" tone={expiry?.expired ? 'danger' : 'amber'}
          label={t(expiry?.expired ? 'agentTasks.confirmationExpired' : 'agentTasks.status.awaiting-confirmation')} title={t('agentTasks.confirmation')}
          body={t('agentTasks.confirmationScope')}>
          {expiry ? <Text accessibilityLiveRegion="polite" style={body}>{expiry.expired ? t('agentTasks.confirmationExpiredHint')
            : t('agentTasks.confirmationExpires', { time: new Date(expiry.expiresAt).toLocaleTimeString() })}</Text> : null}
          {preview ? <>
            <Text selectable style={{ color: colors.text, fontWeight: '700' }}>{preview.operation}</Text>
            {preview.total ? <Text style={body}>{t('agentTasks.queuePosition', { position: preview.position, total: preview.total })}</Text> : null}
            <Text style={body}>{t('agentTasks.operationInput')}</Text>
            <Text selectable style={body}>{fileEdit
              ? currentFileReview?.failed ? t('chat.workspacePreviewUnavailable') : currentFileReview?.diff ?? t('common.loading')
              : preview.parameters}</Text>
          </> : <Text style={body}>{t('agentTasks.unavailablePreview')}</Text>}
          <View style={row}>{[false, true].map((approved) => <IsleButton key={String(approved)}
            label={t(approved ? expiry?.expired ? 'agentTasks.returnExpired' : 'agentTasks.approve' : 'agentTasks.decline')}
            tone={approved && !expiry?.expired ? 'primary' : 'soft'}
            disabled={busy || failed || approved && (!preview || fileEdit && !currentFileReview?.diff)} onPress={() => {
              const pending = run.pendingModelOperation!
              // An expired approval is converted by the Harness into a not-executed receipt.
              void command(() => runtime.approve(runId, approved, { continuationToken: pending.continuationToken, continuationDigest: pending.continuationDigest }))
            }} />)}</View>
        </AgentNotice> : recovery === 'reconciliation' ? null : <>
          <IsleInput label={t('agentTasks.steer')} accessibilityLabel={t('agentTasks.steer')} value={steering} onChangeText={setSteering} maxLength={8_000} multiline editable={!busy} />
          <IsleButton label={t('agentTasks.sendSteering')} disabled={busy || !steering.trim()} onPress={() => { void command(async () => {
            const result = await runtime.steer(runId, steering)
            if (result.ok) setSteering('')
            return result
          }, 'steered') }} />
        </>}
      </> : null}
      {output ? <IslePanel contentStyle={{ padding: 14, gap: 12 }}>
        <Text style={{ color: colors.text, fontWeight: '700' }}>{t('agentTasks.output')}</Text>
        <Text selectable style={{ color: colors.text, lineHeight: 23 }}>{output.slice(offset, offset + PAGE)}</Text>
        <View style={row}>
          {offset > 0 ? <IsleButton label={t('agentTasks.previousPage')} onPress={() => setPage((n) => Math.max(0, n - 1))} /> : null}
          {offset + PAGE < output.length ? <IsleButton label={t('agentTasks.nextPage')} onPress={() => setPage((n) => n + 1)} /> : null}
        </View>
        {run.status === 'succeeded' ? <>
          <IsleInput label={t('agentTasks.documentTitle')} accessibilityLabel={t('agentTasks.documentTitle')} value={title} onChangeText={setTitle} maxLength={200} editable={!busy} />
          <IsleButton label={t('agentTasks.saveDocument')} disabled={busy || !title.trim()} onPress={() => { void command(() => runtime.saveDocument(runId, title), 'saved') }} />
        </> : null}
      </IslePanel> : null}
      <AgentOperationActivities key={run.id} runtime={runtime} run={run} />
      <AgentTaskEffects key={`effects:${run.id}`} runtime={runtime} runId={run.id} />
      <IsleButton label={t('agentTasks.newRun')} onPress={() => onFreshRun(run.conversationId)} disabled={busy} />
    </> : null}
  </ScrollView>
}
