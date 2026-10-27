import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, View } from 'react-native'
import { Text } from '@/components/ui/AppText'
import { useTranslation } from 'react-i18next'
import { useNetworkState } from 'expo-network'
import { IsleButton, IsleInput, IslePanel, IsleSelect } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import type { ProviderModelAccessPolicy, ProviderModelAvailabilityPort, ProviderModelCurrent, ProviderModelHistoryFilter, ProviderModelHistoryPage } from '@/modules/providers'
import type { ProviderCredentialSource } from '@/types/providerContracts'
import { credentialSourceLabel, hasCredentialBlockEvidence } from './modelAvailabilityPresentation'
import { resolveProviderDisplayName } from './providerPresentation'
import { useModelAvailabilityPage } from './useModelAvailabilityPage'

type AvailabilityListItem = { kind: 'current'; row: ProviderModelCurrent }
  | { kind: 'history'; row: ProviderModelHistoryPage['items'][number] }
  | { kind: 'history-heading' }

export function ModelAvailabilityScreen({ initialProviderId = '', availability, pageSize, getProviderTestModel }: {
  initialProviderId?: string
  availability: ProviderModelAvailabilityPort
  pageSize: number
  getProviderTestModel: ProviderModelAccessPolicy['getPolicyPreferredProviderModel']
}) {
  const { t } = useTranslation()
  const { colors } = useAppTheme()
  const network = useNetworkState()
  const offline = network.isConnected === false || network.isInternetReachable === false
  const providers = useSettingsStore((state) => state.providers)
  const settings = useSettingsStore((state) => state.settings)
  const [providerId, setProviderId] = useState(initialProviderId)
  const [credential, setCredential] = useState('all')
  const [model, setModel] = useState('')
  const [range, setRange] = useState('all')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [operationsOpen, setOperationsOpen] = useState(false)
  const [evidenceSource, setEvidenceSource] = useState<ProviderModelHistoryFilter['source']>()
  const [filter, setFilter] = useState<ProviderModelHistoryFilter>(initialProviderId ? { providerId: initialProviderId } : {})
  const [revision, setRevision] = useState(0)
  const [operation, setOperation] = useState<'refresh' | 'model' | 'provider'>()
  const [operationResult, setOperationResult] = useState<{ scope: object; outcome: 'recorded' | 'failed' | 'cancelled' }>()
  const [cancelling, setCancelling] = useState(false)
  const operationController = useRef<{ controller: AbortController; scope: object } | undefined>(undefined)
  const mounted = useRef(true)
  const provider = providers.find((item) => item.id === providerId)
  const source = useMemo<ProviderCredentialSource | undefined>(() => credential === 'primary' ? { kind: 'primary' }
    : credential === 'none' ? { kind: 'none' } : credential.startsWith('group:') ? { kind: 'group', groupId: credential.slice(6) } : undefined, [credential])
  const operationKey = JSON.stringify([providerId, credential, model.trim(), offline, provider && [
    provider.enabled, provider.type, provider.presetId, provider.baseUrl, provider.wireProtocol,
    provider.credentialMode, provider.tokenPlanRegion, provider.clientCompatibilityProfile,
    provider.credentialGroups?.map(group => [group.id, group.enabled, group.source]),
    getProviderTestModel(provider, settings),
  ]])
  const operationScope = useRef({ key: operationKey, availability })
  if (operationScope.current.key !== operationKey || operationScope.current.availability !== availability) {
    operationScope.current = { key: operationKey, availability }
  }
  const currentScope = operationScope.current
  const page = useModelAvailabilityPage(availability, pageSize, filter, revision)
  // Current summaries must be windowed too: putting them in ListHeaderComponent
  // eagerly mounts the entire page before the history list can become responsive.
  const rows = useMemo<AvailabilityListItem[]>(() => [
    ...page.current.map((row): AvailabilityListItem => ({ kind: 'current', row })),
    { kind: 'history-heading' },
    ...(page.history?.items ?? []).map((row): AvailabilityListItem => ({ kind: 'history', row })),
  ], [page.current, page.history])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; operationController.current?.controller.abort() }
  }, [])
  useEffect(() => {
    const pending = operationController.current
    if (pending && pending.scope !== currentScope) {
      pending.controller.abort()
      setCancelling(true)
    }
  }, [currentScope])
  const credentialOptions = useMemo(() => [
    { value: 'all', label: t('modelAvailability.allCredentials') },
    { value: 'primary', label: t('modelAvailability.primaryCredential') },
    { value: 'none', label: t('modelAvailability.noCredential') },
    ...(provider?.credentialGroups ?? []).filter((group) => group.source?.kind !== 'primary').map((group) => ({
      value: `group:${group.id}`, label: credentialSourceLabel({ kind: 'group', groupId: group.id }, provider, t),
    })),
  ], [provider, t])
  const providerLabel = useCallback((id: string) => {
    const item = providers.find((candidate) => candidate.id === id)
    return item ? resolveProviderDisplayName(item, t('providerSettings.customProvider')) : id
  }, [providers, t])
  const textStyle = useMemo(() => ({ color: colors.textSecondary, fontSize: 14, lineHeight: 20 }), [colors.textSecondary])
  const headingStyle = useMemo(() => ({ color: colors.text, fontSize: 15, fontWeight: '700' as const }), [colors.text])
  const scopeLabel = (row: ProviderModelHistoryPage['items'][number]) => `${providerLabel(row.providerId)} · ${credentialSourceLabel(row.credentialSource, providers.find((item) => item.id === row.providerId), t)} · ${row.protocolAdapterId}`
  const observationLabel = (row: ProviderModelHistoryPage['items'][number]) => [new Date(row.observedAt).toLocaleString(),
    t(`modelAvailability.source.${row.source}`), t(`modelAvailability.classification.${row.classification}`), row.httpStatus ? `HTTP ${row.httpStatus}` : undefined].filter(Boolean).join(' · ')

  const applyFilter = useCallback(() => {
    const duration = range === 'day' ? 24 * 60 * 60 * 1000 : range === 'week' ? 7 * 24 * 60 * 60 * 1000 : undefined
    setFilter({ ...(providerId ? { providerId } : {}), ...(source ? { credentialSource: source } : {}),
      ...(model.trim() ? { modelId: model.trim() } : {}), ...(duration ? { from: Math.max(0, Date.now() - duration) } : {}),
      ...(evidenceSource ? { source: evidenceSource } : {}) })
    setRevision((value) => value + 1)
  }, [providerId, source, model, range, evidenceSource])

  const runOperation = useCallback(async (kind: 'refresh' | 'model' | 'provider') => {
    const currentProvider = useSettingsStore.getState().providers.find(item => item.id === providerId)
    if (!mounted.current || currentScope !== operationScope.current || !provider || !currentProvider?.enabled ||
      offline || operationController.current) return
    const controller = new AbortController()
    const pending = { controller, scope: currentScope }
    operationController.current = pending; setOperation(kind); setOperationResult(undefined); setCancelling(false)
    try {
      if (kind === 'refresh') await availability.refresh({ providerId: provider.id, credentialSource: source, signal: controller.signal })
      else {
        const target = kind === 'model' ? model.trim() : getProviderTestModel(provider, settings)
        if (!target) throw new Error('No selectable model')
        await availability.retest({ providerId: provider.id, model: target, credentialSource: source, signal: controller.signal })
      }
      if (mounted.current && currentScope === operationScope.current) {
        setOperationResult({ scope: currentScope, outcome: controller.signal.aborted ? 'cancelled' : 'recorded' })
      }
    } catch {
      if (mounted.current && currentScope === operationScope.current) {
        setOperationResult({ scope: currentScope, outcome: controller.signal.aborted ? 'cancelled' : 'failed' })
      }
    }
    finally {
      if (operationController.current === pending) {
        operationController.current = undefined
        if (mounted.current) { setOperation(undefined); setCancelling(false); setRevision((value) => value + 1) }
      }
    }
  }, [provider, providerId, offline, availability, source, model, getProviderTestModel, settings, currentScope])

  const displayedOperation = operationController.current
  const cancelOperation = useCallback(() => {
    const pending = displayedOperation
    if (!mounted.current || !pending || operationController.current !== pending || pending.controller.signal.aborted) return
    // Cancellation requests stop; the lock remains until the existing port settles.
    pending.controller.abort()
    setCancelling(true)
  }, [displayedOperation])
  const visibleResult = operationResult?.scope === currentScope ? operationResult.outcome : undefined

  // The controls do not depend on page data. Keep their element identity while
  // reads settle so native controls/animated styles are not reconciled again.
  const controls = useMemo(() => <>
      <Text style={textStyle}>{t('modelAvailability.historyHint')}</Text>
      {offline ? <Text accessibilityLiveRegion="polite" style={headingStyle}>{t('modelAvailability.offline')} — {t('modelAvailability.offlineHint')}</Text> : null}
      <IsleButton label={t('usage.filters')} onPress={() => setFiltersOpen(value => !value)} />
      {filtersOpen ? <>
      <Text style={headingStyle}>{t('modelAvailability.providerFilter')}</Text>
      <IsleSelect value={providerId} options={[{ value: '', label: t('modelAvailability.allProviders') }, ...providers.map((item) => ({ value: item.id, label: providerLabel(item.id) }))]}
        onChange={(id) => { setProviderId(id); setCredential('all') }} />
      <Text style={headingStyle}>{t('modelAvailability.credentialFilter')}</Text>
      <IsleSelect value={credential} options={credentialOptions} onChange={setCredential} />
      <IsleInput label={t('modelAvailability.modelFilter')} accessibilityLabel={t('modelAvailability.modelFilter')} value={model} onChangeText={setModel}
        maxLength={512} autoCapitalize="none" autoCorrect={false} />
      <Text style={headingStyle}>{t('modelAvailability.timeFilter')}</Text>
      <IsleSelect value={range} options={['all', 'day', 'week'].map((value) => ({ value, label: t(`modelAvailability.range.${value}`) }))} onChange={setRange} />
      <Text style={headingStyle}>{t('modelAvailability.sourceFilter')}</Text>
      <IsleSelect value={evidenceSource ?? 'all'} options={[{ value: 'all', label: t('modelAvailability.allSources') },
        ...(['discovery', 'probe', 'generation', 'lifecycle'] as const).map((value) => ({ value, label: t(`modelAvailability.source.${value}`) }))]}
        onChange={(value) => setEvidenceSource(value === 'all' ? undefined : value as ProviderModelHistoryFilter['source'])} />
      <IsleButton label={t('modelAvailability.applyFilters')} onPress={() => { applyFilter(); setFiltersOpen(false) }} />
      </> : null}
      {provider ? <IsleButton label={t('settingsWorkspace.advanced')} onPress={() => setOperationsOpen(value => !value)} /> : null}
      {provider && operationsOpen ? <View style={{ gap: 8 }}>
        {hasCredentialBlockEvidence(provider) ? <Text style={textStyle}>{t('modelAvailability.credentialBlocked')}</Text> : null}
        <Text style={textStyle}>{t('modelAvailability.retestHint')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <IsleButton compact label={t('modelAvailability.retestModel')} busy={operation === 'model'} disabled={offline || !provider.enabled || !!operation || !model.trim()} onPress={() => { void runOperation('model') }} />
          <IsleButton compact label={t('modelAvailability.retestProvider')} busy={operation === 'provider'} disabled={offline || !provider.enabled || !!operation || !getProviderTestModel(provider, settings)} onPress={() => { void runOperation('provider') }} />
          <IsleButton compact label={t('modelAvailability.refreshModels')} busy={operation === 'refresh'} disabled={offline || !provider.enabled || !!operation} onPress={() => { void runOperation('refresh') }} />
        </View>
      </View> : null}
      {operation ? <IsleButton compact label={t(cancelling ? 'modelAvailability.cancellingCheck' : 'modelAvailability.cancelCheck')}
        disabled={cancelling} onPress={cancelOperation} /> : null}
      {visibleResult ? <Text accessibilityLiveRegion="polite" style={textStyle}>{t(`modelAvailability.operation.${visibleResult}`)}</Text> : null}
    </>, [t, textStyle, headingStyle, offline, providerId, providers, providerLabel, credential, credentialOptions,
      model, range, evidenceSource, applyFilter, provider, operation, getProviderTestModel, settings, runOperation, visibleResult, filtersOpen, operationsOpen, cancelling, cancelOperation])

  return <FlatList
    testID="model-availability-history"
    data={rows}
    keyExtractor={(item) => item.kind === 'current' ? `current:${item.row.scopeId}:${item.row.modelId}`
      : item.kind === 'history' ? `history:${item.row.id}` : item.kind}
    initialNumToRender={6}
    keyboardShouldPersistTaps="handled"
    contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
    ListHeaderComponent={<View style={{ gap: 12 }}>
      {controls}
      {page.failed ? <Text accessibilityRole="alert" style={textStyle}>{t('modelAvailability.readFailed')}</Text> : null}
      {page.loading ? <Text style={textStyle}>{t('common.loading')}</Text> : null}
      <Text style={headingStyle}>{t('modelAvailability.currentState')}</Text>
      {!page.current.length && !page.loading ? <Text style={textStyle}>{t('modelAvailability.noEvidence')}</Text> : null}
    </View>}
    renderItem={({ item }) => {
      if (item.kind === 'current') {
        const row = item.row
        return <IslePanel contentStyle={{ padding: 10, gap: 4 }}>
        <Text style={headingStyle}>{providerLabel(row.providerId)} · {row.modelId}</Text>
        <Text style={textStyle}>{credentialSourceLabel(row.credentialSource, providers.find((item) => item.id === row.providerId), t)} · {row.protocolAdapterId}</Text>
        <Text style={textStyle}>{t(`modelAvailability.${row.availability}`)}{row.advertisement === 'not-advertised' ? ` · ${t('modelAvailability.notAdvertised')}` : ''}</Text>
        <Text style={textStyle}>{row.evidence ? `${t(`modelAvailability.source.${row.evidence.source}`)} · ${new Date(row.evidence.observedAt).toLocaleString()}` : t('modelAvailability.noEvidence')}</Text>
        </IslePanel>
      }
      if (item.kind === 'history-heading') return <View style={{ gap: 12 }}>
      {page.nextCurrent ? <IsleButton label={t('modelAvailability.moreCurrent')} disabled={page.loading} onPress={page.nextCurrent} /> : null}
      {page.latest ? <View style={{ gap: 4 }}><Text style={headingStyle}>{t('modelAvailability.latestObservation')}</Text><Text style={textStyle}>{scopeLabel(page.latest)} · {page.latest.modelId ?? ''}</Text><Text style={textStyle}>{observationLabel(page.latest)}</Text></View> : null}
      {page.latestFailure ? <View style={{ gap: 4 }}><Text style={headingStyle}>{t('modelAvailability.latestError')}</Text><Text style={textStyle}>{scopeLabel(page.latestFailure)} · {page.latestFailure.modelId ?? ''}</Text><Text style={textStyle}>{observationLabel(page.latestFailure)}</Text></View> : null}
      <Text style={headingStyle}>{t('modelAvailability.history')}</Text>
      {page.history ? <Text style={textStyle}>{t('modelAvailability.observationCounts', page.history.counts)}</Text> : null}
      {!page.history?.items.length && !page.loading ? <Text style={textStyle}>{t('modelAvailability.noObservations')}</Text> : null}
      </View>
      const row = item.row
      return <IslePanel contentStyle={{ padding: 10, gap: 4 }}>
        <Text style={headingStyle}>{row.modelId ?? t('modelAvailability.providerObservation')}</Text>
        <Text style={textStyle}>{scopeLabel(row)}</Text>
        <Text style={textStyle}>{observationLabel(row)}</Text>
        <Text style={textStyle}>{row.availabilityAfter ? `${t(`modelAvailability.${row.availabilityAfter}`)} · ` : ''}{t(`modelAvailability.effect.${row.effect}`)}</Text>
      </IslePanel>
    }}
    ListFooterComponent={<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      <IsleButton label={t('modelAvailability.newest')} disabled={page.loading} onPress={() => { page.newest(); setRevision((value) => value + 1) }} />
      <IsleButton label={t('modelAvailability.older')} disabled={page.loading || !page.nextHistory} onPress={page.nextHistory} />
    </View>}
  />
}
