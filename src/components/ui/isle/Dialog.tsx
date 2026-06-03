import type { ReactNode } from 'react'
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { Modal, Pressable, Text, View } from 'react-native'
import { AlertTriangle, Check, Info, X } from 'lucide-react-native'
import { MotiView } from 'moti'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { IsleCard } from './IsleKit'
import { IsleButton } from './Controls'
import { IslePanel } from './Panel'
import { useAppTheme } from '@/hooks/useAppTheme'

type DialogTone = 'default' | 'mint' | 'amber' | 'danger'

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

interface ToastOptions {
  title: string
  message?: string
  tone?: DialogTone
  durationMs?: number
  position?: 'top' | 'bottom'
}

interface DialogState extends ConfirmOptions {
  id: number
  kind: 'confirm' | 'notice'
  resolve?: (value: boolean) => void
  actionLabel?: string
}

interface ToastState extends ToastOptions {
  id: number
}

interface IsleDialogApi {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  notice: (options: NoticeOptions) => void
  toast: (options: ToastOptions) => void
}

const IsleDialogContext = createContext<IsleDialogApi | null>(null)

export function IsleDialogProvider({ children }: { children: ReactNode }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const idRef = useRef(0)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const closeDialog = useCallback((value: boolean) => {
    setDialog((current) => {
      current?.resolve?.(value)
      return null
    })
  }, [])

  const api = useMemo<IsleDialogApi>(() => ({
    confirm: (options) =>
      new Promise<boolean>((resolve) => {
        setDialog({ ...options, id: idRef.current++, kind: 'confirm', resolve })
      }),
    notice: (options) => {
      setDialog({ ...options, id: idRef.current++, kind: 'notice' })
    },
    toast: (options) => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
      const next = { ...options, id: idRef.current++ }
      setToast(next)
      toastTimer.current = setTimeout(() => {
        setToast((current) => current?.id === next.id ? null : current)
      }, options.durationMs ?? 2400)
    },
  }), [])

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
        <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 18 }}>
          <Pressable
            accessibilityLabel={t('dialog.closeLayer')}
            onPress={() => closeDialog(false)}
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.backdrop }}
          />
          {dialog ? (
            <MotiView
              key={dialog.id}
              from={{ opacity: 0, translateY: 18, scale: 0.97 }}
              animate={{ opacity: 1, translateY: 0, scale: 1 }}
              transition={{ type: 'spring', damping: 20, stiffness: 190 }}
            >
              <IsleCard type="title" style={{ padding: 18, borderRadius: colors.ui.radius.modal }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                  <ToneBadge tone={dialog.tone ?? 'default'} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontSize: 19, lineHeight: 25, fontWeight: '900' }}>
                      {dialog.title}
                    </Text>
                    {dialog.message ? (
                      <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 20, marginTop: 7, fontWeight: '700' }}>
                        {dialog.message}
                      </Text>
                    ) : null}
                  </View>
                  <IsleButton
                    label={t('dialog.close')}
                    icon={<X color={colors.textTertiary} size={18} strokeWidth={2.2} />}
                    onPress={() => closeDialog(false)}
                    style={{ width: 44, height: 44, minHeight: 44, borderRadius: 22, paddingHorizontal: 0 }}
                    textStyle={{ display: 'none' }}
                  />
                </View>
                {dialog.chips?.length ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 13 }}>
                    {dialog.chips.map((chip, index) => <DialogChip key={`${chip.label}-${index}`} chip={chip} />)}
                  </View>
                ) : null}
                {dialog.metrics?.length ? (
                  <View style={{ gap: 8, marginTop: 13 }}>
                    {dialog.metrics.map((metric, index) => <DialogMetricRow key={`${metric.label}-${index}`} metric={metric} />)}
                  </View>
                ) : null}
                {dialog.renderBody ? <View style={{ marginTop: 13 }}>{dialog.renderBody()}</View> : null}
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                  {dialog.kind === 'confirm' ? (
                    <IsleButton
                      label={dialog.cancelLabel ?? t('common.cancel')}
                      onPress={() => closeDialog(false)}
                      style={{ flex: 1 }}
                    />
                  ) : null}
                  <IsleButton
                    label={dialog.kind === 'confirm' ? dialog.confirmLabel ?? t('common.confirm') : dialog.actionLabel ?? t('dialog.ok')}
                    tone={dialog.tone === 'danger' ? 'danger' : dialog.tone === 'amber' ? 'amber' : 'primary'}
                    onPress={() => closeDialog(true)}
                    style={{ flex: 1 }}
                  />
                </View>
              </IsleCard>
            </MotiView>
          ) : null}
        </View>
      </Modal>
      {toast ? (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            ...(toast.position === 'bottom'
              ? { bottom: 18 + insets.bottom }
              : { top: 18 + insets.top }),
            zIndex: 999,
            alignItems: 'center',
            paddingHorizontal: 16,
          }}
        >
          <MotiView
            key={toast.id}
            from={{ opacity: 0, translateY: toast.position === 'bottom' ? 16 : -16, scale: 0.98 }}
            animate={{ opacity: 1, translateY: 0, scale: 1 }}
            transition={{ type: 'spring', damping: 20, stiffness: 210 }}
            style={{ width: '100%', maxWidth: 420 }}
          >
            <IslePanel material="chrome" elevated radius={colors.ui.radius.panel} contentStyle={{ paddingHorizontal: 13, paddingVertical: 11 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <ToneBadge tone={toast.tone ?? 'mint'} small />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ color: colors.text, fontSize: 14, fontWeight: '900' }}>{toast.title}</Text>
                  {toast.message ? <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 2 }}>{toast.message}</Text> : null}
                </View>
              </View>
            </IslePanel>
          </MotiView>
        </View>
      ) : null}
    </IsleDialogContext.Provider>
  )
}

export function useIsleDialog(): IsleDialogApi {
  const context = useContext(IsleDialogContext)
  if (!context) {
    throw new Error('useIsleDialog must be used inside IsleDialogProvider')
  }
  return context
}

function ToneBadge({ tone, small = false }: { tone: DialogTone; small?: boolean }) {
  const { colors } = useAppTheme()
  const size = small ? 28 : 42
  const background =
    tone === 'danger'
      ? colors.coralWash
      : tone === 'amber'
        ? colors.amberSoft
        : tone === 'mint'
          ? colors.mintSoft
          : colors.skySoft
  const foreground =
    tone === 'danger'
      ? colors.error
      : tone === 'amber'
        ? colors.warning
        : tone === 'mint'
          ? colors.primary
          : colors.secondary
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: background }}>
      {tone === 'danger'
        ? <AlertTriangle color={foreground} size={small ? 15 : 21} strokeWidth={2.2} />
        : tone === 'mint'
          ? <Check color={foreground} size={small ? 15 : 21} strokeWidth={2.4} />
          : <Info color={foreground} size={small ? 15 : 21} strokeWidth={2.2} />}
    </View>
  )
}

function DialogChip({ chip }: { chip: IsleDialogChip }) {
  const { colors } = useAppTheme()
  const tone = chip.tone ?? 'default'
  const background = tone === 'mint' ? colors.mintSoft : tone === 'amber' ? colors.amberSoft : tone === 'danger' ? colors.coralWash : colors.islandRaised
  const foreground = tone === 'danger' ? colors.error : tone === 'mint' ? colors.primary : colors.textSecondary
  return (
    <View style={{ minHeight: 30, borderRadius: 15, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: background, borderWidth: 1, borderColor: colors.border }}>
      <Text numberOfLines={1} style={{ color: foreground, fontSize: 11, fontWeight: '900' }}>{chip.label}</Text>
    </View>
  )
}

function DialogMetricRow({ metric }: { metric: IsleDialogMetric }) {
  const { colors } = useAppTheme()
  return (
    <View style={{ borderRadius: 18, padding: 11, backgroundColor: colors.material.paperRaised, borderWidth: 1, borderColor: colors.border }}>
      <Text style={{ color: colors.text, fontSize: 12, fontWeight: '900' }}>{metric.label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 }}>
        {metric.before ? <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '800', flex: 1 }}>{metric.before}</Text> : null}
        {metric.after ? <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '900' }}>→</Text> : null}
        {metric.after ? <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900', flex: 1 }}>{metric.after}</Text> : null}
      </View>
    </View>
  )
}
