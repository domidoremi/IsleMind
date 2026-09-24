import { useCallback, useRef, useState } from 'react'
import { ScrollView, Switch, Text, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { IsleButton, IsleInput, IslePanel } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import type { AgentTaskRuntime } from '@/bootstrap/agentTaskRuntime'
import type { AssistantRun } from '@/modules/assistant-runtime'
import { runBudgetTotals, type RunBudgetSnapshot } from '@/modules/assistant-runtime/application/runBudget'
import { assertJsonTraversalBudget, redactSensitiveText } from '@/core'

const PAGE = 6_000
function confirmationPreview(run: AssistantRun) {
  if (!run.pendingModelOperation) return undefined
  try {
    const call = run.pendingModelOperation.continuationState.call
    if (!call) return undefined
    assertJsonTraversalBudget(call, 16_000)
    return redactSensitiveText(JSON.stringify(call, null, 2))
  } catch { return undefined }
}

export function AgentRunScreen({ runtime, runId, onFreshRun, onOpenRun }: {
  runtime: AgentTaskRuntime; runId: string; onFreshRun(conversationId: string): void; onOpenRun(id: string): void
}) {
  const { t } = useTranslation(); const { colors } = useAppTheme()
  const [run, setRun] = useState<AssistantRun>(); const [budget, setBudget] = useState<RunBudgetSnapshot>()
  const [sources, setSources] = useState<Awaited<ReturnType<AgentTaskRuntime['sources']>>>([])
  const [loading, setLoading] = useState(true); const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState('')
  const [steering, setSteering] = useState(''); const [title, setTitle] = useState(''); const [page, setPage] = useState(0)
  const [background, setBackground] = useState(false); const [refresh, setRefresh] = useState(0)
  const locked = useRef(false); const lifetime = useRef(0)
  useFocusEffect(useCallback(() => {
    const epoch = ++lifetime.current
    let latestSequence = -1
    const accept = (value: AssistantRun | undefined) => {
      if (epoch !== lifetime.current || value && value.journalSequence < latestSequence) return
      if (value) latestSequence = value.journalSequence
      setRun(value); setBackground(runtime.backgroundEnabled(runId))
    }
    const loadBudget = () => Promise.all([
      runtime.budget(runId).then((value) => { if (epoch === lifetime.current) setBudget(value) }),
      runtime.sources(runId).then((value) => { if (epoch === lifetime.current) setSources(value) }),
    ])
    const unsubscribe = runtime.subscribe(({ run: value, journalEntry }) => {
      if (value.id !== runId || journalEntry.type === 'stream.event') return
      accept(value)
      void loadBudget().catch(() => { if (epoch === lifetime.current) setFailed(true) })
    })
    setLoading(true); setFailed(false); setRun(undefined); setSources([]); setPage(0)
    // Notification navigation does only reads, after the app's bootstrap recovery barrier.
    void Promise.all([runtime.get(runId).then(accept), loadBudget()])
      .catch(() => { if (epoch === lifetime.current) setFailed(true) })
      .finally(() => { if (epoch === lifetime.current) setLoading(false) })
    return () => { ++lifetime.current; unsubscribe() }
  }, [runtime, runId, refresh]))
  const body = { color: colors.textSecondary, fontSize: 14, lineHeight: 21 }
  const row = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 }
  async function command(work: () => Promise<unknown>, success?: string) {
    if (locked.current) return
    const epoch = lifetime.current
    locked.current = true; setBusy(true); setFeedback('')
    try {
      const result = await work()
      if (result && typeof result === 'object' && 'ok' in result && result.ok === false) throw new Error('Command rejected')
      if (epoch === lifetime.current) {
        setBackground(runtime.backgroundEnabled(runId))
        if (success) setFeedback(success)
      }
    } catch { if (epoch === lifetime.current) setFeedback('failed') }
    finally { locked.current = false; setBusy(false) }
  }
  const legacy = !!run && !run.engineVersion
  const terminal = !!run && ['succeeded', 'failed', 'cancelled'].includes(run.status)
  const preview = run ? confirmationPreview(run) : undefined
  const totals = budget ? runBudgetTotals(budget, Date.now()) : undefined
  const output = run?.result?.outputText ?? run?.checkpoint?.outputText ?? ''
  const offset = Math.min(page * PAGE, Math.max(0, Math.floor((output.length - 1) / PAGE) * PAGE))
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 16 }}>
    {loading ? <Text style={body}>{t('agentTasks.loading')}</Text> : null}
    {failed ? <Text accessibilityRole="alert" style={body}>{t('agentTasks.failed')}</Text> : null}
    {!loading && !run && !failed ? <Text style={body}>{t('agentTasks.missing')}</Text> : null}
    <IsleButton label={t('agentTasks.refresh')} onPress={() => setRefresh((n) => n + 1)} disabled={busy} />
    {feedback ? <Text accessibilityLiveRegion="polite" style={body}>{t(`agentTasks.${feedback}`)}</Text> : null}
    {run ? <>
      <Text selectable style={body}>{run.agentDefinition?.name ?? run.model} · {run.id}</Text>
      <Text accessibilityLiveRegion="polite" style={body}>{legacy ? t('agentTasks.legacy')
        : run.cancellationRequestedAt && !terminal ? t('agentTasks.cancelling') : t(`agentTasks.status.${run.status}`)}</Text>
      {run.lifecycleCheckpoint?.waitingReason ? <Text style={body}>{t(`agentTasks.reason.${run.lifecycleCheckpoint.waitingReason}`)}</Text> : null}
      {run.lifecycleCheckpoint?.effectCertainty === 'uncertain' ? <Text style={body}>{t('agentTasks.uncertain')}</Text> : null}
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
          {run.status === 'paused' && run.lifecycleCheckpoint?.recovery === 'resumable' ? <IsleButton label={t('agentTasks.resume')} disabled={busy || failed}
            onPress={() => { void command(() => runtime.resume(runId)) }} /> : null}
          <IsleButton label={t('agentTasks.cancel')} disabled={busy} onPress={() => { void command(() => runtime.cancel(runId)) }} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Text style={[body, { flex: 1 }]}>{t('agentTasks.background')}</Text>
          <Switch value={background} disabled={busy || failed} accessibilityLabel={t('agentTasks.background')}
            trackColor={{ true: colors.ui.control.primaryBackground }} onValueChange={(value) => { void command(() => runtime.setBackground(runId, value)) }} />
        </View>
        <Text style={body}>{t('agentTasks.backgroundHint')}</Text>
        {run.pendingModelOperation ? <IslePanel contentStyle={{ padding: 14, gap: 10 }}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>{t('agentTasks.confirmation')}</Text>
          <Text selectable style={body}>{run.pendingModelOperation.operationId} · {run.pendingModelOperation.catalogRevision}\n{run.pendingModelOperation.argumentDigest}</Text>
          <Text selectable style={body}>{preview ?? t('agentTasks.unavailablePreview')}</Text>
          <View style={row}>{[false, true].map((approved) => <IsleButton key={String(approved)} label={t(approved ? 'agentTasks.approve' : 'agentTasks.decline')}
            disabled={busy || failed || approved && !preview} onPress={() => {
              const pending = run.pendingModelOperation!
              void command(() => runtime.approve(runId, approved, { continuationToken: pending.continuationToken, continuationDigest: pending.continuationDigest }))
            }} />)}</View>
        </IslePanel> : <>
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
      <IsleButton label={t('agentTasks.newRun')} onPress={() => onFreshRun(run.conversationId)} disabled={busy} />
    </> : null}
  </ScrollView>
}
