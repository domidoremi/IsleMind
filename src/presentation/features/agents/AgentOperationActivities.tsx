import { useCallback, useState } from 'react'
import { View } from 'react-native'
import { Text } from '@/components/ui/AppText'
import { useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { IsleButton, IsleChip, IslePanel, IslePressable, ISLE_MIN_TOUCH_TARGET } from '@/components/ui/isle'
import { AppIcon } from '@/components/ui/AppIcon'
import { useAppTheme } from '@/hooks/useAppTheme'
import { sanitizeTraceDisplayText } from '@/core'
import type { AssistantRun, OperationActivityPage } from '@/modules/assistant-runtime'
import type { AgentTaskPort } from './agentTaskPort'
import { agentActivityState, agentReceiptCode, agentStateTone } from './agentRunPresentation'

/** Bounded, receipt-owned list; execution never depends on whether this view is mounted. */
export function AgentOperationActivities({ runtime, run }: { runtime: AgentTaskPort; run: AssistantRun }) {
  const { t } = useTranslation(); const { colors } = useAppTheme()
  const [before, setBefore] = useState<number>()
  const [page, setPage] = useState<OperationActivityPage>({ entries: [] })
  const [loading, setLoading] = useState(true); const [failed, setFailed] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [expanded, setExpanded] = useState(false)
  useFocusEffect(useCallback(() => {
    let current = true; let reading = false; let again = false
    const load = async () => {
      if (reading) { again = true; return }
      reading = true
      do {
        again = false
        try {
          const value = await runtime.activities(run.id, before)
          if (current) { setPage(value); setFailed(false) }
        } catch { if (current) setFailed(true) }
      } while (again && current)
      reading = false
      if (current) setLoading(false)
    }
    setLoading(true); setPage({ entries: [] }); setFailed(false)
    const unsubscribe = runtime.subscribe(({ run: value, journalEntry }) => {
      if (value.id === run.id && (journalEntry.type === 'model-operation.selected'
        || journalEntry.type === 'run.awaiting-confirmation'
        || journalEntry.type === 'run.checkpointed' && journalEntry.data?.operation)) void load()
    })
    void load()
    return () => { current = false; unsubscribe() }
  }, [runtime, run.id, before, refresh]))
  const body = { color: colors.textSecondary, fontSize: 14, lineHeight: 21 }
  // The bounded read is needed to surface failures even if the overall run
  // succeeded. Empty capability panels and normal receipt bodies stay absent.
  if (!failed && !page.entries.length && !page.before && !before) return null
  const visibleEntries = expanded ? page.entries : page.entries.filter(({ trace }) =>
    trace.status === 'error' || trace.status === 'cancelled' || ['waiting', 'incomplete'].includes(agentActivityState(trace, run)))
  return <View style={{ gap: 10 }}>
    <IslePressable testID="agent-activities-toggle" accessibilityRole="button" accessibilityLabel={t('agentTasks.activities')}
      accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)}
      style={{ minHeight: ISLE_MIN_TOUCH_TARGET, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text style={[body, { flex: 1, color: colors.text, fontWeight: '700' }]}>{t('agentTasks.activities')}</Text>
      <AppIcon name={expanded ? 'collapse' : 'back-next'} color={colors.textSecondary} size={16} />
    </IslePressable>
    {loading ? <Text style={body}>{t('agentTasks.loading')}</Text> : null}
    {failed ? <>
      <Text accessibilityRole="alert" style={body}>{t('agentTasks.activityLoadFailed')}</Text>
      <IsleButton label={t('agentTasks.refreshActivities')} onPress={() => setRefresh(n => n + 1)} />
    </> : null}
    {visibleEntries.map(({ trace }) => {
      const state = agentActivityState(trace, run)
      const code = trace.status !== 'done' ? agentReceiptCode(trace.metadata?.code || trace.metadata?.errorCode) : undefined
      return <IslePanel key={trace.id} contentStyle={{ padding: 14, gap: 8 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <Text selectable style={{ flexShrink: 1, color: colors.text, fontWeight: '700' }}>{trace.title}</Text>
        <IsleChip tone={agentStateTone(state)}>{t(`agentTasks.activityState.${state}`)}</IsleChip>
      </View>
      {code ? <Text accessibilityLiveRegion="polite" style={body}>{code.key ? t(code.key) : code.raw}</Text> : null}
      {expanded && trace.metadata?.inputSummary ? <>
        <Text style={body}>{t('agentTasks.operationInput')}</Text>
        <Text selectable style={body}>{sanitizeTraceDisplayText(trace.metadata.inputSummary, 2400)}</Text>
      </> : null}
      {trace.content ? <>
        <Text style={body}>{t('agentTasks.operationResult')}</Text>
        <Text selectable style={body}>{trace.content}</Text>
      </> : null}
      {code?.key ? <Text selectable style={[body, { fontSize: 12, lineHeight: 17 }]}>{code.raw}</Text> : null}
    </IslePanel>
    })}
    {expanded ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {page.before ? <IsleButton label={t('agentTasks.olderActivities')} disabled={loading}
        onPress={() => setBefore(page.before)} /> : null}
      {before ? <IsleButton label={t('agentTasks.latestActivities')} disabled={loading}
        onPress={() => setBefore(undefined)} /> : null}
    </View> : null}
  </View>
}
