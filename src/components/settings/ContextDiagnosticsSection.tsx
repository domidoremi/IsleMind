import { useState, type ReactNode } from 'react'
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { MotiView } from 'moti'
import { useTranslation } from 'react-i18next'
import { IslePressable } from '@/components/ui/isle'
import { AppIcon } from '@/components/ui/AppIcon'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'
import type { RagEvaluationLog, RagIndexingJobStatus } from '@/types/contextContracts'
import type { ContextSelfTestStep } from '@/services/contextSelfTest'
import type { RagEvaluationRun } from '@/modules/knowledge'

interface ContextDiagnosticsSectionProps {
  selfTesting: boolean
  selfTestResult: { ranAt: number; steps: ContextSelfTestStep[] } | null
  ragEvaluating: boolean
  ragEvaluation: RagEvaluationRun | null
  ragLogs: RagEvaluationLog[]
  indexingJobs: RagIndexingJobStatus[]
  onRunSelfTest: () => void
  onRunRagEvaluation: () => void
  primaryActionStyle: Record<string, unknown>
  assetCardSurface: (borderColor?: string) => Record<string, unknown>
}

export function ContextDiagnosticsSection({
  selfTesting,
  selfTestResult,
  ragEvaluating,
  ragEvaluation,
  ragLogs,
  indexingJobs,
  onRunSelfTest,
  onRunRagEvaluation,
  primaryActionStyle,
  assetCardSurface,
}: ContextDiagnosticsSectionProps) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const [selfTestDetailsOpen, setSelfTestDetailsOpen] = useState(false)
  const [ragActivityOpen, setRagActivityOpen] = useState(false)
  const selfTestPassed = selfTestResult?.steps.filter((step) => step.status === 'ok').length ?? 0
  const selfTestWarnings = selfTestResult?.steps.filter((step) => step.status === 'warn').length ?? 0
  const selfTestFailed = selfTestResult?.steps.filter((step) => step.status === 'fail').length ?? 0
  const failedIndexingJobs = indexingJobs.filter((job) => job.status === 'error').length
  const latestActivityCount = Math.min(ragLogs.length, 3) + Math.min(indexingJobs.length, 4)

  return (
    <>
      <IslePressable
        haptic
        onPress={onRunSelfTest}
        disabled={selfTesting}
        accessibilityLabel={t('contextPanel.runSelfTest')}
        accessibilityState={selfTesting ? { busy: true } : undefined}
        testID="context-self-test-button"
        style={{ ...primaryActionStyle, marginTop: 10, opacity: selfTesting ? 0.65 : 1 }}
      >
        <Text style={{ color: colors.ui.control.primaryForeground, fontSize: 13, fontWeight: '800' }}>
          {selfTesting ? t('contextPanel.selfTesting') : t('contextPanel.runSelfTest')}
        </Text>
      </IslePressable>
      {selfTestResult ? (
        <View testID="context-self-test-result" style={{ marginTop: 10, gap: 8 }}>
          <IslePressable
            haptic
            accessibilityRole="button"
            accessibilityLabel={`${t('contextPanel.lastSelfTest', { time: new Date(selfTestResult.ranAt).toLocaleTimeString() })}. ${t('contextPanel.selfTestSummary', { ok: selfTestPassed, warn: selfTestWarnings, fail: selfTestFailed })}`}
            accessibilityState={{ expanded: selfTestDetailsOpen }}
            onPress={() => setSelfTestDetailsOpen((value) => !value)}
            style={{ padding: 10, ...assetCardSurface(selfTestFailed ? colors.ui.tone.danger.border : selfTestWarnings ? colors.ui.tone.warning.border : undefined) }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <AppIcon name="health" color={selfTestFailed ? colors.ui.tone.danger.foreground : selfTestWarnings ? colors.ui.tone.warning.foreground : colors.ui.tone.success.foreground} size={16} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: '800' }}>
                  {t('contextPanel.lastSelfTest', { time: new Date(selfTestResult.ranAt).toLocaleTimeString() })}
                </Text>
                <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 15, marginTop: 2 }}>
                  {t('contextPanel.selfTestSummary', { ok: selfTestPassed, warn: selfTestWarnings, fail: selfTestFailed })}
                </Text>
              </View>
              <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '800' }}>
                {selfTestDetailsOpen ? t('contextPanel.hideDiagnosticDetails') : t('contextPanel.showDiagnosticDetails')}
              </Text>
              <MotiView animate={{ rotate: selfTestDetailsOpen ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: 160 }}>
                <AppIcon name="collapse" color={colors.textTertiary} size={16} />
              </MotiView>
            </View>
          </IslePressable>
          {selfTestDetailsOpen ? (
            <MotiView from={{ opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 144 }} style={{ gap: 8 }}>
              {selfTestResult.steps.map((step, index) => (
                <AnimatedDiagnosticsRow key={`${step.name}-${index}`} index={index}>
                  <SelfTestRow step={step} assetCardSurface={assetCardSurface} />
                </AnimatedDiagnosticsRow>
              ))}
            </MotiView>
          ) : null}
        </View>
      ) : null}
      <View style={{ marginTop: 10 }}>
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '800' }}>{t('contextPanel.ragDebug.title')}</Text>
        <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 3 }}>{t('contextPanel.ragDebug.subtitle')}</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <DebugStat label={t('contextPanel.ragDebug.logs')} value={String(ragLogs.length)} />
          <DebugStat label={t('contextPanel.ragDebug.indexJobs')} value={String(indexingJobs.length)} />
          <DebugStat label={t('contextPanel.ragDebug.failedJobs')} value={String(failedIndexingJobs)} />
        </View>
        <IslePressable
          haptic
          onPress={onRunRagEvaluation}
          disabled={ragEvaluating}
          accessibilityLabel={t('contextPanel.ragDebug.runEvaluation')}
          accessibilityState={ragEvaluating ? { busy: true } : undefined}
          testID="context-rag-evaluation-button"
          style={{ ...primaryActionStyle, marginTop: 8, opacity: ragEvaluating ? 0.65 : 1 }}
        >
          <Text style={{ color: colors.ui.control.primaryForeground, fontSize: 13, fontWeight: '800' }}>
            {ragEvaluating ? t('contextPanel.ragDebug.evaluating') : t('contextPanel.ragDebug.runEvaluation')}
          </Text>
        </IslePressable>
        {ragEvaluation ? (
          <AnimatedDiagnosticsRow index={0}>
            <RagEvaluationCard run={ragEvaluation} assetCardSurface={assetCardSurface} />
          </AnimatedDiagnosticsRow>
        ) : null}
        {latestActivityCount ? (
          <IslePressable
            haptic
            accessibilityRole="button"
            accessibilityLabel={`${ragActivityOpen ? t('contextPanel.ragDebug.hideActivity') : t('contextPanel.ragDebug.showActivity')}. ${t('contextPanel.ragDebug.activitySummary', { logs: Math.min(ragLogs.length, 3), jobs: Math.min(indexingJobs.length, 4), failed: failedIndexingJobs })}`}
            accessibilityState={{ expanded: ragActivityOpen }}
            onPress={() => setRagActivityOpen((value) => !value)}
            style={{ marginTop: 10, padding: 10, ...assetCardSurface(failedIndexingJobs ? colors.ui.tone.danger.border : undefined) }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <AppIcon name="trace" color={failedIndexingJobs ? colors.ui.tone.danger.foreground : colors.textTertiary} size={16} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: '800' }}>
                  {ragActivityOpen ? t('contextPanel.ragDebug.hideActivity') : t('contextPanel.ragDebug.showActivity')}
                </Text>
                <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 15, marginTop: 2 }}>
                  {t('contextPanel.ragDebug.activitySummary', { logs: Math.min(ragLogs.length, 3), jobs: Math.min(indexingJobs.length, 4), failed: failedIndexingJobs })}
                </Text>
              </View>
              <MotiView animate={{ rotate: ragActivityOpen ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: 160 }}>
                <AppIcon name="collapse" color={colors.textTertiary} size={16} />
              </MotiView>
            </View>
          </IslePressable>
        ) : null}
        {ragActivityOpen ? (
          <MotiView from={{ opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 144 }}>
            {ragLogs.slice(0, 3).map((log, index) => (
              <AnimatedDiagnosticsRow key={log.id} index={index + 1}>
                <RagLogRow log={log} assetCardSurface={assetCardSurface} />
              </AnimatedDiagnosticsRow>
            ))}
            {indexingJobs.slice(0, 4).map((job, index) => (
              <AnimatedDiagnosticsRow key={job.id} index={index + 4}>
                <IndexingJobRow job={job} assetCardSurface={assetCardSurface} />
              </AnimatedDiagnosticsRow>
            ))}
          </MotiView>
        ) : null}
      </View>
    </>
  )
}

function AnimatedDiagnosticsRow({ index, children }: { index: number; children: ReactNode }) {
  const motion = useMotionPreference()
  return (
    <MotiView
      from={motion === 'full' ? { opacity: 0, translateY: 8 } : { opacity: 0 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1, delay: motion === 'full' ? Math.min(index * 22, 130) : 0 }}
    >
      {children}
    </MotiView>
  )
}

function SelfTestRow({ step, assetCardSurface }: { step: ContextSelfTestStep; assetCardSurface: (borderColor?: string) => Record<string, unknown> }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(step.status !== 'ok')
  const statusColor = step.status === 'ok' ? colors.ui.tone.success.foreground : step.status === 'warn' ? colors.ui.tone.warning.foreground : colors.ui.tone.danger.foreground
  const statusText = step.status === 'ok' ? t('contextPanel.selfTest.passed') : step.status === 'warn' ? t('contextPanel.selfTest.needsConfig') : t('contextPanel.selfTest.failedStatus')
  const rowSurface = assetCardSurface(step.status === 'fail' ? colors.ui.tone.danger.border : step.status === 'warn' ? colors.ui.tone.warning.border : undefined)
  return (
    <IslePressable
      haptic={step.status !== 'ok'}
      accessibilityRole="button"
      accessibilityLabel={`${step.name}. ${statusText}. ${step.detail}`}
      accessibilityState={{ expanded: expanded || step.status === 'ok', disabled: step.status === 'ok' }}
      disabled={step.status === 'ok'}
      onPress={() => setExpanded((value) => !value)}
      style={{ padding: 10, ...rowSurface }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: statusColor }} />
        <Text style={{ color: colors.text, fontSize: 12, fontWeight: '800', flex: 1, minWidth: 0 }}>{step.name}</Text>
        <Text style={{ color: statusColor, fontSize: 11, fontWeight: '800' }}>{statusText}</Text>
      </View>
      {expanded || step.status === 'ok' ? (
        <Text style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 5 }}>{step.detail}</Text>
      ) : (
        <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 5 }}>{t('contextPanel.selfTest.tapForDetails')}</Text>
      )}
    </IslePressable>
  )
}

function RagEvaluationCard({ run, assetCardSurface }: { run: RagEvaluationRun; assetCardSurface: (borderColor?: string) => Record<string, unknown> }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  return (
    <View style={{ marginTop: 10, padding: 10, ...assetCardSurface() }}>
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>{t('contextPanel.ragDebug.lastEvaluation')}</Text>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <DebugStat label={t('contextPanel.ragDebug.confidence')} value={`${Math.round(run.averageConfidence * 100)}%`} />
        <DebugStat label={t('contextPanel.ragDebug.citation')} value={`${Math.round(run.averageCitationCoverage * 100)}%`} />
        <DebugStat label={t('contextPanel.ragDebug.precision')} value={`${Math.round(run.averageContextPrecision * 100)}%`} />
      </View>
      {run.fallbackReasons.length ? (
        <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 8 }}>{t('contextPanel.ragDebug.fallbacks', { value: run.fallbackReasons.slice(0, 3).join(', ') })}</Text>
      ) : null}
    </View>
  )
}

function RagLogRow({ log, assetCardSurface }: { log: RagEvaluationLog; assetCardSurface: (borderColor?: string) => Record<string, unknown> }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const quality = log.quality
  return (
    <View style={{ marginTop: 8, padding: 10, ...assetCardSurface() }}>
      <Text numberOfLines={1} style={{ color: colors.text, fontSize: 12, fontWeight: '800' }}>{log.query}</Text>
      <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 4 }}>
        {t('contextPanel.ragDebug.logMeta', {
          profile: log.plan?.profile ?? '-',
          sources: log.sourceCount,
          confidence: Math.round((quality?.generationConfidence ?? quality?.confidence ?? 0) * 100),
          flare: quality?.flareTriggered ? t('contextPanel.ragDebug.yes') : t('contextPanel.ragDebug.no'),
        })}
      </Text>
    </View>
  )
}

function IndexingJobRow({ job, assetCardSurface }: { job: RagIndexingJobStatus; assetCardSurface: (borderColor?: string) => Record<string, unknown> }) {
  const { colors } = useAppTheme()
  return (
    <View style={{ marginTop: 8, padding: 10, ...assetCardSurface(job.status === 'error' ? colors.ui.tone.danger.border : colors.material.stroke) }}>
      <Text numberOfLines={1} style={{ color: colors.text, fontSize: 12, fontWeight: '800' }}>{job.kind}</Text>
      <Text numberOfLines={2} style={{ color: job.status === 'error' ? colors.ui.tone.danger.foreground : colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 4 }}>
        {job.status}{job.progress !== undefined ? ` · ${Math.round((job.progress ?? 0) * 100)}%` : ''}{job.error ? ` · ${job.error}` : ''}
      </Text>
    </View>
  )
}

function DebugStat({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme()
  const { width } = useWindowDimensions()
  const statMinWidth = width < 390 ? 64 : 74
  const backgroundColor = colors.ui.glass
    ? colors.ui.actionBar.itemBackground
    : colors.ui.limeRoad
      ? colors.ui.semantic.surface.muted
      : colors.ui.semantic.surface.base
  const borderColor = colors.ui.glass
    ? colors.ui.actionBar.itemBorder
    : colors.ui.limeRoad
      ? colors.material.stroke
      : colors.ui.semantic.chrome.border
  return (
    <View style={{ minHeight: 34, minWidth: statMinWidth, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderRadius: Math.min(colors.ui.radius.controlMiddle, 8), backgroundColor, borderWidth: StyleSheet.hairlineWidth, borderColor }}>
      <Text style={{ color: colors.text, fontSize: 12, fontWeight: '800' }}>{value}</Text>
      <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '800' }}>{label}</Text>
    </View>
  )
}
