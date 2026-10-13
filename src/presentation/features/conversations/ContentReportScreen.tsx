import { useEffect, useRef, useState } from 'react'
import { AppState, Linking, ScrollView, View } from 'react-native'
import { Text } from '@/components/ui/AppText'
import { useTranslation } from 'react-i18next'
import { IsleButton, IsleInput, IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { ThemeDetailFrame } from '@/presentation/app-shell/ThemeDetailFrame'
import { CONTENT_REPORT_EXCERPT_LIMIT, CONTENT_REPORT_NOTE_LIMIT, CONTENT_REPORT_REASONS, ContentReportError,
  contentReportExcerpt, type ContentReport, type ContentReportReason, type ContentReporting } from '@/modules/conversations'

/** source is a single visible terminal answer; undefined = loading, null = unavailable. */
export function ContentReportScreen({ source, reporting, onClose }: {
  source: string | null | undefined
  reporting: ContentReporting
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useAppTheme()
  const [excerpt, setExcerpt] = useState('')
  const [note, setNote] = useState('')
  const [reason, setReason] = useState<ContentReportReason>('other')
  const [report, setReport] = useState<Readonly<ContentReport> | null>(null)
  const [status, setStatus] = useState<'editing' | 'review' | 'sending' | 'received'>('editing')
  const [error, setError] = useState<string | null>(null)
  const [attempted, setAttempted] = useState(false)
  const pending = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const initialized = useRef(false)
  const scroll = useRef<ScrollView>(null)
  const configuration = reporting.configuration
  const textStyle = { color: colors.text, fontSize: 16, lineHeight: 24 }

  useEffect(() => {
    if (!initialized.current && typeof source === 'string') {
      initialized.current = true
      setExcerpt(contentReportExcerpt(source))
    }
  }, [source])
  useEffect(() => {
    mounted.current = true
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') pending.current?.abort() })
    return () => { mounted.current = false; pending.current?.abort(); subscription.remove() }
  }, [])
  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }) }, [status === 'editing', status === 'received'])

  function review() {
    if (pending.current || !configuration || typeof source !== 'string') return
    try {
      setReport(reporting.prepare({ excerpt, reason, note }))
      setError(null); setAttempted(false); setStatus('review')
    } catch (failure) { setError(failure instanceof ContentReportError ? failure.code : 'failed') }
  }
  async function submit() {
    if (pending.current || !report || !configuration || status === 'received') return
    const controller = new AbortController()
    pending.current = controller
    setError(null); setAttempted(true); setStatus('sending')
    try {
      await reporting.submit(report, controller.signal)
      if (mounted.current) {
        // Cancellation cannot retract a received request, but must not announce
        // a late success after the user asked to stop waiting.
        setStatus(controller.signal.aborted ? 'review' : 'received')
        if (controller.signal.aborted) setError('cancelled')
      }
    } catch (failure) {
      if (mounted.current) { setError(failure instanceof ContentReportError ? failure.code : 'failed'); setStatus('review') }
    } finally { if (pending.current === controller) pending.current = null }
  }
  function close() { pending.current?.abort(); onClose() }
  async function openPrivacyPolicy() {
    if (!configuration) return
    try { await Linking.openURL(configuration.privacyPolicyUrl) }
    catch { if (mounted.current) setError('privacyOpenFailed') }
  }

  return <ThemeDetailFrame kind="report" title={t('contentReport.title')} backLabel={t('common.back')} onBack={close}>
    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 18, width: '100%', maxWidth: 760, alignSelf: 'center' }}>
      {source === undefined ? <Text style={textStyle}>{t('common.loading')}</Text> : null}
      {source === null ? <Text accessibilityRole="alert" style={textStyle}>{t('contentReport.sourceUnavailable')}</Text> : null}
      {!configuration ? <Text accessibilityRole="alert" style={textStyle}>{t('contentReport.unavailable')}</Text> : null}
      {configuration ? <View style={{ gap: 10 }}>
        <Text style={textStyle}>{t('contentReport.recipient', { operator: configuration.operator })}</Text>
        <Text selectable style={textStyle}>{configuration.endpoint}</Text>
        <Text style={textStyle}>{t('contentReport.disclosure')}</Text>
        <Text selectable style={textStyle}>{configuration.privacyPolicyUrl}</Text>
        <IsleButton label={t('contentReport.privacyPolicy')} onPress={() => void openPrivacyPolicy()} disabled={status === 'sending'} />
      </View> : null}
      {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={textStyle}>{t(`contentReport.errors.${error}`)}</Text> : null}
      {configuration && typeof source === 'string' && status === 'editing' ? <>
        <Text style={textStyle}>{t('contentReport.editNotice', { limit: CONTENT_REPORT_EXCERPT_LIMIT })}</Text>
        <IsleInput label={t('contentReport.excerpt')} accessibilityLabel={t('contentReport.excerpt')} value={excerpt}
          onChangeText={setExcerpt} multiline maxLength={CONTENT_REPORT_EXCERPT_LIMIT} textAlignVertical="top" inputStyle={{ minHeight: 160 }} />
        <Text accessibilityRole="header" style={textStyle}>{t('contentReport.reason')}</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('contentReport.reason')} style={{ gap: 8 }}>
          {CONTENT_REPORT_REASONS.map(value => <IslePressable key={value} accessibilityRole="radio"
            accessibilityLabel={t(`contentReport.reasons.${value}`)} accessibilityState={{ checked: reason === value }}
            onPress={() => setReason(value)} style={{ minHeight: 48, justifyContent: 'center', padding: 12, borderWidth: 1,
              borderRadius: 12, borderColor: reason === value ? colors.text : colors.textTertiary }}>
            <Text style={textStyle}>{reason === value ? '● ' : '○ '}{t(`contentReport.reasons.${value}`)}</Text>
          </IslePressable>)}
        </View>
        <IsleInput label={t('contentReport.note')} accessibilityLabel={t('contentReport.note')} value={note}
          onChangeText={setNote} multiline maxLength={CONTENT_REPORT_NOTE_LIMIT} textAlignVertical="top" inputStyle={{ minHeight: 96 }} />
        <IsleButton label={t('contentReport.review')} tone="primary" disabled={!excerpt.trim()} onPress={review} />
      </> : null}
      {report && status !== 'editing' ? <>
        <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={textStyle}>{t(status === 'received' ? 'contentReport.received' : 'contentReport.preview')}</Text>
        {status === 'received' ? <Text style={textStyle}>{t('contentReport.receivedNotice')}</Text> : null}
        <Text style={textStyle}>{t('contentReport.reason')}: {t(`contentReport.reasons.${report.reason}`)} ({report.reason})</Text>
        <Text style={textStyle}>{t('contentReport.excerpt')}</Text>
        <Text selectable style={textStyle}>{report.excerpt}</Text>
        <Text style={textStyle}>{t('contentReport.note')}</Text>
        <Text selectable style={textStyle}>{report.note || t('contentReport.noNote')}</Text>
        <Text selectable style={textStyle}>{t('contentReport.metadata', { version: report.appVersion, id: report.reportId, schema: report.schemaVersion })}</Text>
        {status !== 'received' ? <>
          <Text style={textStyle}>{t('contentReport.confirmNotice')}</Text>
          <IsleButton label={t(attempted && status !== 'sending' ? 'contentReport.retry' : 'contentReport.send')} tone="primary" busy={status === 'sending'}
            disabled={status === 'sending'} onPress={() => void submit()} />
          {status === 'sending' ? <IsleButton label={t('contentReport.stopWaiting')} onPress={() => pending.current?.abort()} />
            : <IsleButton label={t('common.edit')} onPress={() => { setReport(null); setError(null); setStatus('editing') }} />}
        </> : null}
      </> : null}
      <Text style={{ ...textStyle, color: colors.textSecondary }}>{t('contentReport.leaveNotice')}</Text>
      <IsleButton label={t('common.close')} onPress={close} />
    </ScrollView>
  </ThemeDetailFrame>
}
