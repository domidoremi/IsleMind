import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AccessibilityInfo, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Text } from './AppText'
import type { ToastOptions } from './isle/isleDialogTypes'
import { IsleLocalFeedbackProvider } from './isle/isleDialogContext'
import { useAppTheme } from '@/hooks/useAppTheme'
import { dismissActiveAppToast, EMPTY_APP_TOAST_QUEUE, enqueueAppToast, type AppFeedbackItem, type AppToastQueueState } from './appFeedbackState'
import { resolveAppFeedbackTimeout } from './appFeedbackTimeout'
import { FeedbackAnnouncement, FeedbackGlyph } from './FeedbackGlyph'
import { IsleMotionFrame } from './isle/ThemeMotion'

type FeedbackContext = {
  item: AppFeedbackItem | null
  pendingCount: number
  dismiss: (id: number) => void
}

const PageFeedbackContext = createContext<FeedbackContext | null>(null)
const persistentTones = new Set(['danger', 'error', 'amber', 'warning'])
type Receipt = { owner: object; queue: AppToastQueueState }

function isRoutineSuccess(item: AppFeedbackItem) {
  return (item.tone === 'mint' || item.tone === 'success') && !(item.actionLabel && item.onAction)
}

/** A page owns its receipts; stale operations cannot publish into a new page. */
export function PageFeedbackBoundary({ children, scopeKey }: { children: ReactNode; scopeKey?: unknown }) {
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const ticket = useMemo(() => ({}), [scopeKey])
  const currentTicket = useRef(ticket)
  currentTicket.current = ticket
  const mounted = useRef(true)
  const sequence = useRef(0)
  const receiptRef = useRef<Receipt | null>(null)
  const queue = receipt?.owner === ticket ? receipt.queue : EMPTY_APP_TOAST_QUEUE
  const item = queue.active

  const dismiss = useCallback((id: number) => {
    if (receiptRef.current?.owner !== currentTicket.current) return
    const current = receiptRef.current?.queue.active
    if (!current || current.id !== id) return
    receiptRef.current = { owner: receiptRef.current!.owner, queue: dismissActiveAppToast(receiptRef.current!.queue) }
    if (mounted.current) setReceipt(receiptRef.current)
    current.onDismiss?.()
  }, [])
  const publish = useCallback((options: ToastOptions) => {
    if (!mounted.current || currentTicket.current !== ticket) return
    const previous = receiptRef.current?.owner === ticket ? receiptRef.current.queue : EMPTY_APP_TOAST_QUEUE
    const next: AppFeedbackItem = {
      ...options,
      id: ++sequence.current,
      occurrences: 1,
      priority: persistentTones.has(options.tone ?? '') ? 'high' : options.priority,
    }
    receiptRef.current = { owner: ticket, queue: enqueueAppToast(previous, next) }
    setReceipt(receiptRef.current)
  }, [ticket])

  useEffect(() => {
    if (receiptRef.current?.owner !== ticket) receiptRef.current = null
    setReceipt(current => current?.owner === ticket ? current : null)
  }, [ticket])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; receiptRef.current = null }
  }, [])
  useEffect(() => {
    if (!item || persistentTones.has(item.tone ?? '') || (item.actionLabel && item.onAction)) return
    const duration = item.durationMs ?? 3200
    if (duration <= 0) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    void resolveAppFeedbackTimeout(duration, AccessibilityInfo).then(timeout => {
      if (!cancelled) timer = setTimeout(() => dismiss(item.id), timeout)
    })
    return () => { cancelled = true; if (timer !== undefined) clearTimeout(timer) }
  }, [dismiss, item])

  const value = useMemo(() => ({ item, pendingCount: queue.pending.length, dismiss }), [item, queue.pending.length, dismiss])
  return <PageFeedbackContext.Provider value={value}>
    <IsleLocalFeedbackProvider onFeedback={publish}>{children}</IsleLocalFeedbackProvider>
  </PageFeedbackContext.Provider>
}

/** Routine acknowledgements use the header; actionable and safety feedback stays readable. */
export function PageFeedbackIndicator({ testID = 'page-feedback-indicator', action }: { testID?: string; action?: ReactNode }) {
  const context = useContext(PageFeedbackContext)
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const item = context?.item
  if (!context) return null
  const success = Boolean(item && isRoutineSuccess(item))
  const label = success ? [item!.title, item!.message].filter(Boolean).join('. ') : undefined
  return <View testID={testID} style={styles.indicator}>
    {action ?? <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={t('common.close')}
      accessible={success} importantForAccessibility={success ? 'auto' : 'no-hide-descendants'}
      aria-hidden={!success} disabled={!success} onPress={() => { if (item) context.dismiss(item.id) }}
      style={[styles.indicator, success ? { borderRadius: 22, backgroundColor: colors.ui.tone.success.background } : null]}>
      <FeedbackGlyph phase={success ? 'success' : 'idle'} receiptKey={item?.id} announce={false} />
    </Pressable>}
    <FeedbackAnnouncement message={label} receiptKey={item?.id} testID={`${testID}-announcement`} />
  </View>
}

/** In-flow explanation only when a result needs reading or an explicit action. */
export function PageFeedbackRegion({ style, testID = 'page-action-feedback' }: {
  style?: StyleProp<ViewStyle>
  testID?: string
}) {
  const context = useContext(PageFeedbackContext)
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const item = context?.item
  if (!item || !context || isRoutineSuccess(item)) return null
  const failed = item.tone === 'danger' || item.tone === 'error'
  const warning = item.tone === 'amber' || item.tone === 'warning'
  const success = item.tone === 'mint' || item.tone === 'success'
  const tone = colors.ui.semantic.feedback[failed ? 'danger' : warning ? 'warning' : success ? 'success' : 'info']
  return <IsleMotionFrame role="section" testID={testID} style={[styles.frame, { backgroundColor: colors.ui.semantic.surface.base, borderColor: tone.border }, style]}>
    <View style={styles.copyRow}>
      <View accessible={false} style={[styles.marker, { backgroundColor: tone.foreground }]} />
      <View style={styles.copy} accessible accessibilityRole={failed ? 'alert' : 'text'}
        accessibilityLiveRegion={failed ? 'assertive' : 'polite'}
        accessibilityLabel={[item.title, item.message].filter(Boolean).join('. ')}>
        <Text style={[styles.title, { color: colors.text }]}>{item.title}</Text>
        {item.message ? <Text selectable style={[styles.message, { color: colors.textSecondary }]}>{item.message}</Text> : null}
      </View>
    </View>
    <View style={styles.actions}>
      {context.pendingCount ? <Text style={[styles.message, styles.pending, { color: colors.textSecondary }]}>{t('dialog.pendingFeedback', { count: context.pendingCount })}</Text> : null}
      {item.actionLabel && item.onAction ? <Pressable accessibilityRole="button" accessibilityLabel={item.actionLabel} style={({ pressed }) => [styles.action, { opacity: pressed ? 0.7 : 1 }]} onPress={() => {
        item.onAction?.()
        context.dismiss(item.id)
      }}><Text style={[styles.actionLabel, { color: tone.foreground }]}>{item.actionLabel}</Text></Pressable> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} style={({ pressed }) => [styles.action, { opacity: pressed ? 0.7 : 1 }]} onPress={() => context.dismiss(item.id)}>
        <Text style={[styles.actionLabel, { color: colors.textSecondary }]}>{t('common.close')}</Text>
      </Pressable>
    </View>
  </IsleMotionFrame>
}

const styles = StyleSheet.create({
  indicator: { width: 44, height: 44, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  frame: { minWidth: 0, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
  copyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  marker: { width: 3, minHeight: 21, alignSelf: 'stretch' },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  title: { fontSize: 14, lineHeight: 21, fontWeight: '700' },
  message: { fontSize: 13, lineHeight: 20 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 },
  pending: { alignSelf: 'center', marginRight: 'auto' },
  action: { minHeight: 44, minWidth: 44, maxWidth: '100%', paddingHorizontal: 8, justifyContent: 'center' },
  actionLabel: { fontSize: 13, lineHeight: 20, fontWeight: '600', flexShrink: 1 },
})
