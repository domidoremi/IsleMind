import { useEffect, useMemo, useRef, useState } from 'react'
import { Linking, ScrollView, Text, View, useWindowDimensions } from 'react-native'
import type { WebViewProps } from 'react-native-webview'
import * as Clipboard from 'expo-clipboard'
import { router, useLocalSearchParams } from 'expo-router'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { MotiView } from 'moti'
import { AnimatedNavigationTrigger } from '@/components/navigation/AnimatedNavigationTrigger'
import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
import { IsleScreen, type IsleBackgroundState } from '@/components/ui/isle'
import { IslePanel } from '@/components/ui/isle'
import { IsleButton } from '@/components/ui/isle'
import { IsleChip } from '@/components/ui/isle'
import { IsleHeader, IsleIconButton, IsleSection } from '@/components/ui/isle'
import { RenderGuard } from '@/components/ui/RenderGuard'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useChatStore } from '@/store/chatStore'
import { useIsleDialog } from '@/components/ui/isle'
import type { MessageCitation, ProcessTrace } from '@/types'
import { collectVisibleProcessTraces, formatDuration, formatProcessTraceForCopy, formatProcessTraceForDisplay, isAgentIntentTrace, isAgentPlanTrace, isAgentWorkflowEnvelopeTrace, metadataSummaryForTrace, normalizeTraceStatuses, traceStageLabel, traceStatusLabel } from '@/components/chat/tracePresentation'
import { WORK_ARTIFACT_WORKFLOW_CONTRACT } from '@/services/agent/workArtifactWorkflow'
import { isAllowedWebViewNavigation, safeHttpUrl } from '@/utils/sourceUrlSafety'

type ProcessTraceGroupKey = 'agentPlan' | 'context' | 'search' | 'toolActivity' | 'agentSynthesis' | 'agentRecovery' | 'other'

export default function SourceScreen() {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const { width } = useWindowDimensions()
  const compact = width < 430
  const params = useLocalSearchParams<{ conversationId?: string; messageId?: string; citationId?: string; kind?: string; url?: string; qaErrorBoundary?: string; qaCapture?: string }>()
  const conversations = useChatStore((state) => state.conversations)
  const loadConversations = useChatStore((state) => state.load)
  const hydrationAttempted = useRef(false)
  const conversationId = firstParam(params.conversationId)
  const messageId = firstParam(params.messageId)
  const citationId = firstParam(params.citationId)
  const conversation = conversations.find((item) => item.id === conversationId)
  const message = conversation?.messages.find((item) => item.id === messageId)
  const citations = message?.citations ?? []
  const traces = useMemo(() => normalizeTraceStatuses(message ? collectVisibleProcessTraces(message) : [], message?.status ?? 'done'), [message])
  const citation = citations.find((item) => item.id === citationId) ?? citations[0]
  const explicitUrl = firstParam(params.url)
  const rawWebUrl = firstSafeParam(explicitUrl, citation?.url)
  const [webKey, setWebKey] = useState(0)
  const [readerBackgroundState, setReaderBackgroundState] = useState<IsleBackgroundState>('idle')

  const mode = firstParam(params.kind) === 'process' ? 'process' : 'source'
  const webUrl = mode === 'source' ? safeHttpUrl(rawWebUrl) : undefined
  const processBackgroundState: IsleBackgroundState = traces.some((trace) => trace.status === 'error')
    ? 'error'
    : traces.some((trace) => trace.status === 'pending' || trace.status === 'running')
      ? 'active'
      : 'idle'
  const backgroundState: IsleBackgroundState = mode === 'process'
    ? processBackgroundState
    : webUrl
      ? readerBackgroundState
      : 'idle'
  const title = mode === 'process' ? t('source.process') : citation?.title ?? t('source.source')
  const subtitle = mode === 'process'
    ? [t('source.completed', { count: traces.filter((trace) => trace.status === 'done').length }), t('source.errors', { count: traces.filter((trace) => trace.status === 'error').length }), t('source.cancelled', { count: traces.filter((trace) => trace.status === 'cancelled').length }), t('source.skipped', { count: traces.filter((trace) => trace.status === 'skipped').length })].join(' · ')
    : getSourceSubtitle(citation, webUrl, t)

  if (firstParam(params.qaErrorBoundary) === '1' && firstParam(params.qaCapture) === 'key-visual-gaps') {
    throw new Error('QA forced source render failure')
  }

  useEffect(() => {
    if (hydrationAttempted.current || !conversationId) return
    const requestedCitationMissing = !!citationId && !citations.some((item) => item.id === citationId)
    if (conversation && message && !requestedCitationMissing) return
    hydrationAttempted.current = true
    void loadConversations()
  }, [citationId, citations, conversation, conversationId, loadConversations, message])

  useEffect(() => {
    if (mode === 'process') return
    setReaderBackgroundState(webUrl ? 'active' : 'idle')
  }, [mode, webKey, webUrl])

  async function copyCurrent() {
    try {
      const content = mode === 'process'
        ? buildSourceProcessTraceCopyText(traces)
        : [citation?.title, citation?.url, citation?.excerpt].filter(Boolean).join('\n\n')
      await Clipboard.setStringAsync(content || webUrl || '')
      dialog.toast({ title: t('common.copied'), message: mode === 'process' ? t('source.processCopied') : t('source.sourceCopied'), tone: 'mint' })
    } catch {
      dialog.toast({ title: t('common.copyFailed'), message: t('source.clipboardUnavailable'), tone: 'danger' })
    }
  }

  async function openExternal() {
    if (!webUrl) return
    const supported = await Linking.canOpenURL(webUrl)
    if (supported) {
      await Linking.openURL(webUrl)
    } else {
      dialog.toast({ title: t('source.cannotOpen'), message: t('source.cannotOpenMessage'), tone: 'danger' })
    }
  }

  return (
    <IsleScreen padded={false} background={mode === 'process' ? 'surface' : 'focus'} backgroundState={backgroundState}>
      <View style={{ flex: 1 }}>
        <View pointerEvents="box-none" style={{ paddingHorizontal: compact ? 10 : 12, paddingTop: 6, paddingBottom: 8 }}>
          <IsleHeader
            title={title}
            subtitle={subtitle}
            leading={
              <AnimatedNavigationTrigger variant="iconButton" label={t('source.backToChat')} glyph="back" onNavigate={() => router.back()} color={colors.text} />
            }
            trailing={
              <View style={{ flexDirection: 'row', gap: 7 }}>
                <IsleIconButton label={t('common.copy')} size="sm" onPress={() => void copyCurrent()}>
                  <AppIcon name="copy" color={colors.textSecondary} size={17} strokeWidth={appIconStroke.fine} />
                </IsleIconButton>
                {webUrl ? (
                  <>
                    <IsleIconButton label={t('common.refresh')} size="sm" onPress={() => setWebKey((value) => value + 1)}>
                      <AppIcon name="refresh" color={colors.textSecondary} size={17} strokeWidth={appIconStroke.fine} />
                    </IsleIconButton>
                    <IsleIconButton label={t('common.openExternal')} size="sm" onPress={() => void openExternal()}>
                      <AppIcon name="external-link" color={colors.textSecondary} size={17} strokeWidth={appIconStroke.fine} />
                    </IsleIconButton>
                  </>
                ) : null}
              </View>
            }
          />
        </View>

        <RenderGuard label={mode === 'process' ? t('source.process') : t('source.source')}>
          {mode === 'process' ? (
            <ProcessReader traces={traces} />
          ) : webUrl ? (
            <WebReader key={webKey} url={webUrl} citation={citation} onOpenExternal={openExternal} onBackgroundStateChange={setReaderBackgroundState} />
          ) : (
            <LocalSourceReader citation={citation} citations={citations} />
          )}
        </RenderGuard>
      </View>
    </IsleScreen>
  )
}

function buildSourceProcessTraceCopyText(traces: ProcessTrace[]): string {
  return traces
    .filter((trace) => !trace.metadata?.hiddenSignature && Boolean(trace.title || trace.content))
    .map(formatProcessTraceForCopy)
    .filter(Boolean)
    .join('\n\n')
}

function WebReader({
  url,
  citation,
  onOpenExternal,
  onBackgroundStateChange,
}: {
  url: string
  citation?: MessageCitation
  onOpenExternal: () => Promise<void>
  onBackgroundStateChange: (state: IsleBackgroundState) => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const { width } = useWindowDimensions()
  const compact = width < 430
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [WebViewComponent, setWebViewComponent] = useState<React.ComponentType<WebViewProps> | null>(null)

  useEffect(() => {
    let mounted = true
    try {
      const webviewModule = require('react-native-webview') as typeof import('react-native-webview')
      if (mounted) {
        setWebViewComponent(() => webviewModule.WebView)
      }
    } catch {
      if (mounted) {
        setLoading(false)
        setFailed(true)
      }
    }
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    onBackgroundStateChange(failed ? 'error' : loading || !WebViewComponent ? 'active' : 'idle')
  }, [failed, loading, onBackgroundStateChange, WebViewComponent])

  return (
    <View style={{ flex: 1 }}>
      <IslePanel material="raised" elevated={false} style={{ marginHorizontal: compact ? 10 : 12, marginTop: 10, marginBottom: 8 }} radius={colors.ui.radius.panel}>
        <View style={{ paddingHorizontal: 14, paddingVertical: 11 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
            <View style={{ width: 26, height: 26, borderRadius: colors.ui.radius.controlSmall, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ui.icon.accentBackground }}>
              <AppIcon name="globe" color={colors.ui.icon.accentForeground} size={15} strokeWidth={appIconStroke.strong} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: colors.text, fontSize: 14, lineHeight: 19, fontWeight: '900', includeFontPadding: false }}>{citation?.title ?? hostFromUrl(url)}</Text>
              <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 15, marginTop: 1, includeFontPadding: false }}>{hostFromUrl(url)}</Text>
            </View>
          </View>
          {citation?.excerpt ? (
            <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 6 }}>{citation.excerpt}</Text>
          ) : null}
        </View>
      </IslePanel>
      {failed ? (
        <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
          <Text style={{ color: colors.text, fontSize: 19, fontWeight: '900' }}>{t('source.previewUnavailable')}</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 8 }}>
            {t('source.previewUnavailableMessage')}
          </Text>
          <IsleButton label={t('source.openInBrowser')} tone="primary" onPress={() => void onOpenExternal()} style={{ marginTop: 16 }} />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {loading || !WebViewComponent ? <ReaderSkeleton label={t('source.loadingPreview')} /> : null}
          {WebViewComponent ? (
            <WebViewComponent
              source={{ uri: url }}
              originWhitelist={['http://*', 'https://*']}
              startInLoadingState={false}
              onShouldStartLoadWithRequest={(request) => isAllowedWebViewNavigation(request.url)}
              onLoadEnd={() => setLoading(false)}
              onError={() => {
                setLoading(false)
                setFailed(true)
              }}
              onHttpError={() => {
                setLoading(false)
                setFailed(true)
              }}
              setSupportMultipleWindows={false}
              style={{ flex: 1, backgroundColor: colors.material.sheet.body }}
            />
          ) : null}
        </View>
      )}
    </View>
  )
}

function LocalSourceReader({ citation, citations }: { citation?: MessageCitation; citations: MessageCitation[] }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const sources = citation ? [citation, ...citations.filter((item) => item.id !== citation.id)] : citations
  if (!sources.length) {
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
        <Text style={{ color: colors.text, fontSize: 19, fontWeight: '900' }}>{t('source.noSource')}</Text>
        <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 8 }}>{t('source.noSourceMessage')}</Text>
      </View>
    )
  }
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 12, paddingBottom: 42 }}>
      {sources.map((source, index) => (
        <MotiView
          key={`${source.id}-${index}`}
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', damping: 20, stiffness: 180, delay: index * 35 }}
          style={{ marginBottom: 10 }}
        >
          <IsleSection
            elevated
            title={source.title || source.type}
            subtitle={formatCitationMeta(source, t)}
            action={<View style={{ width: 30, height: 30, borderRadius: colors.ui.radius.controlSmall, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ui.icon.accentBackground }}><AppIcon name="knowledge" color={colors.ui.icon.accentForeground} size={15} strokeWidth={appIconStroke.strong} /></View>}
          >
            {source.excerpt ? <Text selectable style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 20 }}>{source.excerpt}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <SourceMetaChip label={source.type === 'memory' ? t('source.memory') : source.type === 'knowledge' ? t('source.knowledge') : t('source.web')} />
              {source.chunkIndex !== undefined ? <SourceMetaChip label={t('source.citation', { index: source.chunkIndex + 1 })} /> : null}
              {source.score !== undefined ? <SourceMetaChip label={t('source.score', { score: source.score.toFixed(2) })} /> : null}
              {source.similarityScore !== undefined ? <SourceMetaChip label={t('source.similarity', { score: source.similarityScore.toFixed(2) })} /> : null}
              {source.rerankScore !== undefined ? <SourceMetaChip label={t('source.rerank', { score: source.rerankScore.toFixed(2) })} /> : null}
              {source.compressionRatio !== undefined ? <SourceMetaChip label={t('source.compression', { ratio: Math.round(source.compressionRatio * 100) })} /> : null}
              {source.qualityScore !== undefined ? <SourceMetaChip label={t('source.quality', { score: source.qualityScore.toFixed(2) })} /> : null}
              {source.retrievalStage ? <SourceMetaChip label={source.retrievalStage} /> : null}
              {source.sourceReason ? <SourceMetaChip label={source.sourceReason} /> : null}
              {source.headingPath?.length ? <SourceMetaChip label={source.headingPath.slice(-2).join(' / ')} /> : null}
              {source.sourceUri ? <SourceMetaChip label={hostOrFile(source.sourceUri)} /> : null}
              {source.documentId ? <SourceMetaChip label={`doc ${source.documentId.slice(0, 8)}`} /> : null}
              {source.chunkId ? <SourceMetaChip label={`chunk ${source.chunkId.slice(0, 8)}`} /> : null}
            </View>
          </IsleSection>
        </MotiView>
      ))}
    </ScrollView>
  )
}

function ProcessReader({ traces }: { traces: ProcessTrace[] }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const { width } = useWindowDimensions()
  const compact = width < 430
  const groups = buildProcessTraceGroups(traces, t)

  if (!traces.length) {
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
        <Text style={{ color: colors.text, fontSize: 19, fontWeight: '900' }}>{t('source.noProcess')}</Text>
        <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 8 }}>{t('source.noProcessMessage')}</Text>
      </View>
    )
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: compact ? 14 : 18, paddingBottom: 42 }}>
      {groups.map((group) => (
        <View key={group.key} style={{ marginBottom: 20 }}>
          <View style={{ minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <View style={{ width: 3, height: 14, borderRadius: colors.ui.radius.chip, backgroundColor: colors.ui.section.marker }} />
            <Text numberOfLines={1} style={{ color: colors.ui.section.title, fontSize: 12, lineHeight: 16, fontWeight: '900', includeFontPadding: false, textAlignVertical: 'center' }}>{group.title}</Text>
            <View style={{ flex: 1, height: 1, borderRadius: colors.ui.radius.chip, backgroundColor: colors.ui.section.divider }} />
          </View>
          {group.traces.map((trace, index) => (
          <TraceRow key={trace.id} trace={trace} isLast={index === group.traces.length - 1} />
          ))}
        </View>
      ))}
    </ScrollView>
  )
}

function buildProcessTraceGroups(traces: ProcessTrace[], t: TFunction): Array<{ key: ProcessTraceGroupKey; title: string; traces: ProcessTrace[] }> {
  const labels: Record<ProcessTraceGroupKey, string> = {
    agentPlan: t('source.agentPlan'),
    context: t('source.context'),
    search: t('source.search'),
    toolActivity: t('source.toolActivity'),
    agentSynthesis: t('source.agentSynthesis'),
    agentRecovery: t('source.agentRecovery'),
    other: t('source.modelTools'),
  }
  const buckets = new Map<ProcessTraceGroupKey, ProcessTrace[]>()
  for (const trace of traces) {
    const key = processTraceGroupKey(trace)
    buckets.set(key, [...(buckets.get(key) ?? []), trace])
  }
  const order: ProcessTraceGroupKey[] = ['agentPlan', 'context', 'search', 'toolActivity', 'agentSynthesis', 'agentRecovery', 'other']
  return order
    .map((key) => ({ key, title: labels[key], traces: buckets.get(key) ?? [] }))
    .filter((group) => group.traces.length)
}

function processTraceGroupKey(trace: ProcessTrace): ProcessTraceGroupKey {
  if (isAgentIntentTrace(trace) || isAgentPlanTrace(trace)) return 'agentPlan'
  if (trace.type === 'retrieval' || trace.type === 'memory' || trace.type === 'knowledge') return 'context'
  if (trace.type === 'search') return 'search'
  if (isAgentRecoveryTrace(trace)) return 'agentRecovery'
  if (trace.type === 'tool' || trace.metadata?.decision || trace.metadata?.permission || trace.metadata?.inputSummary) return 'toolActivity'
  if (isAgentWorkflowEnvelopeTrace(trace) || trace.type === 'system') return 'agentSynthesis'
  return 'other'
}

function isAgentRecoveryTrace(trace: ProcessTrace): boolean {
  const metadata = trace.metadata ?? {}
  if (isCompletedWorkArtifactFollowUpTrace(trace)) return true
  if (!isWorkflowRecoveryEnvelope(trace)) return false
  const pendingAction = metadata.pendingAction
  const pendingReason = pendingAction && typeof pendingAction === 'object'
    ? (pendingAction as Record<string, unknown>).reason
    : undefined
  return (
    isCancelledWorkflowTrace(trace) ||
    typeof metadata.failureNextStep === 'string' ||
    typeof metadata.repairNextStep === 'string' ||
    typeof metadata.cancelledContinuationPrompt === 'string' ||
    metadata.failureCode === 'evidence_insufficient' ||
    pendingReason === 'step_limit_reached' ||
    pendingReason === 'evidence_insufficient' ||
    pendingReason === 'permission_required' ||
    metadata.reason === 'workflow-review-required' ||
    metadata.reason === 'workflow-disabled' ||
    metadata.reason === 'workflow-invalid' ||
    metadata.reason === 'workflow-selection-ambiguous'
  )
}

function isWorkflowRecoveryEnvelope(trace: ProcessTrace): boolean {
  return isAgentWorkflowEnvelopeTrace(trace)
}

function isCompletedWorkArtifactFollowUpTrace(trace: ProcessTrace): boolean {
  const metadata = trace.metadata ?? {}
  return trace.type === 'tool' &&
    trace.status === 'done' &&
    metadata.source === 'work-artifact' &&
    metadata.contract === WORK_ARTIFACT_WORKFLOW_CONTRACT &&
    typeof metadata.followUpPrompt === 'string' &&
    Boolean(metadata.followUpPrompt.trim())
}

function isCancelledWorkflowTrace(trace: ProcessTrace): boolean {
  if (!isWorkflowRecoveryEnvelope(trace)) return false
  const metadata = trace.metadata ?? {}
  return trace.status === 'cancelled' ||
    metadata.status === 'cancelled' ||
    metadata.failureCode === 'cancelled' ||
    metadata.errorCode === 'cancelled'
}

function TraceRow({ trace, isLast }: { trace: ProcessTrace; isLast: boolean }) {
  const { colors } = useAppTheme()
  const display = formatProcessTraceForDisplay(trace)
  const tone = trace.status === 'done' ? colors.ui.tone.success.foreground : trace.status === 'error' ? colors.ui.tone.danger.foreground : trace.status === 'skipped' ? colors.textTertiary : colors.ui.icon.accentForeground
  const meta = [
    traceStageLabel(trace),
    traceStatusLabel(trace.status),
    trace.durationMs ? formatDuration(trace.durationMs) : '',
    metadataSummaryForTrace(trace),
  ].filter(Boolean).join(' · ')
  const metaLineCount = traceMetadataLineCount(trace)
  return (
    <View style={{ flexDirection: 'row', gap: 11 }}>
      <View style={{ alignItems: 'center' }}>
        <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: tone, marginTop: 8 }} />
        {!isLast ? <View style={{ flex: 1, width: 1, backgroundColor: colors.ui.section.divider, marginTop: 4 }} /> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0, paddingBottom: isLast ? 2 : 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <AppIcon name="list-check" color={tone} size={15} />
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: 14, lineHeight: 19, fontWeight: '900', flex: 1, minWidth: 0, includeFontPadding: false }}>{display.title}</Text>
        </View>
        <Text numberOfLines={metaLineCount} style={{ color: tone, fontSize: 11, lineHeight: 15, fontWeight: '900', marginTop: 3, includeFontPadding: false }}>{meta}</Text>
        {display.content ? (
          <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 7 }}>{display.content}</Text>
        ) : null}
      </View>
    </View>
  )
}

function traceMetadataLineCount(trace: ProcessTrace): number {
  return isAgentRecoveryTrace(trace) || hasTrustedWorkflowTraceContext(trace) ? 2 : 1
}

function hasTrustedWorkflowTraceContext(trace: ProcessTrace): boolean {
  return (isAgentPlanTrace(trace) || isAgentWorkflowEnvelopeTrace(trace) || isCompletedWorkArtifactFollowUpTrace(trace)) &&
    hasWorkflowTraceContext(trace)
}

function hasWorkflowTraceContext(trace: ProcessTrace): boolean {
  const metadata = trace.metadata
  if (!metadata) return false
  return hasTraceMetadataText(metadata.workflowId) ||
    hasTraceMetadataText(metadata.workflowName) ||
    hasTraceMetadataText(metadata.workflowExpectedOutput) ||
    hasPendingActionWorkflowTraceContext(metadata.pendingAction)
}

function hasPendingActionWorkflowTraceContext(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return hasTraceMetadataText(record.workflowId) ||
    hasTraceMetadataText(record.workflowName) ||
    hasTraceMetadataText(record.workflowExpectedOutput)
}

function hasTraceMetadataText(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim())
}

function ReaderSkeleton({ label }: { label: string }) {
  const { colors } = useAppTheme()
  const { width } = useWindowDimensions()
  const sheetMaterial = colors.material.sheet
  const skeletonSurface = colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted
  const skeletonBlockHeight = Math.max(140, Math.min(260, Math.round(width * (width < 430 ? 0.48 : 0.36))))
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 5, padding: 18, backgroundColor: sheetMaterial.body }}>
      <MotiView
        from={{ opacity: 0.38 }}
        animate={{ opacity: 0.9 }}
        transition={{ loop: true, type: 'timing', duration: 860 }}
        style={{ gap: 12 }}
      >
        <View style={{ width: '42%', height: 14, borderRadius: 7, backgroundColor: skeletonSurface }} />
        <View style={{ width: '92%', height: 10, borderRadius: 5, backgroundColor: skeletonSurface }} />
        <View style={{ width: '84%', height: 10, borderRadius: 5, backgroundColor: skeletonSurface }} />
        <View style={{ width: '96%', height: skeletonBlockHeight, borderRadius: colors.ui.radius.panel, backgroundColor: skeletonSurface, marginTop: 8 }} />
      </MotiView>
      <View style={{ position: 'absolute', top: 12, alignSelf: 'center', minHeight: 30, borderRadius: colors.ui.radius.chip, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: sheetMaterial.chrome, borderWidth: 1, borderColor: sheetMaterial.border }}>
        <MotiView
          from={{ opacity: 0.4, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ loop: true, type: 'timing', duration: 760 }}
          style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.ui.control.primaryBackground }}
        />
        <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900' }}>{label}</Text>
      </View>
    </View>
  )
}

function SourceMetaChip({ label }: { label: string }) {
  const { colors } = useAppTheme()
  return (
    <IsleChip>{label}</IsleChip>
  )
}

function getSourceSubtitle(citation: MessageCitation | undefined, url: string | undefined, t: TFunction): string {
  if (url) return hostFromUrl(url)
  if (!citation) return t('source.sourceMissing')
  const type = citation.type === 'memory' ? t('source.memory') : citation.type === 'knowledge' ? t('source.knowledgeBase') : t('source.webSource')
  return `${type}${citation.score !== undefined ? ` · ${t('source.score', { score: citation.score.toFixed(2) })}` : ''}`
}

function formatCitationMeta(citation: MessageCitation, t: TFunction): string {
  const type = citation.type === 'memory' ? t('source.memory') : citation.type === 'knowledge' ? t('source.knowledgeBase') : t('source.web')
  const parts = [
    type,
    citation.retrievalMode ? citation.retrievalMode.toUpperCase() : '',
    citation.chunkIndex !== undefined ? `[${citation.chunkIndex + 1}]` : '',
    citation.score !== undefined ? t('source.score', { score: citation.score.toFixed(2) }) : '',
    citation.similarityScore !== undefined ? t('source.similarity', { score: citation.similarityScore.toFixed(2) }) : '',
    citation.rerankScore !== undefined ? t('source.rerank', { score: citation.rerankScore.toFixed(2) }) : '',
    citation.compressionRatio !== undefined ? t('source.compression', { ratio: Math.round(citation.compressionRatio * 100) }) : '',
    citation.retrievalStage ? citation.retrievalStage : '',
    citation.sourceReason ? citation.sourceReason : '',
    citation.headingPath?.length ? citation.headingPath.slice(-2).join(' / ') : '',
    citation.ftsScore !== undefined ? `FTS ${citation.ftsScore.toFixed(2)}` : '',
    citation.vectorScore !== undefined ? `Vector ${citation.vectorScore.toFixed(2)}` : '',
    citation.documentId ? `doc ${citation.documentId.slice(0, 8)}` : '',
    citation.chunkId ? `chunk ${citation.chunkId.slice(0, 8)}` : '',
  ].filter(Boolean)
  return parts.join(' · ')
}

function hostOrFile(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '')
  } catch {
    return value.split(/[\\/]/).at(-1) ?? value
  }
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

function firstSafeParam(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === 'string' && Boolean(value.trim()))
}
