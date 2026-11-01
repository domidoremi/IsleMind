import { useCallback, useRef, useState } from 'react'
import { ScrollView, StyleSheet, Switch, View } from 'react-native'
import { Text } from '@/components/ui/AppText'
import { useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { IsleButton, IsleInput, IslePanel, IslePressable, IsleSelect } from '@/components/ui/isle'
import { IsleEmptyState } from '@/components/ui/isle/EmptyState'
import { AppIcon } from '@/components/ui/AppIcon'
import { FeedbackGlyph } from '@/components/ui/FeedbackGlyph'
import { WorkspaceIntro } from '@/components/ui/WorkspaceIntro'
import { useAppTheme } from '@/hooks/useAppTheme'
import { sanitizeTraceDisplayText } from '@/core'
import type { AgentTaskPort } from './agentTaskPort'
import type { AgentDefinition, AssistantRunSummary } from '@/modules/assistant-runtime'

/** Task commands are injected; this screen never owns an executor or a polling loop. */
export function AgentTasksScreen({ runtime, conversationId, onOpenRun, onManageAgents }: {
  runtime: AgentTaskPort; conversationId?: string; onOpenRun(id: string): void; onManageAgents(): void
}) {
  const { t } = useTranslation(); const { colors } = useAppTheme()
  const [agents, setAgents] = useState<AgentDefinition[]>([])
  const [runs, setRuns] = useState<readonly AssistantRunSummary[]>([])
  const [agentId, setAgentId] = useState(''); const [text, setText] = useState('')
  const [taskKind, setTaskKind] = useState<'chat' | 'research' | 'artifact'>('chat')
  const [background, setBackground] = useState(false); const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false); const [loading, setLoading] = useState(true)
  const [errorDetail, setErrorDetail] = useState<string>()
  const [pageAfter, setPageAfter] = useState(''); const [refresh, setRefresh] = useState(0)
  const locked = useRef(false); const lifetime = useRef(0)
  useFocusEffect(useCallback(() => {
    const epoch = ++lifetime.current
    let reading = false; let again = false
    const loadRuns = async () => {
      if (reading) { again = true; return }
      reading = true
      do {
        again = false
        try { const rows = await runtime.listRuns(conversationId); if (epoch === lifetime.current) setRuns(rows) }
        catch { if (epoch === lifetime.current) setError(true) }
      } while (again && epoch === lifetime.current)
      reading = false
    }
    setLoading(true); setError(false); setErrorDetail(undefined)
    void Promise.all([loadRuns(), runtime.definitions.list({ afterId: pageAfter, limit: 50 }).then((rows) => {
      if (epoch === lifetime.current) { setAgents(rows); setAgentId((current) => rows.some((a) => a.id === current) ? current : rows[0]?.id ?? '') }
    })]).catch(() => { if (epoch === lifetime.current) setError(true) })
      .finally(() => { if (epoch === lifetime.current) setLoading(false) })
    const unsubscribe = runtime.subscribe(({ journalEntry }) => { if (journalEntry.type !== 'stream.event') void loadRuns() })
    return () => { ++lifetime.current; unsubscribe() }
  }, [runtime, conversationId, pageAfter, refresh]))
  const body = { color: colors.textSecondary, fontSize: 14, lineHeight: 21 }
  async function start() {
    if (locked.current || !conversationId || !agentId || !text.trim()) return
    locked.current = true; setBusy(true); setError(false); setErrorDetail(undefined)
    const epoch = lifetime.current
    try {
      const input = { conversationId, agentId, text, background, taskKind }
      const run = await runtime.start(input)
      if (epoch === lifetime.current) { setText(''); onOpenRun(run.id) }
    } catch (cause) {
      if (epoch === lifetime.current) {
        setError(true)
        setErrorDetail(cause instanceof Error ? sanitizeTraceDisplayText(cause.message, 400) : undefined)
      }
    }
    finally { locked.current = false; setBusy(false) }
  }
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, padding: 20, gap: 20 }}>
    <WorkspaceIntro title={t('livelyUi.agentEmptyTitle')} description={t('agentTasks.newRunHint')} icon="workflow" />
    {error ? <Text accessibilityRole="alert" style={body}>{t('agentTasks.failed')}</Text> : null}
    {error && errorDetail ? <Text selectable accessibilityLiveRegion="polite" style={body}>{errorDetail}</Text> : null}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      <IsleButton label={t('agents.title')} onPress={onManageAgents} disabled={busy} />
      <IsleButton label={t('agentTasks.refresh')} onPress={() => setRefresh((n) => n + 1)} busy={loading} disabled={busy || loading} />
    </View>
    {conversationId ? <IslePanel contentStyle={{ padding: 16, gap: 12 }}>
      <Text style={body}>{t('agentTasks.selectAgent')}</Text>
      {loading ? <Text style={body}>{t('agentTasks.loading')}</Text> : agents.length ? <IsleSelect value={agentId}
        options={agents.map((a) => ({ label: a.name, value: a.id }))} onChange={(id) => { if (!busy) setAgentId(id) }} />
        : <Text style={body}>{t('agentTasks.noAgents')}</Text>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {pageAfter ? <IsleButton label={t('agentTasks.firstPage')} onPress={() => setPageAfter('')} disabled={busy} /> : null}
        {agents.length === 50 ? <IsleButton label={t('agentTasks.nextPage')} onPress={() => setPageAfter(agents[49].id)} disabled={busy} /> : null}
      </View>
      <IsleSelect value={taskKind} options={(['chat', 'research', 'artifact'] as const).map((value) => ({ value, label: t(`agentTasks.kind.${value}`) }))}
        onChange={(value) => { if (!busy) setTaskKind(value as typeof taskKind) }} />
      <IsleInput label={t('agentTasks.request')} accessibilityLabel={t('agentTasks.request')} value={text}
        onChangeText={setText} multiline numberOfLines={5} maxLength={32_000} editable={!busy} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text style={[body, { flex: 1 }]}>{t('agentTasks.background')}</Text>
        <Switch value={background} onValueChange={setBackground} disabled={busy} accessibilityLabel={t('agentTasks.background')}
          trackColor={{ true: colors.ui.control.primaryBackground }} />
      </View>
      <Text style={body}>{t('agentTasks.backgroundHint')}</Text>
      <IsleButton label={t('agentTasks.start')} onPress={() => { void start() }} busy={busy} disabled={busy || loading || error || !agentId || !text.trim()} />
    </IslePanel> : <Text style={body}>{t('agentTasks.openConversation')}</Text>}
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.ui.section.divider }}>
      <Text accessibilityRole="header" style={{ flex: 1, color: colors.text, fontSize: 18, fontWeight: '700' }}>{t('agentTasks.history')}</Text>
      <FeedbackGlyph phase={loading ? 'pending' : 'idle'} label={t('agentTasks.loading')} />
    </View>
    {!runs.length && !loading && !error ? <IsleEmptyState title={t('agentTasks.empty')} description={t('livelyUi.agentEmptyDescription')} icon="workflow" contextual /> : null}
    <View accessibilityRole="list">
      {runs.map((run) => <IslePressable key={run.id} haptic accessibilityRole="button" accessibilityLabel={`${t('agentTasks.openRun')} ${run.id}`} onPress={() => onOpenRun(run.id)}
        style={{ paddingVertical: 18, minHeight: 80, flexDirection: 'row', alignItems: 'center', gap: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.section.divider }}>
        <View pointerEvents="none" accessible={false} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: run.status === 'succeeded' ? colors.ui.tone.success.foreground : run.status === 'failed' ? colors.ui.tone.danger.foreground : colors.ui.icon.accentForeground }} />
        <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
          <Text style={{ color: colors.text, fontSize: 16, lineHeight: 24, fontWeight: '600' }}>{run.model}</Text>
          <Text style={body}>{run.engineVersion ? t(`agentTasks.status.${run.status}`) : t('agentTasks.legacy')}</Text>
          <Text style={{ color: colors.textTertiary, fontSize: 12, lineHeight: 18 }}>{new Date(run.createdAt).toLocaleString()}</Text>
        </View>
        <AppIcon name="arrow-right" size={18} color={colors.textTertiary} />
      </IslePressable>)}
    </View>
  </ScrollView>
}
