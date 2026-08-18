import type { ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AccessibilityInfo, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native'
import { AnimatePresence, MotiView } from 'moti'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { IsleButton } from './Controls'
import { IslePanel } from './Panel'
import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
import {
  createAppConfirmSettlementRegistry,
  dismissActiveAppToast,
  EMPTY_APP_TOAST_QUEUE,
  enqueueAppToast,
  type AppFeedbackItem,
  type AppFeedbackOptions,
  type AppFeedbackTone,
} from '@/components/ui/appFeedbackState'
import { resolveAppFeedbackTimeout } from '@/components/ui/appFeedbackTimeout'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'

type DialogTone = AppFeedbackTone

export interface IsleDialogChip {
  label: string
  tone?: DialogTone
}

export interface IsleDialogMetric {
  label: string
  before?: string
  after?: string
  tone?: DialogTone
}

interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: DialogTone
  chips?: IsleDialogChip[]
  metrics?: IsleDialogMetric[]
  renderBody?: () => ReactNode
}

interface NoticeOptions {
  title: string
  message?: string
  tone?: DialogTone
  actionLabel?: string
}

export interface ToastOptions extends AppFeedbackOptions {}

export interface BannerOptions extends Omit<AppFeedbackOptions, 'durationMs' | 'position' | 'topOffset' | 'bottomOffset' | 'priority'> {
  id?: string
}

interface DialogState extends ConfirmOptions {
  id: number
  kind: 'confirm' | 'notice'
  resolve?: (value: boolean) => void
  actionLabel?: string
}

interface BannerState extends BannerOptions {
  id: string
}

interface IsleDialogApi {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  notice: (options: NoticeOptions) => void
  toast: (options: ToastOptions) => void
  banner: (options: BannerOptions) => string
  dismissBanner: (id: string) => void
}

const IsleDialogContext = createContext<IsleDialogApi | null>(null)
const missingProviderWarnings = new Set<string>()

function warnMissingProvider(method: keyof IsleDialogApi) {
  if (!__DEV__ || missingProviderWarnings.has(method)) return
  missingProviderWarnings.add(method)
  console.warn(`[IsleDialog] ${method} called outside IsleDialogProvider; using fallback behavior.`)
}

const fallbackDialogApi: IsleDialogApi = {
  confirm: async () => {
    warnMissingProvider('confirm')
    return false
  },
  notice: () => warnMissingProvider('notice'),
  toast: () => warnMissingProvider('toast'),
  banner: () => {
    warnMissingProvider('banner')
    return ''
  },
  dismissBanner: () => warnMissingProvider('dismissBanner'),
}

function dialogBorderWidth(colors: ReturnType<typeof useAppTheme>['colors']) {
  return colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth
}

export function IsleDialogProvider({ children, updateNotice }: { children: ReactNode; updateNotice?: string | null }) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const { height, width } = useWindowDimensions()
  const modalPaddingHorizontal = width < 380 ? 14 : 18
  const modalPaddingTop = Math.max(insets.top, 12)
  const modalPaddingBottom = Math.max(insets.bottom, 12)
  const dialogMaxWidth = Math.min(460, Math.max(240, width - modalPaddingHorizontal * 2))
  const dialogMaxHeight = Math.max(240, height - modalPaddingTop - modalPaddingBottom)
  const routeDialog = colors.ui.family === 'lime-road'
  const toastMaxWidth = Math.min(420, Math.max(240, width - 32))
  const [dialogQueue, setDialogQueue] = useState<DialogState[]>([])
  const [toastQueue, setToastQueue] = useState(EMPTY_APP_TOAST_QUEUE)
  const [banners, setBanners] = useState<BannerState[]>([])
  const idRef = useRef(0)
  const lastUpdateNotice = useRef<string | null>(null)
  const dialogQueueRef = useRef(dialogQueue)
  const dialogSettlementsRef = useRef(createAppConfirmSettlementRegistry())
  const dialog = dialogQueue[0] ?? null
  const toast = toastQueue.active

  useEffect(() => {
    dialogQueueRef.current = dialogQueue
  }, [dialogQueue])

  const closeDialog = useCallback((value: boolean) => {
    const [active, ...remaining] = dialogQueueRef.current
    if (!active) return
    dialogQueueRef.current = remaining
    setDialogQueue(remaining)
    dialogSettlementsRef.current.settle(active.id, value)
  }, [])

  const api = useMemo<IsleDialogApi>(() => ({
    confirm: (options) =>
      new Promise<boolean>((resolve) => {
        const id = idRef.current++
        dialogSettlementsRef.current.register(id, resolve)
        const next = [...dialogQueueRef.current, { ...options, id, kind: 'confirm' as const, resolve }]
        dialogQueueRef.current = next
        setDialogQueue(next)
      }),
    notice: (options) => {
      const next = [...dialogQueueRef.current, { ...options, id: idRef.current++, kind: 'notice' as const }]
      dialogQueueRef.current = next
      setDialogQueue(next)
    },
    toast: (options) => {
      const next: AppFeedbackItem = { ...options, id: idRef.current++, occurrences: 1 }
      setToastQueue((current) => enqueueAppToast(current, next))
    },
    banner: (options) => {
      const id = options.id?.trim() || options.dedupeKey?.trim() || `banner-${idRef.current++}`
      setBanners((current) => {
        const next = { ...options, id }
        const existingIndex = current.findIndex((item) => item.id === id)
        if (existingIndex < 0) return [next, ...current].slice(0, 2)
        const updated = [...current]
        updated[existingIndex] = next
        return updated
      })
      return id
    },
    dismissBanner: (id) => {
      setBanners((current) => current.filter((item) => item.id !== id))
    },
  }), [])

  const dismissToast = useCallback((id?: number) => {
    setToastQueue((current) => {
      if (!current.active || (id !== undefined && current.active.id !== id)) return current
      current.active.onDismiss?.()
      return dismissActiveAppToast(current)
    })
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    const durationMs = toast.durationMs ?? defaultToastDuration(toast)
    if (durationMs <= 0) return undefined
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    void resolveAppFeedbackTimeout(durationMs, AccessibilityInfo)
      .then((recommendedDurationMs) => {
        if (cancelled) return
        timer = setTimeout(() => dismissToast(toast.id), recommendedDurationMs)
      })
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [dismissToast, toast])

  useEffect(() => {
    if (!updateNotice || lastUpdateNotice.current === updateNotice) return
    lastUpdateNotice.current = updateNotice
    api.toast({ title: t('app.newVersion'), message: updateNotice, tone: 'amber', durationMs: 4200 })
  }, [api, t, updateNotice])

  useEffect(() => () => {
    dialogSettlementsRef.current.settleAll(false)
  }, [])

  return (
    <IsleDialogContext.Provider value={api}>
      {children}
      <Modal
        transparent
        visible={!!dialog}
        animationType="none"
        onRequestClose={() => closeDialog(false)}
        statusBarTranslucent
      >
        <StatusBar style="light" />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{
            flex: 1,
            justifyContent: routeDialog ? 'flex-end' : 'center',
            paddingHorizontal: modalPaddingHorizontal,
            paddingTop: modalPaddingTop,
            paddingBottom: modalPaddingBottom,
          }}
        >
          <Pressable
            accessible={false}
            accessibilityRole="none"
            onPress={() => closeDialog(false)}
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.backdrop }}
          />
          {dialog ? (
            <MotiView
              key={dialog.id}
              from={motion === 'full' ? { opacity: 0, translateY: routeDialog ? 28 : 10 } : { opacity: 1, translateY: 0 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: motion === 'full' ? (routeDialog ? 188 : 144) : 1 }}
              style={{ width: '100%', maxWidth: routeDialog ? Math.min(520, width - modalPaddingHorizontal * 2) : dialogMaxWidth, maxHeight: dialogMaxHeight, alignSelf: 'center' }}
            >
              <View accessibilityViewIsModal style={{ maxHeight: '100%' }}>
                <ThemeDialogSurface dialog={dialog} onClose={closeDialog} />
              </View>
            </MotiView>
          ) : null}
        </KeyboardAvoidingView>
      </Modal>
      <AppBannerViewport
        banners={banners}
        onAction={(banner) => {
          banner.onAction?.()
          api.dismissBanner(banner.id)
        }}
        onDismiss={(banner) => {
          banner.onDismiss?.()
          api.dismissBanner(banner.id)
        }}
      />
      <AnimatePresence>
      {toast ? (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            ...(toast.position === 'bottom'
              ? { bottom: toast.bottomOffset ?? 18 + insets.bottom }
              : { top: toast.topOffset ?? 18 + insets.top + (banners.length ? Math.min(banners.length, 2) * 76 : 0) }),
            zIndex: 999,
            alignItems: 'center',
            paddingHorizontal: 16,
          }}
        >
          <MotiView
            key={toast.id}
            from={motion === 'full'
              ? { opacity: 0, translateY: toast.position === 'bottom' ? 10 : -10 }
              : { opacity: 1, translateY: 0 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: motion === 'full' ? 112 : 1 }}
            exit={motion === 'full' ? { opacity: 0, translateY: toast.position === 'bottom' ? 8 : -8 } : { opacity: 0 }}
            style={{ width: '100%', maxWidth: toastMaxWidth }}
          >
            <AppToastSurface
              toast={toast}
              onAction={() => {
                toast.onAction?.()
                dismissToast(toast.id)
              }}
              onDismiss={() => dismissToast(toast.id)}
            />
          </MotiView>
        </View>
      ) : null}
      </AnimatePresence>
    </IsleDialogContext.Provider>
  )
}

function AppToastSurface({
  toast,
  onAction,
  onDismiss,
}: {
  toast: AppFeedbackItem
  onAction: () => void
  onDismiss: () => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const tone = toast.tone ?? 'default'
  const toneToken = dialogToneToken(colors, tone === 'default' ? 'info' : tone)

  return (
    <IslePanel
      material="chrome"
      elevated
      radius={Math.min(colors.ui.radius.panel, 8)}
      style={{ backgroundColor: colors.ui.semantic.chrome.background, borderColor: toneToken.border }}
      contentStyle={{ padding: 0, backgroundColor: colors.ui.semantic.chrome.background }}
    >
      <View style={{ height: 2, backgroundColor: toneToken.foreground }} />
      <View
        accessible
        accessibilityRole="alert"
        accessibilityLiveRegion={tone === 'danger' ? 'assertive' : 'polite'}
        accessibilityLabel={[toast.title, toast.message, toast.occurrences > 1 ? String(toast.occurrences) : null].filter(Boolean).join('. ')}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingLeft: 12, paddingRight: 7, paddingVertical: 10 }}
      >
        <View style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: toastToneSurface(tone, colors) }}>
          <AppIcon name={toastIconName(tone)} color={toastToneForeground(tone, colors)} size={16} strokeWidth={appIconStroke.strong} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text numberOfLines={2} style={{ flexShrink: 1, color: colors.text, fontSize: 14, lineHeight: 19, fontWeight: '800' }}>{toast.title}</Text>
            {toast.occurrences > 1 ? (
              <View style={{ minWidth: 22, height: 20, paddingHorizontal: 6, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ui.semantic.surface.muted }}>
                <Text style={{ color: colors.textSecondary, fontSize: 10, lineHeight: 13, fontWeight: '900' }}>{toast.occurrences}</Text>
              </View>
            ) : null}
          </View>
          {toast.message ? <Text numberOfLines={3} style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 2 }}>{toast.message}</Text> : null}
        </View>
        {toast.actionLabel ? (
          <Pressable
            accessibilityRole="button"
            onPress={onAction}
            style={({ pressed }) => ({
              minHeight: 44,
              maxWidth: 112,
              justifyContent: 'center',
              paddingHorizontal: 9,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text numberOfLines={2} style={{ color: colors.ui.control.link, fontSize: 12, lineHeight: 16, fontWeight: '900', textAlign: 'center' }}>{toast.actionLabel}</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          hitSlop={4}
          onPress={onDismiss}
          style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
        >
          <AppIcon name="close" color={colors.textTertiary} size={17} strokeWidth={appIconStroke.strong} />
        </Pressable>
      </View>
    </IslePanel>
  )
}

function AppBannerViewport({
  banners,
  onAction,
  onDismiss,
}: {
  banners: BannerState[]
  onAction: (banner: BannerState) => void
  onDismiss: (banner: BannerState) => void
}) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const insets = useSafeAreaInsets()
  const { t } = useTranslation()

  return (
    <AnimatePresence>
      {banners.length ? (
        <MotiView
          key="app-feedback-banners"
          pointerEvents="box-none"
          from={motion === 'full' ? { opacity: 0, translateY: -8 } : { opacity: 1, translateY: 0 }}
          animate={{ opacity: 1, translateY: 0 }}
          exit={motion === 'full' ? { opacity: 0, translateY: -6 } : { opacity: 0 }}
          transition={{ type: 'timing', duration: motion === 'full' ? 140 : 1 }}
          style={{ position: 'absolute', top: insets.top + 10, left: 0, right: 0, zIndex: 980, elevation: 11, alignItems: 'center', paddingHorizontal: 16, gap: 8 }}
        >
          {banners.map((banner) => {
            const tone = banner.tone ?? 'default'
            const token = dialogToneToken(colors, tone === 'default' ? 'info' : tone)
            return (
              <View
                key={banner.id}
                accessible
                accessibilityRole="alert"
                accessibilityLiveRegion={tone === 'danger' ? 'assertive' : 'polite'}
                style={{ width: '100%', maxWidth: 560, minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: StyleSheet.hairlineWidth, borderLeftWidth: 3, borderColor: token.border, borderLeftColor: token.foreground, borderRadius: 8, backgroundColor: colors.ui.semantic.chrome.background, paddingLeft: 11, paddingRight: 6, paddingVertical: 8, shadowColor: colors.shadowTint, shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 5 } }}
              >
                <AppIcon name={toastIconName(tone)} color={token.foreground} size={17} strokeWidth={appIconStroke.strong} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '900' }}>{banner.title}</Text>
                  {banner.message ? <Text numberOfLines={3} style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 1 }}>{banner.message}</Text> : null}
                </View>
                {banner.actionLabel ? (
                  <Pressable accessibilityRole="button" onPress={() => onAction(banner)} style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8, opacity: pressed ? 0.68 : 1 })}>
                    <Text numberOfLines={2} style={{ maxWidth: 112, color: colors.ui.control.link, fontSize: 12, lineHeight: 16, fontWeight: '900', textAlign: 'center' }}>{banner.actionLabel}</Text>
                  </Pressable>
                ) : null}
                <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={() => onDismiss(banner)} style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
                  <AppIcon name="close" color={colors.textTertiary} size={17} strokeWidth={appIconStroke.strong} />
                </Pressable>
              </View>
            )
          })}
        </MotiView>
      ) : null}
    </AnimatePresence>
  )
}

function defaultToastDuration(toast: AppFeedbackOptions): number {
  if (toast.actionLabel) return 6200
  if (toast.tone === 'danger') return 5200
  if (toast.message) return 3600
  return 2600
}

function toastIconName(tone: ToastOptions['tone']): 'check' | 'warning' | 'zap' | 'info' {
  if (tone === 'danger') return 'warning'
  if (tone === 'amber') return 'zap'
  if (tone === 'mint') return 'check'
  return 'info'
}

function toastToneForeground(tone: DialogTone, colors: ReturnType<typeof useAppTheme>['colors']): string {
  if (tone === 'danger') return colors.ui.tone.danger.foreground
  if (tone === 'amber') return colors.ui.tone.warning.foreground
  if (tone === 'mint') return colors.ui.tone.success.foreground
  return colors.textSecondary
}

function toastToneSurface(tone: DialogTone, colors: ReturnType<typeof useAppTheme>['colors']): string {
  if (tone === 'danger') return colors.ui.tone.danger.background
  if (tone === 'amber') return colors.ui.tone.warning.background
  if (tone === 'mint') return colors.ui.tone.success.background
  return colors.ui.semantic.surface.muted
}

export function useIsleDialog(): IsleDialogApi {
  const context = useContext(IsleDialogContext)
  return context ?? fallbackDialogApi
}

function ThemeDialogSurface({ dialog, onClose }: { dialog: DialogState; onClose: (value: boolean) => void }) {
  const { colors } = useAppTheme()
  if (colors.ui.family === 'lime-road') return <LimeRoadDialogSurface dialog={dialog} onClose={onClose} />
  if (colors.ui.family === 'markdown') return <MarkdownDialogSurface dialog={dialog} onClose={onClose} />
  return <MinimalDialogSurface dialog={dialog} onClose={onClose} />
}

function MinimalDialogSurface({ dialog, onClose }: { dialog: DialogState; onClose: (value: boolean) => void }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const material = colors.material.sheet
  const tone = dialogToneToken(colors, dialog.tone === 'default' || !dialog.tone ? 'info' : dialog.tone)
  return (
    <View
      testID="dialog-experience-minimal"
      accessibilityRole="alert"
      style={{
        maxHeight: '100%',
        overflow: 'hidden',
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: material.border,
        backgroundColor: colors.ui.semantic.surface.base,
      }}
    >
      <DialogScrollableContent contentStyle={{ paddingHorizontal: 16, paddingTop: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 11 }}>
          <View style={{ width: 3, minHeight: 48, alignSelf: 'stretch', borderRadius: 2, backgroundColor: tone.foreground }} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: colors.text, fontSize: 18, lineHeight: 23, fontWeight: '800' }}>{dialog.title}</Text>
            {dialog.message ? (
              <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 6 }}>{dialog.message}</Text>
            ) : null}
          </View>
          <DialogCloseButton onPress={() => onClose(false)} />
        </View>
        {dialog.chips?.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 14 }}>
            {dialog.chips.map((chip, index) => <DialogChip key={`${chip.label}-${index}`} chip={chip} />)}
          </View>
        ) : null}
        {dialog.renderBody ? <View style={{ marginTop: 14 }}>{dialog.renderBody()}</View> : null}
        {dialog.metrics?.length ? (
          <View style={{ gap: 6, marginTop: 14 }}>
            {dialog.metrics.map((metric, index) => <DialogMetricRow key={`${metric.label}-${index}`} metric={metric} />)}
          </View>
        ) : null}
      </DialogScrollableContent>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, padding: 16 }}>
        {dialog.kind === 'confirm' ? (
          <IsleButton
            label={dialog.cancelLabel ?? t('common.cancel')}
            onPress={() => onClose(false)}
            style={{ flex: 1, minWidth: 0 }}
          />
        ) : null}
        <IsleButton
          label={dialog.kind === 'confirm' ? dialog.confirmLabel ?? t('common.confirm') : dialog.actionLabel ?? t('dialog.ok')}
          tone={dialogActionTone(dialog)}
          onPress={() => onClose(true)}
          style={{ flex: 1, minWidth: 0 }}
        />
      </View>
    </View>
  )
}

function LimeRoadDialogSurface({ dialog, onClose }: { dialog: DialogState; onClose: (value: boolean) => void }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const material = colors.material.sheet
  const tone = dialogToneToken(colors, dialog.tone === 'default' || !dialog.tone ? 'info' : dialog.tone)
  return (
    <View testID="dialog-experience-lime-road" accessibilityRole="alert" style={{ maxHeight: '100%' }}>
      <IslePanel
        material="chrome"
        elevated
        radius={4}
        style={{ maxHeight: '100%', backgroundColor: material.surface, borderColor: colors.material.strokeStrong }}
        contentStyle={{ maxHeight: '100%', padding: 0, backgroundColor: colors.ui.semantic.surface.base }}
      >
      <View style={{ height: 4, backgroundColor: colors.primary }} />
      <DialogScrollableContent contentStyle={{ padding: 16, borderLeftWidth: 3, borderLeftColor: tone.foreground }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
            <Text style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 21, lineHeight: 26, fontWeight: '900' }}>{dialog.title}</Text>
            <DialogCloseButton onPress={() => onClose(false)} compact />
          </View>
          {dialog.message ? (
            <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 20, marginTop: 7, fontWeight: '700' }}>{dialog.message}</Text>
          ) : null}
          {dialog.chips?.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 13 }}>
              {dialog.chips.map((chip, index) => <DialogChip key={`${chip.label}-${index}`} chip={chip} />)}
            </View>
          ) : null}
          {dialog.metrics?.length ? (
            <View style={{ gap: 7, marginTop: 13 }}>
              {dialog.metrics.map((metric, index) => <DialogMetricRow key={`${metric.label}-${index}`} metric={metric} />)}
            </View>
          ) : null}
          {dialog.renderBody ? <View style={{ marginTop: 13 }}>{dialog.renderBody()}</View> : null}
      </DialogScrollableContent>
      <View style={{ padding: 12, flexDirection: 'row', gap: 9, borderTopWidth: 1, borderTopColor: colors.material.stroke, backgroundColor: material.chrome }}>
        {dialog.kind === 'confirm' ? (
          <IsleButton label={dialog.cancelLabel ?? t('common.cancel')} onPress={() => onClose(false)} style={{ flex: 0.82, minWidth: 0, borderRadius: 3 }} />
        ) : null}
        <IsleButton
          label={dialog.kind === 'confirm' ? dialog.confirmLabel ?? t('common.confirm') : dialog.actionLabel ?? t('dialog.ok')}
          tone={dialogActionTone(dialog)}
          onPress={() => onClose(true)}
          style={{ flex: 1.18, minWidth: 0, borderRadius: 3 }}
        />
      </View>
      </IslePanel>
    </View>
  )
}

function MarkdownDialogSurface({ dialog, onClose }: { dialog: DialogState; onClose: (value: boolean) => void }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const material = colors.material.sheet
  return (
    <View
      testID="dialog-experience-markdown"
      accessibilityRole="alert"
      style={{ maxHeight: '100%', overflow: 'hidden', borderWidth: 1, borderColor: colors.material.strokeStrong, backgroundColor: colors.ui.semantic.surface.base }}
    >
      <DialogScrollableContent contentStyle={{ paddingHorizontal: 15, paddingTop: 14, paddingBottom: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingBottom: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.material.stroke }}>
          <Text style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 20, lineHeight: 26, fontWeight: '900' }}>{dialog.title}</Text>
          <DialogCloseButton onPress={() => onClose(false)} compact />
        </View>
        {dialog.message ? (
          <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 20, marginTop: 8 }}>{dialog.message}</Text>
        ) : null}
        {dialog.chips?.length ? (
          <View style={{ marginTop: 14, paddingVertical: 9, gap: 7, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.material.stroke }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
              {dialog.chips.map((chip, index) => <DialogChip key={`${chip.label}-${index}`} chip={chip} />)}
            </View>
          </View>
        ) : null}
        {dialog.metrics?.length ? (
          <View style={{ gap: 1, marginTop: 13 }}>
            {dialog.metrics.map((metric, index) => <DialogMetricRow key={`${metric.label}-${index}`} metric={metric} />)}
          </View>
        ) : null}
        {dialog.renderBody ? <View style={{ marginTop: 14 }}>{dialog.renderBody()}</View> : null}
      </DialogScrollableContent>
      <View style={{ paddingHorizontal: 12, paddingVertical: 11, flexDirection: 'row', gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.material.stroke, backgroundColor: material.chrome }}>
        {dialog.kind === 'confirm' ? (
          <IsleButton label={dialog.cancelLabel ?? t('common.cancel')} onPress={() => onClose(false)} style={{ flex: 0.85, minWidth: 0, borderRadius: 0 }} />
        ) : null}
        <IsleButton
          label={dialog.kind === 'confirm' ? dialog.confirmLabel ?? t('common.confirm') : dialog.actionLabel ?? t('dialog.ok')}
          tone={dialogActionTone(dialog)}
          onPress={() => onClose(true)}
          style={{ flex: 1.15, minWidth: 0, borderRadius: 0 }}
        />
      </View>
    </View>
  )
}

function DialogScrollableContent({ children, contentStyle }: { children: ReactNode; contentStyle: StyleProp<ViewStyle> }) {
  return (
    <ScrollView
      bounces={false}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      style={{ flexShrink: 1 }}
      contentContainerStyle={contentStyle}
    >
      {children}
    </ScrollView>
  )
}

function DialogCloseButton({ onPress, compact = false }: { onPress: () => void; compact?: boolean }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  return (
    <IsleButton
      label={t('dialog.close')}
      icon={<AppIcon name="close" color={colors.textTertiary} size={compact ? 16 : 18} strokeWidth={appIconStroke.strong} />}
      onPress={onPress}
      style={{ width: 44, height: 44, minHeight: 44, borderRadius: colors.ui.family === 'markdown' ? 0 : Math.min(colors.ui.radius.controlMiddle, 8), paddingHorizontal: 0 }}
      textStyle={{ display: 'none' }}
    />
  )
}

function dialogActionTone(dialog: DialogState): 'danger' | 'amber' | 'primary' {
  return dialog.tone === 'danger' ? 'danger' : dialog.tone === 'amber' ? 'amber' : 'primary'
}

function ToneBadge({ tone, small = false }: { tone: DialogTone; small?: boolean }) {
  const { colors } = useAppTheme()
  const size = small ? 28 : 42
  const toneToken = dialogToneToken(colors, tone === 'default' ? 'info' : tone)
  const borderWidth = dialogBorderWidth(colors)
  return (
    <View style={{
      width: size,
      height: size,
      borderRadius: size / 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: toneToken.background,
      borderWidth,
      borderColor: toneToken.border,
      shadowColor: colors.shadowTint,
      shadowOpacity: 0,
      shadowRadius: 0,
      shadowOffset: { width: 0, height: 0 },
      elevation: 0,
    }}>
      {tone === 'danger'
        ? <AppIcon name="warning" color={toneToken.foreground} size={small ? 15 : 21} strokeWidth={appIconStroke.strong} />
        : tone === 'mint'
          ? <AppIcon name="check" color={toneToken.foreground} size={small ? 15 : 21} strokeWidth={appIconStroke.bold} />
          : <AppIcon name="info" color={toneToken.foreground} size={small ? 15 : 21} strokeWidth={appIconStroke.strong} />}
    </View>
  )
}

function DialogChip({ chip }: { chip: IsleDialogChip }) {
  const { colors } = useAppTheme()
  const tone = chip.tone ?? 'default'
  const toneToken = dialogToneToken(colors, tone)
  const isGlass = colors.ui.glass
  const backgroundColor = tone === 'default' && isGlass ? colors.ui.actionBar.itemBackground : toneToken.background
  const borderColor = tone === 'default' && isGlass ? colors.ui.actionBar.itemBorder : toneToken.border
  const foreground = tone === 'default' && isGlass ? colors.textSecondary : toneToken.foreground
  const borderWidth = dialogBorderWidth(colors)
  return (
    <View style={{
      minHeight: 30,
      borderRadius: colors.ui.radius.chip,
      paddingHorizontal: 11,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor,
      borderWidth,
      borderColor,
    }}>
      <Text numberOfLines={1} style={{ color: foreground, fontSize: 11, fontWeight: '800' }}>{chip.label}</Text>
    </View>
  )
}

function DialogMetricRow({ metric }: { metric: IsleDialogMetric }) {
  const { colors } = useAppTheme()
  const backgroundColor = colors.ui.glass ? colors.ui.semantic.surface.overlay : colors.ui.semantic.surface.base
  const borderWidth = dialogBorderWidth(colors)
  return (
    <View style={{
      borderRadius: Math.min(colors.ui.radius.card, 8),
      padding: 11,
      backgroundColor,
      borderWidth,
      borderColor: colors.ui.semantic.chrome.border,
    }}>
      <Text style={{ color: colors.text, fontSize: 12, fontWeight: '800' }}>{metric.label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 }}>
        {metric.before ? <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '800', flex: 1, minWidth: 0 }}>{metric.before}</Text> : null}
        {metric.after ? <Text style={{ color: colors.ui.icon.accentForeground, fontSize: 12, fontWeight: '800' }}>→</Text> : null}
        {metric.after ? <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '700', flex: 1, minWidth: 0 }}>{metric.after}</Text> : null}
      </View>
    </View>
  )
}

function dialogToneToken(colors: ReturnType<typeof useAppTheme>['colors'], tone: DialogTone | 'info') {
  if (tone === 'mint') return colors.ui.tone.success
  if (tone === 'amber') return colors.ui.tone.warning
  if (tone === 'danger') return colors.ui.tone.danger
  if (tone === 'info') return colors.ui.tone.info
  return colors.ui.tone.neutral
}
