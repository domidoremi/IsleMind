import { useState, type ReactNode } from 'react'
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { MotiView } from 'moti'
import { useTranslation } from 'react-i18next'
import { IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'
import type { RagEvaluationLog, RagIndexingJobStatus } from '@/types'
import type { ContextSelfTestStep } from '@/services/contextSelfTest'
import type { RagEvaluationRun } from '@/services/ragEvaluation'

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

  return (
    <>
      <IslePressable
        haptic
        onPress={onRunSelfTest}
        disabled={selfTesting}
        accessibilityLabel={t('contextPanel.runSelfTest')}
        testID="context-self-test-button"
        style={{ ...primaryActionStyle, marginTop: 10, opacity: selfTesting ? 0.65 : 1 }}
      >
        <Text style={{ color: colors.ui.control.primaryForeground, fontSize: 13, fontWeight: '900' }}>
          {selfTesting ? t('contextPanel.selfTesting') : t('contextPanel.runSelfTest')}
        </Text>
      </IslePressable>
      {selfTestResult ? (
        <View testID="context-self-test-result" style={{ marginTop: 12, gap: 8 }}>
          <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '800' }}>
            {t('contextPanel.lastSelfTest', { time: new Date(selfTestResult.ranAt).toLocaleTimeString() })}
          </Text>
          {selfTestResult.steps.map((step, index) => (
            <AnimatedDiagnosticsRow key={`${step.name}-${index}`} index={index}>
              <SelfTestRow step={step} assetCardSurface={assetCardSurface} />
            </AnimatedDiagnosticsRow>
          ))}
        </View>
      ) : null}
      <View style={{ marginTop: 16 }}>
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: '900' }}>{t('contextPanel.ragDebug.title')}</Text>
        <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 4 }}>{t('contextPanel.ragDebug.subtitle')}</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <DebugStat label={t('contextPanel.ragDebug.logs')} value={String(ragLogs.length)} />
          <DebugStat label={t('contextPanel.ragDebug.indexJobs')} value={String(indexingJobs.length)} />
          <DebugStat label={t('contextPanel.ragDebug.failedJobs')} value={String(indexingJobs.filter((job) => job.status === 'error').length)} />
        </View>
        <IslePressable
          haptic
          onPress={onRunRagEvaluation}
          disabled={ragEvaluating}
          accessibilityLabel={t('contextPanel.ragDebug.runEvaluation')}
          testID="context-rag-evaluation-button"
          style={{ ...primaryActionStyle, marginTop: 10, opacity: ragEvaluating ? 0.65 : 1 }}
        >
          <Text style={{ color: colors.ui.control.primaryForeground, fontSize: 13, fontWeight: '900' }}>
            {ragEvaluating ? t('contextPanel.ragDebug.evaluating') : t('contextPanel.ragDebug.runEvaluation')}
          </Text>
        </IslePressable>
        {ragEvaluation ? (
          <AnimatedDiagnosticsRow index={0}>
            <RagEvaluationCard run={ragEvaluation} assetCardSurface={assetCardSurface} />
          </AnimatedDiagnosticsRow>
        ) : null}
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
      transition={motion === 'full'
        ? { type: 'spring', ...motionTokens.spring.gentle, delay: Math.min(index * 22, 130) }
        : { type: 'timing', duration: motionTokens.duration.fast }}
    >
      {children}
    </MotiView>
  )
}

function SelfTestRow({ step, assetCardSurface }: { step: ContextSelfTestStep; assetCardSurface: (borderColor?: string) => Record<string, unknown> }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(step.status === 'fail')
  const statusColor = step.status === 'ok' ? colors.ui.tone.success.foreground : step.status === 'warn' ? colors.ui.tone.warning.foreground : colors.ui.tone.danger.foreground
  const statusText = step.status === 'ok' ? t('contextPanel.selfTest.passed') : step.status === 'warn' ? t('contextPanel.selfTest.needsConfig') : t('contextPanel.selfTest.failedStatus')
  const rowSurface = assetCardSurface(step.status === 'fail' ? colors.ui.tone.danger.border : step.status === 'warn' ? colors.ui.tone.warning.border : undefined)
  return (
    <IslePressable
      haptic={step.status !== 'ok'}
      disabled={step.status === 'ok'}
      onPress={() => setExpanded((value) => !value)}
      style={{ padding: 10, ...rowSurface }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: statusColor }} />
        <Text style={{ color: colors.text, fontSize: 12, fontWeight: '900', flex: 1, minWidth: 0 }}>{step.name}</Text>
        <Text style={{ color: statusColor, fontSize: 11, fontWeight: '900' }}>{statusText}</Text>
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
    <View style={{ marginTop: 10, padding: 12, ...assetCardSurface() }}>
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '900' }}>{t('contextPanel.ragDebug.lastEvaluation')}</Text>
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
      <Text numberOfLines={1} style={{ color: colors.text, fontSize: 12, fontWeight: '900' }}>{log.query}</Text>
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
      <Text numberOfLines={1} style={{ color: colors.text, fontSize: 12, fontWeight: '900' }}>{job.kind}</Text>
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
    : colors.ui.cartoon
      ? colors.ui.semantic.surface.muted
      : colors.ui.semantic.surface.base
  const borderColor = colors.ui.glass
    ? colors.ui.actionBar.itemBorder
    : colors.ui.cartoon
      ? colors.material.stroke
      : colors.ui.semantic.chrome.border
  return (
    <View style={{ minHeight: 34, minWidth: statMinWidth, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderRadius: colors.ui.radius.controlMiddle, backgroundColor, borderWidth: StyleSheet.hairlineWidth, borderColor }}>
      <Text style={{ color: colors.text, fontSize: 12, fontWeight: '900' }}>{value}</Text>
      <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '800' }}>{label}</Text>
    </View>
  )
}
