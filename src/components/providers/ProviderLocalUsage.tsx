import { useEffect, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { Text } from '@/components/ui/AppText'
import { IsleButton, IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsLeave } from '@/components/settings/SettingsEditBoundary'
import type { UsageStatisticsSnapshot } from '@/modules/diagnostics'
import { usageKnownCost, usageResultLabel } from '@/presentation/features/settings/usageExecutionPresentation'

/** Local diagnostics only. Supplier balances are queried by the separate, explicit quota action. */
export function ProviderLocalUsage({ providerId, active }: { providerId: string; active: boolean }) {
  const { t, i18n } = useTranslation()
  const { colors } = useAppTheme()
  const leave = useSettingsLeave()
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [snapshot, setSnapshot] = useState<UsageStatisticsSnapshot>()
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    if (!active) return
    let current = true
    setState('loading')
    void import('@/bootstrap/usageStatisticsRuntime').then(runtime => runtime.loadUsageStatistics({
      filter: { providerIds: [providerId], includeEstimated: true, startAt: Date.now() - 30 * 24 * 60 * 60 * 1000 },
      limit: 5,
    })).then(result => {
      if (current) { setSnapshot(result); setState('ready') }
    }, () => { if (current) setState('error') })
    return () => { current = false }
  }, [providerId, active, refresh])
  const typography = colors.design!.semantic.typography
  return <View testID="provider-local-usage" style={{ gap: 12, paddingVertical: 12 }}>
    <Text accessibilityRole="header" style={[typography.title, { color: colors.text }]}>{t('usage.connectionLocalUsage')}</Text>
    <Text style={[typography.body, { color: colors.textSecondary }]}>{t('usage.localUsageHint')}</Text>
    {state === 'loading' ? <ActivityIndicator color={colors.textSecondary} /> : state === 'error' ?
      <IsleButton label={t('common.retry')} onPress={() => setRefresh(value => value + 1)} /> : snapshot ?
      <View style={{ gap: 8 }}>
        <Text style={[typography.body, { color: colors.text }]}>{t('usage.executionCounts', {
          requests: snapshot.summary.logicalRequestCount, attempts: snapshot.summary.requestCount, historical: snapshot.summary.legacyAttemptCount,
        })}</Text>
        <Text style={[typography.body, { color: colors.text }]}>{usageKnownCost(snapshot.summary, t)}</Text>
        {!snapshot.requests.requests.length ? <Text style={[typography.body, { color: colors.textSecondary }]}>{t('usage.emptyTitle')}</Text> : null}
        {snapshot.requests.requests.map(request => <IslePressable key={`${request.reference.kind}:${request.reference.id}`}
          accessibilityRole="button" testID={`provider-recent-request-${request.reference.id}`}
          onPress={() => void leave(() => router.push({
            pathname: '/request/[id]', params: { id: request.reference.id, kind: request.reference.kind, returnTo: 'provider', providerId },
          }))} style={{ minHeight: 44, paddingVertical: 10, gap: 4 }}>
          <Text style={[typography.label, { color: colors.text }]}>{request.requestedModel} · {usageResultLabel(request.status, t)}</Text>
          <Text style={[typography.body, { color: colors.textSecondary }]}>{new Date(request.occurredAt).toLocaleString(i18n.language)} · {usageKnownCost(request.summary, t)}</Text>
        </IslePressable>)}
      </View> : null}
    <IsleButton testID="provider-open-usage" label={t('usage.viewConnectionUsage')} onPress={() => void leave(() => router.push({
      pathname: '/settings/usage', params: { providerId, view: 'requests', returnTo: 'settings' },
    }))} />
  </View>
}
