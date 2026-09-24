import { useCallback, useRef, useState } from 'react'
import { ScrollView, Switch, Text, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { IsleButton, IsleInput, IslePanel, IsleSelect } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import type { AgentTaskRuntime } from '@/bootstrap/agentTaskRuntime'
import type { AgentDefinition, AssistantRunSummary } from '@/modules/assistant-runtime'

/** Task commands are injected; this screen never owns an executor or a polling loop. */
export function AgentTasksScreen({ runtime, conversationId, onOpenRun, onManageAgents }: {
  runtime: AgentTaskRuntime; conversationId?: string; onOpenRun(id: string): void; onManageAgents(): void
}) {
  const { t } = useTranslation(); const { colors } = useAppTheme()
  const [agents, setAgents] = useState<AgentDefinition[]>([])
  const [runs, setRuns] = useState<readonly AssistantRunSummary[]>([])
  const [agentId, setAgentId] = useState(''); const [text, setText] = useState('')
  const [taskKind, setTaskKind] = useState<'chat' | 'research' | 'artifact'>('chat')
  const [background, setBackground] = useState(false); const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false); const [loading, setLoading] = useState(true)
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
    setLoading(true); setError(false)
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
    locked.current = true; setBusy(true); setError(false)
    const epoch = lifetime.current
    try {
      const input = { conversationId, agentId, text, background, taskKind }
      const run = await runtime.start(input)
      if (epoch === lifetime.current) { setText(''); onOpenRun(run.id) }
    } catch { if (epoch === lifetime.current) setError(true) }
    finally { locked.current = false; setBusy(false) }
  }
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 16 }}>
    <Text style={body}>{t('agentTasks.newRunHint')}</Text>
    {error ? <Text accessibilityRole="alert" style={body}>{t('agentTasks.failed')}</Text> : null}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      <IsleButton label={t('agents.title')} onPress={onManageAgents} disabled={busy} />
      <IsleButton label={t('agentTasks.refresh')} onPress={() => setRefresh((n) => n + 1)} disabled={busy} />
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
      <IsleButton label={t('agentTasks.start')} onPress={() => { void start() }} disabled={busy || loading || error || !agentId || !text.trim()} />
    </IslePanel> : <Text style={body}>{t('agentTasks.openConversation')}</Text>}
    <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>{t('agentTasks.history')}</Text>
    {!runs.length && !loading && !error ? <Text style={body}>{t('agentTasks.empty')}</Text> : null}
    {runs.map((run) => <IslePanel key={run.id} contentStyle={{ padding: 14, gap: 8 }}>
      <Text selectable style={body}>{run.model} · {new Date(run.createdAt).toLocaleString()}</Text>
      <Text style={body}>{run.engineVersion ? t(`agentTasks.status.${run.status}`) : t('agentTasks.legacy')}</Text>
      <IsleButton label={t('agentTasks.openRun')} accessibilityLabel={`${t('agentTasks.openRun')} ${run.id}`} onPress={() => onOpenRun(run.id)} />
    </IslePanel>)}
  </ScrollView>
}
