import { useCallback, useState } from 'react'
import { View } from 'react-native'
import { Text } from '@/components/ui/AppText'
import { useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { IsleButton, IsleChip, IslePanel, IslePressable, ISLE_MIN_TOUCH_TARGET } from '@/components/ui/isle'
import { AppIcon } from '@/components/ui/AppIcon'
import { useAppTheme } from '@/hooks/useAppTheme'
import { sanitizeTraceDisplayText } from '@/core'
import type { TaskEffectCursor, TaskEffectPage } from '@/modules/tasks'
import type { AgentTaskPort } from './agentTaskPort'
import { agentEffectNeedsReview, agentEffectRows, agentStateTone } from './agentRunPresentation'

/** Actual local effects have their own journal; run completion is not a receipt. */
export function AgentTaskEffects({ runtime, runId }: { runtime: AgentTaskPort; runId: string }) {
  const { t } = useTranslation(); const { colors } = useAppTheme()
  const [before, setBefore] = useState<TaskEffectCursor>()
  const [page, setPage] = useState<TaskEffectPage>({ entries: [] })
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
          const value = await runtime.effects.list(runId, before)
          if (current) { setPage(value); setFailed(false) }
        } catch { if (current) setFailed(true) }
      } while (again && current)
      reading = false
      if (current) setLoading(false)
    }
    setLoading(true); setPage({ entries: [] }); setFailed(false)
    const unsubscribe = runtime.effects.subscribe(id => { if (id === runId) void load() })
    void load()
    return () => { current = false; unsubscribe() }
  }, [runtime, runId, before, refresh]))
  const body = { color: colors.textSecondary, fontSize: 14, lineHeight: 21 }
  if (!failed && !page.entries.length && !page.before && !before) return null
  const visibleEntries = expanded ? page.entries : page.entries.filter(entry => !entry.receipt || agentEffectNeedsReview(entry))
  return <View style={{ gap: 10 }}>
    <IslePressable testID="agent-effects-toggle" accessibilityRole="button" accessibilityLabel={t('agentTasks.localEffects')}
      accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)}
      style={{ minHeight: ISLE_MIN_TOUCH_TARGET, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text style={[body, { flex: 1, color: colors.text, fontWeight: '700' }]}>{t('agentTasks.localEffects')}</Text>
      <AppIcon name={expanded ? 'collapse' : 'back-next'} color={colors.textSecondary} size={16} />
    </IslePressable>
    {expanded || visibleEntries.length ? <Text style={body}>{t('agentTasks.localEffectsHint')}</Text> : null}
    {loading ? <Text style={body}>{t('agentTasks.loading')}</Text> : null}
    {failed ? <>
      <Text accessibilityRole="alert" style={body}>{t('agentTasks.effectLoadFailed')}</Text>
      <IsleButton label={t('agentTasks.refreshActivities')} onPress={() => setRefresh(n => n + 1)} />
    </> : null}
    {visibleEntries.map(entry => <IslePanel key={`${entry.taskId}:${entry.intent.id}`} contentStyle={{ padding: 14, gap: 8 }}>
      <View testID={`agent-effect-${entry.intent.id}`} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <Text style={{ flexShrink: 1, color: colors.text, fontWeight: '700' }}>{t(`agentTasks.fileAction.${entry.intent.action}`)}</Text>
        <IsleChip tone={agentStateTone(entry.state)}>{t(`agentTasks.effectState.${entry.state}`)}</IsleChip>
        {entry.receipt ? <IsleChip tone={entry.receipt.effect === 'none' ? 'default' : entry.receipt.effect === 'applied' ? 'mint' : 'amber'}>
          {t(`agentTasks.fileEffect.${entry.receipt.effect}`)}</IsleChip> : null}
      </View>
      {entry.receipt ? null : <Text accessibilityRole="alert" style={body}>{t('agentTasks.effectMissing')}</Text>}
      {entry.receipt && agentEffectNeedsReview(entry) ? <Text accessibilityRole="alert" style={body}>{t('agentTasks.effectReview')}</Text> : null}
      {agentEffectRows(entry).map(row => <View key={row.label} style={{ gap: 2 }}>
        <Text style={[body, { fontSize: 12, lineHeight: 17 }]}>{t(`agentTasks.effectField.${row.label}`)}</Text>
        <Text selectable style={[body, { color: colors.text }]}>{row.value}</Text>
      </View>)}
      <Text selectable style={[body, { fontSize: 12, lineHeight: 17 }]}>{sanitizeTraceDisplayText(`${entry.taskId} · ${entry.intent.id}`, 390)}</Text>
    </IslePanel>)}
    {expanded ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {page.before ? <IsleButton label={t('agentTasks.olderActivities')} disabled={loading} onPress={() => setBefore(page.before)} /> : null}
      {before ? <IsleButton label={t('agentTasks.latestActivities')} disabled={loading} onPress={() => setBefore(undefined)} /> : null}
    </View> : null}
  </View>
}
