import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, BackHandler, Platform, ScrollView, StyleSheet, View } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import * as Clipboard from 'expo-clipboard'
import type { UsageDetailReference, UsageExecutionDetail, UsageRecord } from '@/modules/diagnostics'
import { Text } from '@/components/ui/AppText'
import { IsleButton, IslePressable, useIsleDialog } from '@/components/ui/isle'
import { AppIcon } from '@/components/ui/AppIcon'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import { ThemeDetailFrame } from '@/presentation/app-shell/ThemeDetailFrame'
import { mapUsageExecutionRequest, redactedUsageExecutionSummary, usageAttemptFields, usageCostSources, usageKnownCost, usageResultLabel, usagePresentationStatus } from '@/presentation/features/settings/usageExecutionPresentation'
import type { UsageRouteParams } from '@/presentation/features/settings/usageNavigation'
import { usageRouteIdentity, routeValue, parseUsageRoute, usageRouteSnapshot, buildUsageRecordFilter } from '@/presentation/features/settings/usageNavigation'
import { UsageRequestDetail } from './UsageRequestDetail'

type DetailLoader = (reference: UsageDetailReference) => Promise<UsageExecutionDetail | undefined>

export function UsageExecutionDetailScreen({ reference, params, loadDetail }: {
  reference?: UsageDetailReference
  params: UsageRouteParams
  loadDetail: DetailLoader
}) {
  const { t, i18n } = useTranslation()
  const { colors } = useAppTheme()
  const dialog = useIsleDialog()
  const providers = useSettingsStore(state => state.providers)
  const [state, setState] = useState<{ kind: 'loading' | 'missing' | 'error' } | { kind: 'ready'; detail: UsageExecutionDetail }>({ kind: 'loading' })
  const [reload, setReload] = useState(0)
  const back = useCallback(() => {
    if (router.canGoBack()) { router.back(); return }
    const conversationId = usageRouteIdentity(params.conversationId)
    const providerId = usageRouteIdentity(params.providerId)
    if (routeValue(params.returnTo) === 'chat' && conversationId) {
      router.replace({ pathname: '/chat/[id]', params: { id: conversationId } })
    } else if (routeValue(params.returnTo) === 'provider' && providerId) {
      router.replace({ pathname: '/settings/providers', params: { providerId, tab: 'usage', returnTo: 'settings' } })
    } else {
      const initial = parseUsageRoute(params)
      router.replace({ pathname: '/settings/usage', params: usageRouteSnapshot(initial.filters, initial.view, initial.offset, buildUsageRecordFilter(initial.filters)) })
    }
  }, [params.conversationId, params.providerId, params.returnTo])
  useEffect(() => {
    if (Platform.OS !== 'android') return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true })
    return () => subscription.remove()
  }, [back])
  useEffect(() => {
    let current = true
    if (!reference) { setState({ kind: 'missing' }); return }
    setState({ kind: 'loading' })
    void loadDetail(reference).then(detail => {
      if (current) setState(detail ? { kind: 'ready', detail } : { kind: 'missing' })
    }, () => { if (current) setState({ kind: 'error' }) })
    return () => { current = false }
  }, [reference?.kind, reference?.id, reload, loadDetail])
  const title = t(reference?.kind === 'response' ? 'usage.responseDetail' : 'usage.requestDetail')
  const name = (id: string) => providers.find(provider => provider.id === id)?.name ?? id
  const typography = colors.design!.semantic.typography
  return <ThemeDetailFrame kind="usage" title={title} onBack={back} backLabel={t('common.back')}>
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      {state.kind === 'loading' ? <View style={styles.placeholder}><ActivityIndicator color={colors.textSecondary} /><Text style={[typography.body, { color: colors.textSecondary }]}>{t('common.loading')}</Text></View>
        : state.kind !== 'ready' ? <View testID="usage-execution-unavailable" style={styles.placeholder}>
          <AppIcon name="history" color={colors.textSecondary} size={28} />
          <Text accessibilityRole="header" style={[typography.title, { color: colors.text }]}>{t(state.kind === 'error' ? 'usage.loadFailed' : 'usage.detailUnavailable')}</Text>
          <Text style={[typography.body, { color: colors.textSecondary }]}>{t('usage.detailMissingHint')}</Text>
          {state.kind === 'error' ? <IsleButton label={t('common.retry')} onPress={() => setReload(value => value + 1)} /> : null}
          <IsleButton label={t('common.back')} onPress={back} />
        </View> : <View testID="usage-execution-detail" style={styles.content}>
          <Text style={[typography.headline, { color: colors.text }]}>{usageKnownCost(state.detail.summary, t)}</Text>
          <Text style={[typography.body, { color: colors.textSecondary }]}>{usageCostSources(state.detail.summary, t)}</Text>
          <Text style={[typography.body, { color: colors.textSecondary }]}>{t('usage.executionCounts', {
            requests: state.detail.summary.logicalRequestCount, attempts: state.detail.summary.requestCount, historical: state.detail.summary.legacyAttemptCount,
          })}</Text>
          <Text style={[typography.body, { color: colors.textSecondary }]}>{t('usage.reportedExecutionHint')}</Text>
          {[...new Set(state.detail.attempts.map(record => record.execution?.routingPlan?.name).filter((name): name is string => !!name))]
            .map(name => <Text key={name} style={[typography.body, { color: colors.text }]}>{t('routing.receipt', { name })}</Text>)}
          {state.detail.truncated ? <Text accessibilityRole="alert" style={[typography.body, { color: colors.ui.tone.warning.foreground }]}>{t('usage.detailTruncated')}</Text> : null}
          <View style={styles.actions}>
            <IsleButton label={t('usage.copyRedactedSummary')} onPress={() => {
              void Clipboard.setStringAsync(redactedUsageExecutionSummary(state.detail, t, i18n.language)).then(ok => {
                dialog.toast({ title: t(ok ? 'common.copied' : 'chat.clipboardUnavailable'), tone: ok ? 'mint' : 'danger' })
              }).catch(() => dialog.toast({ title: t('chat.clipboardUnavailable'), tone: 'danger' }))
            }} />
            {state.detail.requests[0]?.conversationId ? <IsleButton label={t('usage.conversationUsage')} onPress={() => router.push({
              pathname: '/settings/usage', params: { conversationId: state.detail.requests[0]!.conversationId, view: 'requests', returnTo: 'settings' },
            })} /> : null}
            {state.detail.requests[0]?.conversationId ? <IsleButton label={t('usage.openConversation')} onPress={() => router.push({
              pathname: '/chat/[id]', params: { id: state.detail.requests[0]!.conversationId!, returnTo: 'settings' },
            })} /> : null}
            {state.detail.requests[0]?.conversationId ? <IsleButton label={t('usage.contextSettings')} onPress={() => router.push({
              pathname: '/settings/context', params: { conversationId: state.detail.requests[0]!.conversationId, returnTo: 'settings' },
            })} /> : null}
          </View>
          {state.detail.requests.map(request => <View key={`${request.reference.kind}:${request.reference.id}`} style={[styles.request, { borderColor: colors.ui.section.divider }]}>
            <UsageRequestDetail detail={mapUsageExecutionRequest(request, t, i18n.language, name)} redactedLabel={t('usage.redacted')}
              statusColor={request.status === 'success' ? colors.ui.tone.success.foreground : request.status === 'cancelled' ? colors.textSecondary : colors.ui.tone.warning.foreground} />
            <View style={styles.actions}>
              <IsleButton label={t('usage.openConnection')} onPress={() => router.push({
                pathname: '/settings/providers', params: { providerId: request.providerId, tab: 'connection', returnTo: 'settings' },
              })} />
              <IsleButton label={t('usage.connectionUsage')} onPress={() => router.push({
                pathname: '/settings/usage', params: { providerId: request.providerId, view: 'requests', returnTo: 'settings' },
              })} />
            </View>
            <Text accessibilityRole="header" style={[typography.title, { color: colors.text }]}>{t('usage.attemptTimeline')}</Text>
            {state.detail.attempts.filter(record => request.reference.kind === 'attempt' ? record.id === request.reference.id
              : record.execution?.logicalRequestId === request.reference.id).map((record, index) =>
              <UsageAttempt key={record.id} record={record} position={index + 1} />)}
          </View>)}
        </View>}
    </ScrollView>
  </ThemeDetailFrame>
}

function UsageAttempt({ record, position }: { record: UsageRecord; position: number }) {
  const { t, i18n } = useTranslation()
  const { colors } = useAppTheme()
  const [open, setOpen] = useState(false)
  return <View style={[styles.attempt, { borderColor: colors.ui.section.divider }]}>
    <IslePressable testID={`usage-attempt-${position}`} accessibilityRole="button" accessibilityState={{ expanded: open }}
      onPress={() => setOpen(value => !value)} style={styles.attemptHeading}>
      <Text style={[colors.design!.semantic.typography.label, { color: colors.text, flex: 1 }]}>{position}. {record.providerName} · {record.upstreamModel}</Text>
      <Text style={[colors.design!.semantic.typography.label, { color: record.status === 'success' ? colors.ui.tone.success.foreground : colors.ui.tone.warning.foreground }]}>
        {t(`usage.attemptReason.${record.attemptReason}`)} · {usageResultLabel(record.status, t)}
      </Text>
      <AppIcon name={open ? 'collapse' : 'back-next'} color={colors.textSecondary} size={16} />
    </IslePressable>
    {open ? <UsageRequestDetail detail={{
      requestId: record.id, title: t('usage.attempts'), status: usagePresentationStatus(record.status),
      statusLabel: usageResultLabel(record.status, t), fields: usageAttemptFields(record, t, i18n.language),
    }} redactedLabel={t('usage.redacted')} statusColor={colors.textSecondary} /> : null}
  </View>
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 56, alignItems: 'center' },
  content: { width: '100%', maxWidth: 920, minWidth: 0, gap: 16 },
  placeholder: { paddingVertical: 52, width: '100%', maxWidth: 480, alignItems: 'center', gap: 16 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  request: { minWidth: 0, gap: 18, paddingVertical: 20, borderTopWidth: StyleSheet.hairlineWidth },
  attempt: { minWidth: 0, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, gap: 12 },
  attemptHeading: { minHeight: 44, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center', paddingVertical: 8 },
})
