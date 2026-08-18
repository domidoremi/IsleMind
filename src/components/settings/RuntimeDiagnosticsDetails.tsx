import { useMemo, useState } from 'react'
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { MotiView } from 'moti'
import { useTranslation } from 'react-i18next'

import { AppIcon } from '@/components/ui/AppIcon'
import { ISLE_MIN_TOUCH_TARGET, IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import type { RuntimeDiagnosticsSummary } from '@/services/runtimeDiagnostics'
import type { PluginManifestCatalogSnapshot } from '@/services/pluginManifest'
import { motionTokens } from '@/theme/animation'

interface RuntimeDiagnosticsDetailsProps {
  diagnostics: RuntimeDiagnosticsSummary
  pluginCatalog: PluginManifestCatalogSnapshot | null
}

const PRIMARY_DIAGNOSTIC_KEYS = new Set([
  'providers',
  'provider-health',
  'runtime-timeline',
  'runtime-performance',
  'proxy',
  'responses',
  'compact',
  'log',
])

/** Heavy, low-frequency diagnostic projection loaded only after its Settings panel opens. */
export function RuntimeDiagnosticsDetails({
  diagnostics,
  pluginCatalog,
}: RuntimeDiagnosticsDetailsProps) {
  const { t } = useTranslation()
  const motion = useMotionPreference()
  const { colors } = useAppTheme()
  const { width } = useWindowDimensions()
  const compact = width < 430
  const [showAll, setShowAll] = useState(false)
  const diagnosticRows = useMemo(
    () => buildDiagnosticRows(diagnostics, t, pluginCatalog),
    [diagnostics, pluginCatalog, t],
  )
  const primaryRows = useMemo(() => {
    const rows = diagnosticRows.filter((row) => PRIMARY_DIAGNOSTIC_KEYS.has(row.key) || row.tone === 'amber' || row.tone === 'danger')
    return rows.length ? rows : diagnosticRows.slice(0, 1)
  }, [diagnosticRows])
  const visibleRows = showAll ? diagnosticRows : primaryRows
  const hiddenRowCount = Math.max(0, diagnosticRows.length - primaryRows.length)
  const attentionCount = diagnosticRows.filter(
    (row) => row.tone === 'amber' || row.tone === 'danger',
  ).length
  const foldoutMotion = {
    type: 'timing' as const,
    duration: motion === 'full' ? motionTokens.duration.fast : 1,
  }

  return (
    <MotiView
      key="runtime-diagnostic-details-foldout"
      accessibilityLabel={t('settings.runtimeDiagnosticDetailsSummary', {
        count: diagnosticRows.length,
        attention: attentionCount,
      })}
      from={motion === 'full' ? { opacity: 0, translateY: 8 } : { opacity: 0 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={foldoutMotion}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
    >
      {visibleRows.map((row) => (
        <DiagnosticPill
          key={row.key}
          label={row.label}
          value={row.value}
          tone={row.tone}
          colors={colors}
          compact={compact}
        />
      ))}
      {hiddenRowCount > 0 ? (
        <IslePressable
          haptic
          accessibilityRole="button"
          accessibilityLabel={showAll
            ? t('settings.runtimeDiagnosticShowCore')
            : t('settings.runtimeDiagnosticShowAll', { count: hiddenRowCount })}
          accessibilityState={{ expanded: showAll }}
          onPress={() => setShowAll((value) => !value)}
          style={{
            minHeight: ISLE_MIN_TOUCH_TARGET,
            width: '100%',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 12,
            borderRadius: Math.min(colors.ui.radius.card, 8),
            borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth,
            borderColor: colors.ui.limeRoad ? colors.material.stroke : colors.ui.semantic.chrome.border,
            backgroundColor: colors.ui.semantic.surface.muted,
          }}
        >
          <Text style={{ color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: '800' }}>
            {showAll
              ? t('settings.runtimeDiagnosticShowCore')
              : t('settings.runtimeDiagnosticShowAll', { count: hiddenRowCount })}
          </Text>
          <MotiView
            animate={{ rotate: showAll ? '180deg' : '0deg' }}
            transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1 }}
          >
            <AppIcon name="collapse" color={colors.textSecondary} size={17} />
          </MotiView>
        </IslePressable>
      ) : null}
    </MotiView>
  )
}

function buildDiagnosticRows(
  diagnostics: RuntimeDiagnosticsSummary,
  t: ReturnType<typeof useTranslation>['t'],
  pluginCatalog?: PluginManifestCatalogSnapshot | null
): Array<{ key: string; label: string; value: string; tone: 'mint' | 'amber' | 'danger' | 'default' }> {
  const rows: Array<{ key: string; label: string; value: string; tone: 'mint' | 'amber' | 'danger' | 'default' }> = [
    {
      key: 'responses',
      label: t('settings.runtimeDiagnosticResponses'),
      value: t('settings.runtimeDiagnosticResponsesValue', {
        ready: diagnostics.responses.readyProviders,
        capable: diagnostics.responses.capableProviders,
        active: Object.keys(diagnostics.responses.activeProtocols).length,
      }),
      tone: diagnostics.responses.readyProviders ? 'mint' : diagnostics.responses.capableProviders ? 'amber' : 'default',
    },
    {
      key: 'websocket',
      label: t('settings.runtimeDiagnosticWebSocket'),
      value: t('settings.runtimeDiagnosticWebSocketValue', {
        mode: t(`settings.transport${diagnostics.websocket.mode === 'auto' ? 'Auto' : diagnostics.websocket.mode === 'http' ? 'Http' : 'WebSocket'}`),
        ready: diagnostics.websocket.readyProviders,
        capable: diagnostics.websocket.capableProviders,
        fallback: diagnostics.websocket.fallbackCount,
      }),
      tone: diagnostics.websocket.mode === 'websocket' && !diagnostics.websocket.readyProviders ? 'amber' : 'mint',
    },
    {
      key: 'compact',
      label: t('settings.runtimeDiagnosticCompact'),
      value: t('settings.runtimeDiagnosticCompactValue', {
        mode: t(`settings.compact${diagnostics.compact.mode === 'off' ? 'Off' : diagnostics.compact.mode === 'auto' ? 'Auto' : 'Required'}`),
        count: diagnostics.compact.requestCount,
        remote: diagnostics.compact.remoteRequestCount,
        local: diagnostics.compact.localCompressionCount,
        fallback: diagnostics.compact.localFallbackCount,
        ready: diagnostics.compact.readyProviders,
        capable: diagnostics.compact.capableProviders,
        saved: diagnostics.compact.estimatedSavedTokens,
        localSaved: diagnostics.compact.localEstimatedSavedTokens,
        localRatio: formatCompactRatio(diagnostics.compact.localAverageCompressionRatio),
        fallbackReasons: [
          diagnostics.compact.fallbackReasons.belowThreshold ? t('settings.runtimeDiagnosticCompactReasonBelowThreshold', { count: diagnostics.compact.fallbackReasons.belowThreshold }) : null,
          diagnostics.compact.fallbackReasons.providerCapabilityMissing ? t('settings.runtimeDiagnosticCompactReasonCapabilityMissing', { count: diagnostics.compact.fallbackReasons.providerCapabilityMissing }) : null,
          diagnostics.compact.fallbackReasons.disabled ? t('settings.runtimeDiagnosticCompactReasonDisabled', { count: diagnostics.compact.fallbackReasons.disabled }) : null,
        ].filter(Boolean).join(' · '),
      }),
      tone: diagnostics.compact.failureCount ? 'amber' : 'mint',
    },
    {
      key: 'context-control-plane',
      label: t('settings.runtimeDiagnosticContextControlPlane'),
      value: t('settings.runtimeDiagnosticContextControlPlaneValue', {
        planned: diagnostics.contextControlPlane.planned,
        compact: diagnostics.contextControlPlane.compactDecided,
        capped: diagnostics.contextControlPlane.cappedFragments,
        cache: diagnostics.contextControlPlane.cacheDiagnostics,
        rewrite: diagnostics.contextControlPlane.fullRewriteDetected,
        unbounded: diagnostics.contextControlPlane.unboundedBlocked,
        manifest: diagnostics.contextControlPlane.manifests,
        manifestIssues: diagnostics.contextControlPlane.manifestIssues,
        examples: formatContextControlPlaneExamples(diagnostics.contextControlPlane.recentExamples, t),
      }),
      tone: diagnostics.contextControlPlane.unboundedBlocked || diagnostics.contextControlPlane.fullRewriteDetected || diagnostics.contextControlPlane.manifestIssues ? 'amber' : diagnostics.contextControlPlane.planned ? 'mint' : 'default',
    },
    {
      key: 'policy',
      label: t('settings.runtimeDiagnosticPolicy'),
      value: t('settings.runtimeDiagnosticPolicyValue', {
        payload: t(`settings.payload${diagnostics.policy.payloadMode === 'off' ? 'Off' : diagnostics.policy.payloadMode === 'warn' ? 'Warn' : 'Block'}`),
        rules: diagnostics.policy.providerAllowRules + diagnostics.policy.providerBlockRules + diagnostics.policy.modelAllowRules + diagnostics.policy.modelBlockRules,
      }),
      tone: diagnostics.policy.payloadMode === 'block' ? 'amber' : 'default',
    },
    {
      key: 'rectification',
      label: t('settings.runtimeDiagnosticRectification'),
      value: t('settings.runtimeDiagnosticRectificationValue', {
        total: diagnostics.rectification.total,
        retrying: diagnostics.rectification.retrying,
        success: diagnostics.rectification.success,
        failed: diagnostics.rectification.failed,
        examples: formatRectificationExamples(diagnostics.rectification.recentExamples, t),
      }),
      tone: diagnostics.rectification.failed ? 'amber' : diagnostics.rectification.success ? 'mint' : 'default',
    },
    {
      key: 'provider-health',
      label: t('settings.runtimeDiagnosticProviderHealth'),
      value: t('settings.runtimeDiagnosticProviderHealthValue', {
        cooldown: diagnostics.providerHealth.cooldown,
        circuit: diagnostics.providerHealth.circuitOpen,
        quota: diagnostics.providerHealth.quotaExhausted,
        credential: diagnostics.providerHealth.credentialUnhealthy,
        examples: formatProviderHealthExamples(diagnostics.providerHealth.recentExamples, t),
      }),
      tone: diagnostics.providerHealth.circuitOpen || diagnostics.providerHealth.quotaExhausted || diagnostics.providerHealth.credentialUnhealthy ? 'amber' : diagnostics.providerHealth.cooldown ? 'default' : 'mint',
    },
    {
      key: 'session-affinity',
      label: t('settings.runtimeDiagnosticSessionAffinity'),
      value: t('settings.runtimeDiagnosticSessionAffinityValue', {
        resolved: diagnostics.sessionAffinity.resolved,
        bound: diagnostics.sessionAffinity.bound,
        invalidated: diagnostics.sessionAffinity.invalidated,
        rotated: diagnostics.sessionAffinity.rotated,
        examples: formatSessionAffinityExamples(diagnostics.sessionAffinity.recentExamples, t),
      }),
      tone: diagnostics.sessionAffinity.invalidated || diagnostics.sessionAffinity.rotated ? 'amber' : diagnostics.sessionAffinity.bound ? 'mint' : 'default',
    },
    {
      key: 'request-examples',
      label: t('settings.runtimeDiagnosticRequestExamples'),
      value: t('settings.runtimeDiagnosticRequestExamplesValue', {
        examples: formatRequestExamples(diagnostics.requestExamples, t),
      }),
      tone: diagnostics.requestExamples.some((example) => example.kind === 'conformance_block' || example.kind === 'fallback') ? 'amber' : diagnostics.requestExamples.length ? 'mint' : 'default',
    },
    {
      key: 'runtime-timeline',
      label: t('settings.runtimeDiagnosticTimeline'),
      value: t('settings.runtimeDiagnosticTimelineValue', {
        total: diagnostics.timeline.counts.total,
        provider: diagnostics.timeline.counts.byStage.provider,
        contextCount: diagnostics.timeline.counts.byStage.context,
        compact: diagnostics.timeline.counts.byStage.compact,
        plugin: diagnostics.timeline.counts.byStage.plugin,
        tool: diagnostics.timeline.counts.byStage.tool,
        session: diagnostics.timeline.counts.byStage.session,
        blocked: diagnostics.timeline.counts.byStatus.blocked,
        error: diagnostics.timeline.counts.byStatus.error,
        running: diagnostics.timeline.counts.byStatus.running,
        issues: diagnostics.timeline.issues.length,
        repairs: diagnostics.timeline.repairPlan.taskCount,
        examples: formatRuntimeTimelineExamples(diagnostics.timeline.entries, t),
        issueExamples: formatRuntimeTimelineIssues(diagnostics.timeline.issues, t),
        repairExamples: formatRuntimeTimelineRepairTasks(diagnostics.timeline.repairPlan, t),
      }),
      tone: diagnostics.timeline.issues.some((issue) => issue.severity === 'critical') || diagnostics.timeline.counts.byStatus.error
        ? 'danger'
        : diagnostics.timeline.issues.some((issue) => issue.severity === 'warning') || diagnostics.timeline.counts.byStatus.blocked
          ? 'amber'
          : diagnostics.timeline.counts.total ? 'mint' : 'default',
    },
    {
      key: 'runtime-performance',
      label: t('settings.runtimeDiagnosticPerformance'),
      value: t('settings.runtimeDiagnosticPerformanceValue', {
        duration: diagnostics.performance.buildDurationMs,
        tail: diagnostics.performance.logTailBytes,
        parsed: diagnostics.performance.parsedLogEntries,
        rawParsed: diagnostics.performance.rawParsedLogEntries,
        logLimit: diagnostics.performance.logEntryLimit,
        merged: diagnostics.performance.mergedLogEntries,
        memory: diagnostics.performance.memoryEventEntries,
        timeline: diagnostics.performance.timelineInputEvents,
        timelineLimit: diagnostics.performance.timelineEventLimit,
      }),
      tone: diagnostics.performance.parsedLogEntryLimitApplied || diagnostics.performance.timelineInputEvents >= diagnostics.performance.timelineEventLimit || diagnostics.performance.buildDurationMs > 750
        ? 'amber'
        : diagnostics.performance.mergedLogEntries ? 'mint' : 'default',
    },
    {
      key: 'observability',
      label: t('settings.runtimeDiagnosticObservability'),
      value: t('settings.runtimeDiagnosticObservabilityValue', {
        mode: t(`settings.runtimeDiagnosticObservabilityMode.${diagnostics.observability.mode}`),
        network: diagnostics.observability.networkExportAllowed ? t('settings.runtimeDiagnosticObservabilityAllowed') : t('settings.runtimeDiagnosticObservabilityBlocked'),
        local: diagnostics.observability.localDiagnosticsAllowed ? t('settings.runtimeDiagnosticObservabilityAllowed') : t('settings.runtimeDiagnosticObservabilityBlocked'),
        endpoint: t(`settings.runtimeDiagnosticObservabilityEndpoint.${diagnostics.observability.endpointKind}`),
        highFrequency: t(`settings.runtimeDiagnosticObservabilityHighFrequency.${diagnostics.observability.highFrequencyExportMode}`),
        attr: diagnostics.observability.effectiveAttributeLimit,
        string: diagnostics.observability.effectiveAttributeStringLimit,
        preview: t(`settings.runtimeDiagnosticObservabilityPreviewStatus.${diagnostics.observability.previewStatus}`),
        events: diagnostics.observability.previewEventCount,
        eventLimit: diagnostics.observability.previewEventLimit,
        spans: diagnostics.observability.previewSpanCount,
        failures: formatObservabilityPreviewFailures(diagnostics.observability.previewFailureCodes, t),
        blocks: formatObservabilityPolicyBlockReasons(diagnostics.observability.blockReasons, t),
        warnings: formatObservabilityPolicyWarnings(diagnostics.observability.warnings, t),
      }),
      tone: diagnostics.observability.networkExportAllowed ? 'mint' : diagnostics.observability.localDiagnosticsAllowed ? 'amber' : 'default',
    },
    ...(pluginCatalog
      ? [{
          key: 'plugin-catalog',
          label: t('settings.runtimeDiagnosticPluginCatalog'),
          value: t('settings.runtimeDiagnosticPluginCatalogValue', {
            total: pluginCatalog.counts.total,
            valid: pluginCatalog.counts.valid,
            invalid: pluginCatalog.counts.invalid,
            enabled: pluginCatalog.counts.enabled,
            hooks: pluginCatalog.counts.hooks,
            noop: pluginCatalog.counts.noopHooks,
            executable: pluginCatalog.counts.executableHooks,
            approved: pluginCatalog.reviewStates.approved,
            unreviewed: pluginCatalog.reviewStates.unreviewed,
            capabilities: formatPluginCatalogCapabilities(pluginCatalog.requiredCapabilities, t),
          }),
          tone: pluginCatalog.counts.executableHooks || pluginCatalog.counts.invalid
            ? 'danger'
            : pluginCatalog.reviewStates.unreviewed || pluginCatalog.counts.warnings
              ? 'amber'
              : pluginCatalog.counts.total ? 'mint' : 'default',
        } as const]
      : []),
    {
      key: 'proxy',
      label: t('settings.runtimeDiagnosticProxy'),
      value: [
        t(`settings.runtimeProxyReason.${diagnostics.proxy.reason}`),
        ...diagnostics.proxy.warnings.map((warning) => t(`settings.runtimeProxyWarning.${warning}`)),
      ].filter(Boolean).join(' · '),
      tone: diagnostics.proxy.reason === 'invalid_custom_base_url' ? 'danger' : diagnostics.proxy.warnings.length ? 'amber' : diagnostics.proxy.applied ? 'mint' : 'default',
    },
    {
      key: 'providers',
      label: t('settings.runtimeDiagnosticProviders'),
      value: t('settings.runtimeDiagnosticProvidersValue', {
        ready: diagnostics.providers.ready,
        enabled: diagnostics.providers.enabled,
        alias: diagnostics.providers.aliasProviders,
      }),
      tone: diagnostics.providers.degraded ? 'amber' : 'mint',
    },
    {
      key: 'provider-coverage',
      label: t('settings.runtimeDiagnosticProviderCoverage'),
      value: t('settings.runtimeDiagnosticProviderCoverageValue', {
        official: diagnostics.capabilityMatrix.hostingProfiles.official,
        aggregator: diagnostics.capabilityMatrix.hostingProfiles.aggregator,
        relay: diagnostics.capabilityMatrix.hostingProfiles.relay,
        local: diagnostics.capabilityMatrix.hostingProfiles['local-runtime'],
        hosted: diagnostics.capabilityMatrix.hostingProfiles['cloud-hosted'],
      }),
      tone: diagnostics.capabilityMatrix.hostingProfiles['cloud-hosted'] ? 'amber' : 'mint',
    },
    {
      key: 'provider-support',
      label: t('settings.runtimeDiagnosticProviderSupport'),
      value: t('settings.runtimeDiagnosticProviderSupportValue', {
        full: diagnostics.capabilityMatrix.supportLevels.full,
        partial: diagnostics.capabilityMatrix.supportLevels.partial,
        planned: diagnostics.capabilityMatrix.supportLevels.planned,
        hosted: diagnostics.capabilityMatrix.hostedGapProviders,
        modelList: diagnostics.capabilityMatrix.genericModelListSuppressedProviders,
      }),
      tone: diagnostics.capabilityMatrix.plannedProviders ? 'amber' : diagnostics.capabilityMatrix.partialProviders ? 'default' : 'mint',
    },
    {
      key: 'provider-support-evidence',
      label: t('settings.runtimeDiagnosticProviderSupportEvidence'),
      value: t('settings.runtimeDiagnosticProviderSupportEvidenceValue', {
        planned: formatCapabilityMatrixExamples(diagnostics.capabilityMatrix.statusExamples.planned, t),
        partial: formatCapabilityMatrixExamples(diagnostics.capabilityMatrix.statusExamples.partial, t),
      }),
      tone: diagnostics.capabilityMatrix.statusExamples.planned.length ? 'amber' : 'default',
    },
    {
      key: 'provider-contract',
      label: t('settings.runtimeDiagnosticProviderContract'),
      value: t('settings.runtimeDiagnosticProviderContractValue', {
        ready: diagnostics.compatibility.conformanceReadyProviders,
        mapped: diagnostics.compatibility.docsMappedProviders,
        live: diagnostics.compatibility.needsLiveSmokeProviders,
        reference: diagnostics.compatibility.protocolReferenceProviders,
        gates: diagnostics.compatibility.liveSmokeGateCount,
        logged: diagnostics.compatibility.loggedEvents,
      }),
      tone: diagnostics.compatibility.needsLiveSmokeProviders || diagnostics.compatibility.docsMappedProviders ? 'amber' : 'mint',
    },
    {
      key: 'provider-capability-status',
      label: t('settings.runtimeDiagnosticCapabilityStatus'),
      value: t('settings.runtimeDiagnosticCapabilityStatusValue', {
        supported: diagnostics.compatibility.capabilityStatuses.supported,
        partial: diagnostics.compatibility.capabilityStatuses.partial,
        unsupported: diagnostics.compatibility.capabilityStatuses.unsupported,
        live: diagnostics.compatibility.capabilityStatuses.requiresLiveKey,
        docs: diagnostics.compatibility.capabilityStatuses.docsChanged,
      }),
      tone: diagnostics.compatibility.capabilityStatuses.docsChanged || diagnostics.compatibility.capabilityStatuses.requiresLiveKey ? 'amber' : 'default',
    },
    {
      key: 'provider-capability-send-policy',
      label: t('settings.runtimeDiagnosticCapabilitySendPolicy'),
      value: t('settings.runtimeDiagnosticCapabilitySendPolicyValue', {
        contract: diagnostics.compatibility.capabilitySendSources.contract,
        identity: diagnostics.compatibility.capabilitySendSources.provider_identity,
        declared: diagnostics.compatibility.capabilitySendSources.explicit_declaration,
        blocked: diagnostics.compatibility.capabilitySendSources.blocked,
        examples: formatCapabilitySendPolicyExamples(diagnostics.compatibility.capabilitySendPolicyExamples.explicit_declaration, t),
      }),
      tone: diagnostics.compatibility.capabilitySendSources.explicit_declaration ? 'amber' : 'default',
    },
    {
      key: 'provider-capability-evidence',
      label: t('settings.runtimeDiagnosticCapabilityEvidence'),
      value: t('settings.runtimeDiagnosticCapabilityEvidenceValue', {
        unsupported: formatCapabilityStatusExamples(diagnostics.compatibility.capabilityStatusExamples.unsupported, t),
        live: formatCapabilityStatusExamples(diagnostics.compatibility.capabilityStatusExamples.requiresLiveKey, t),
        partial: formatCapabilityStatusExamples(diagnostics.compatibility.capabilityStatusExamples.partial, t),
      }),
      tone: diagnostics.compatibility.capabilityStatusExamples.requiresLiveKey.length ? 'amber' : 'default',
    },
    {
      key: 'media-generation-evidence',
      label: t('settings.runtimeDiagnosticMediaGeneration'),
      value: t('settings.runtimeDiagnosticMediaGenerationValue', {
        sourceBacked: diagnostics.mediaGeneration.sourceBackedModels,
        overclaims: diagnostics.mediaGeneration.unsafeProviderWideDeclarations,
        inferred: diagnostics.mediaGeneration.inferredOnlyModels,
        ready: diagnostics.mediaGeneration.maxReady,
        total: diagnostics.mediaGeneration.total,
        proofCaptured: diagnostics.mediaGeneration.adapterProofWorklist.capturedRows,
        proofRows: diagnostics.mediaGeneration.adapterProofWorklist.rowCount,
        proofBlocked: diagnostics.mediaGeneration.adapterProofWorklist.blockedRows,
        examples: formatMediaGenerationExamples(diagnostics.mediaGeneration.examples, t),
      }),
      tone: diagnostics.mediaGeneration.adapterProofWorklist.defaultEnablementBlocked || diagnostics.mediaGeneration.unsafeProviderWideDeclarations || diagnostics.mediaGeneration.inferredOnlyModels || diagnostics.mediaGeneration.sourceBackedModels ? 'amber' : 'default',
    },
    {
      key: 'log',
      label: t('settings.runtimeDiagnosticLog'),
      value: diagnostics.log.enabled ? t('settings.runtimeDiagnosticLogOn') : t('settings.runtimeDiagnosticLogOff'),
      tone: diagnostics.log.enabled ? 'mint' : 'default',
    },
  ]
  return rows
}

function formatCompactRatio(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0%'
  return `${Math.round(value * 100)}%`
}

function formatPluginCatalogCapabilities(capabilities: Record<string, number>, t: ReturnType<typeof useTranslation>['t']): string {
  const examples = Object.entries(capabilities)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
  if (!examples.length) return t('settings.runtimeDiagnosticCapabilityEvidenceNone')
  return examples.map(([capability, count]) => `${capability} ${count}`).join(' · ')
}

function formatObservabilityPolicyBlockReasons(
  reasons: RuntimeDiagnosticsSummary['observability']['blockReasons'],
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!reasons.length) return t('settings.runtimeDiagnosticCapabilityEvidenceNone')
  return reasons.slice(0, 4).map((reason) => t(`settings.runtimeDiagnosticObservabilityBlockReason.${reason}`)).join(' · ')
}

function formatObservabilityPolicyWarnings(
  warnings: RuntimeDiagnosticsSummary['observability']['warnings'],
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!warnings.length) return t('settings.runtimeDiagnosticCapabilityEvidenceNone')
  return warnings.slice(0, 3).map((warning) => t(`settings.runtimeDiagnosticObservabilityWarning.${warning}`)).join(' · ')
}

function formatObservabilityPreviewFailures(
  failureCodes: RuntimeDiagnosticsSummary['observability']['previewFailureCodes'],
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!failureCodes.length) return t('settings.runtimeDiagnosticObservabilityPreviewFailuresNone')
  return failureCodes.slice(0, 3).join(' · ')
}

function formatCapabilityStatusExamples(
  examples: RuntimeDiagnosticsSummary['compatibility']['capabilityStatusExamples'][keyof RuntimeDiagnosticsSummary['compatibility']['capabilityStatusExamples']],
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!examples.length) return t('settings.runtimeDiagnosticCapabilityEvidenceNone')
  return examples.slice(0, 2).map((example) => {
    const provider = example.providerName || example.providerId || example.compatibilityId
    const gate = example.liveSmokeGates[0] ? `/${example.liveSmokeGates[0]}` : ''
    const reason = t(`settings.runtimeDiagnosticCapabilityReason.${example.limitationReason}`)
    const path = t(`settings.runtimeDiagnosticCapabilityPath.${example.degradationPath}`)
    return `${provider}:${example.capability} ${reason}/${path}${gate}`
  }).join(' · ')
}

function formatMediaGenerationExamples(
  examples: RuntimeDiagnosticsSummary['mediaGeneration']['examples'],
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!examples.length) return t('settings.runtimeDiagnosticCapabilityEvidenceNone')
  return examples.slice(0, 3).map((example) => {
    const provider = example.providerName || example.providerId || 'provider'
    const source = t(`settings.runtimeDiagnosticMediaGenerationSource.${example.source}`)
    const kind = t(`settings.runtimeDiagnosticMediaGenerationKind.${example.kind}`)
    return `${provider}:${example.model}:${kind} ${source} ${example.ready}/${example.total}`
  }).join(' · ')
}

function formatCapabilitySendPolicyExamples(
  examples: RuntimeDiagnosticsSummary['compatibility']['capabilitySendPolicyExamples'][keyof RuntimeDiagnosticsSummary['compatibility']['capabilitySendPolicyExamples']],
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!examples.length) return t('settings.runtimeDiagnosticCapabilityEvidenceNone')
  return examples.slice(0, 2).map((example) => {
    const provider = example.providerName || example.providerId || example.compatibilityId
    const source = t(`settings.runtimeDiagnosticCapabilitySendSource.${example.sendSource}`)
    const path = t(`settings.runtimeDiagnosticCapabilityPath.${example.degradationPath}`)
    return `${provider}:${example.capability} ${source}/${path}`
  }).join(' · ')
}

function formatCapabilityMatrixExamples(
  examples: RuntimeDiagnosticsSummary['capabilityMatrix']['statusExamples'][keyof RuntimeDiagnosticsSummary['capabilityMatrix']['statusExamples']],
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!examples.length) return t('settings.runtimeDiagnosticCapabilityEvidenceNone')
  return examples.slice(0, 2).map((example) => {
    const provider = example.providerName || example.providerId || example.compatibilityId
    const contract = example.contractStatus ? `/${example.contractStatus}` : ''
    const reason = example.limitationReason ? t(`settings.runtimeDiagnosticCapabilityReason.${example.limitationReason}`) : example.reason
    const path = example.degradationPath ? `/${t(`settings.runtimeDiagnosticCapabilityPath.${example.degradationPath}`)}` : ''
    return `${provider}:${example.area} ${example.level}${contract} ${reason}${path}`
  }).join(' · ')
}

function formatRectificationExamples(
  examples: RuntimeDiagnosticsSummary['rectification']['recentExamples'],
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!examples.length) return t('settings.runtimeDiagnosticCapabilityEvidenceNone')
  return examples.slice(0, 2).map((example) => {
    const provider = example.providerId || example.model || 'provider'
    const fields = [...example.failedFields.slice(0, 2), ...example.removedFields.slice(0, 2), ...example.retainedFields.slice(0, 2)]
    const fieldLabel = fields.length ? `:${Array.from(new Set(fields)).join('/')}` : ''
    const status = example.status ? `/${example.status}` : ''
    return `${provider}:${example.kind} ${example.result}${status}${fieldLabel}`
  }).join(' · ')
}

function formatProviderHealthExamples(
  examples: RuntimeDiagnosticsSummary['providerHealth']['recentExamples'],
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!examples.length) return t('settings.runtimeDiagnosticCapabilityEvidenceNone')
  return examples.slice(0, 2).map((example) => {
    const provider = example.providerId || example.model || 'provider'
    const group = example.credentialGroupId ? `/${example.credentialGroupId}` : ''
    const trigger = example.trigger ? `/${example.trigger}` : ''
    const status = example.status ? `/${example.status}` : ''
    return `${provider}${group} ${t(`settings.runtimeDiagnosticProviderHealthReason.${example.reason}`)}${trigger}${status}`
  }).join(' · ')
}

function formatSessionAffinityExamples(
  examples: RuntimeDiagnosticsSummary['sessionAffinity']['recentExamples'],
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!examples.length) return t('settings.runtimeDiagnosticCapabilityEvidenceNone')
  return examples.slice(0, 2).map((example) => {
    const provider = example.providerId || example.model || 'provider'
    const group = example.toGroupId || example.credentialGroupId || example.fromGroupId
    const groupLabel = group ? `/${group}` : ''
    const trigger = example.trigger ? `/${example.trigger}` : ''
    const status = example.upstreamStatus ? `/${example.upstreamStatus}` : ''
    return `${provider}${groupLabel} ${t(`settings.runtimeDiagnosticSessionAffinityStatus.${example.status}`)}${trigger}${status}`
  }).join(' · ')
}

function formatContextControlPlaneExamples(
  examples: RuntimeDiagnosticsSummary['contextControlPlane']['recentExamples'],
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!examples.length) return t('settings.runtimeDiagnosticCapabilityEvidenceNone')
  return examples.slice(0, 2).map((example) => {
    const provider = example.providerId || example.model || 'context'
    if (example.event === 'context.compact.decided') {
      return `${provider} compact ${example.compactMode ?? 'unknown'}/${example.compactEnabled ? 'on' : 'off'}/${example.compactReason ?? 'unknown'}`
    }
    const manifest = example.contextManifestSchema ? `/manifest ${example.contextManifestFailureCodes?.length ?? 0}` : ''
    return `${provider} fragments ${example.fragmentCount ?? 0}/capped ${example.cappedFragmentCount ?? 0}/cache ${example.cacheDiagnosticCount ?? 0}${manifest}`
  }).join(' · ')
}

function formatRequestExamples(
  examples: RuntimeDiagnosticsSummary['requestExamples'],
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!examples.length) return t('settings.runtimeDiagnosticCapabilityEvidenceNone')
  return examples.slice(0, 3).map((example) => {
    const provider = [example.providerId, example.model].filter(Boolean).join('/') || 'request'
    const label = t(`settings.runtimeDiagnosticRequestExampleKind.${example.kind}`)
    const detail = [
      example.protocol,
      example.status,
      example.reason,
      example.trigger,
      example.selectedProviderId ? `${example.selectedProviderId}${example.selectedModel ? `/${example.selectedModel}` : ''}` : undefined,
    ].filter(Boolean).join('/')
    return detail ? `${provider} ${label}:${detail}` : `${provider} ${label}`
  }).join(' · ')
}

function formatRuntimeTimelineExamples(
  entries: RuntimeDiagnosticsSummary['timeline']['entries'],
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!entries.length) return t('settings.runtimeDiagnosticCapabilityEvidenceNone')
  return entries.slice(-3).reverse().map((entry) => {
    const stage = t(`settings.runtimeDiagnosticTimelineStage.${entry.stage}`)
    const status = t(`settings.runtimeDiagnosticTimelineStatus.${entry.status}`)
    const scope = [entry.providerId, entry.model].filter(Boolean).join('/') || entry.conversationId || entry.event
    return `${stage}/${status} ${scope}:${entry.event}`
  }).join(' · ')
}

function formatRuntimeTimelineIssues(
  issues: RuntimeDiagnosticsSummary['timeline']['issues'],
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!issues.length) return t('settings.runtimeDiagnosticCapabilityEvidenceNone')
  return issues.slice(0, 3).map((issue) => {
    const label = t(`settings.runtimeDiagnosticTimelineIssue.${issue.code}`)
    const severity = t(`settings.runtimeDiagnosticTimelineSeverity.${issue.severity}`)
    const nextAction = t(`settings.runtimeDiagnosticTimelineNextAction.${issue.nextAction}`)
    const target = t(`settings.runtimeDiagnosticTimelineActionTarget.${issue.actionTarget.kind}`)
    const scope = [issue.providerId, issue.model].filter(Boolean).join('/') || issue.event
    return `${severity} ${label} ${scope} x${issue.count} -> ${nextAction} @ ${target}`
  }).join(' · ')
}

function formatRuntimeTimelineRepairTasks(
  repairPlan: RuntimeDiagnosticsSummary['timeline']['repairPlan'],
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!repairPlan.tasks.length) return t('settings.runtimeDiagnosticCapabilityEvidenceNone')
  return repairPlan.tasks.slice(0, 3).map((task) => {
    const severity = t(`settings.runtimeDiagnosticTimelineSeverity.${task.severity}`)
    const action = t(`settings.runtimeDiagnosticTimelineNextAction.${task.action}`)
    const target = t(`settings.runtimeDiagnosticTimelineActionTarget.${task.target.kind}`)
    const scope = [task.target.providerId, task.target.model].filter(Boolean).join('/') || task.target.conversationId || task.target.event
    return `${severity} ${action} @ ${target} ${scope} x${task.eventCount}`
  }).join(' · ')
}

function DiagnosticPill({
  label,
  value,
  tone,
  colors,
  compact,
}: {
  label: string
  value: string
  tone: 'mint' | 'amber' | 'danger' | 'default'
  colors: ReturnType<typeof useAppTheme>['colors']
  compact: boolean
}) {
  const toneToken = tone === 'mint'
    ? colors.ui.tone.success
    : tone === 'amber'
      ? colors.ui.tone.warning
      : tone === 'danger'
      ? colors.ui.tone.danger
      : colors.ui.tone.neutral
  return (
    <View style={{ minHeight: 58, minWidth: 0, flexGrow: 1, flexShrink: 1, flexBasis: compact ? '100%' : '47%', borderRadius: Math.min(colors.ui.radius.card, 8), padding: 9, backgroundColor: toneToken.background, borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth, borderColor: toneToken.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: toneToken.foreground }} />
        <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: '800', includeFontPadding: false, textAlignVertical: 'center' }}>{label}</Text>
      </View>
      <Text numberOfLines={compact ? 3 : 2} style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, fontWeight: '800', marginTop: 5, includeFontPadding: false, textAlignVertical: 'center' }}>{value}</Text>
    </View>
  )
}
