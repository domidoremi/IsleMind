import { StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { MotiView } from 'moti'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AppIcon } from '@/components/ui/AppIcon'
import { IsleIconButton } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { resolveActivationJobProgress, useActivationJobStore, type ActivationJobState } from '@/store/activationJobStore'
import { motionTokens } from '@/theme/animation'

export function ActivationProgressBanner() {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const edgeInset = width < 390 ? 10 : 14
  const subtleBorderWidth = colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth
  const job = useActivationJobStore((state) => state.job)
  const clear = useActivationJobStore((state) => state.clear)

  if (!job) return null

  const done = job.status !== 'running'
  return (
    <MotiView
      key={job.id}
      from={{ opacity: 0, translateY: -12 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'spring', ...motionTokens.spring.gentle }}
      pointerEvents="auto"
      style={{ position: 'absolute', top: Math.max(insets.top, 10) + 8, left: edgeInset, right: edgeInset, zIndex: 200 }}
    >
      <View style={{ borderRadius: colors.ui.radius.panel, padding: 12, backgroundColor: colors.ui.glass ? colors.ui.semantic.chrome.background : colors.ui.cartoon ? colors.ui.semantic.surface.base : colors.ui.semantic.surface.base, borderWidth: subtleBorderWidth, borderColor: colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.cartoon ? colors.material.stroke : colors.ui.semantic.chrome.border, shadowColor: colors.ui.control.shadow, shadowOpacity: colors.ui.cartoon ? Math.min(colors.ui.card.shadowOpacity, 0.05) : 0, shadowRadius: colors.ui.cartoon ? Math.max(2, colors.ui.card.shadowRadius - 4) : 0, shadowOffset: { width: 0, height: colors.ui.cartoon ? Math.max(1, colors.ui.card.shadowOffset - 2) : 0 }, elevation: colors.ui.cartoon && colors.ui.card.shadowOpacity > 0 ? 1 : 0, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '900', includeFontPadding: false }}>
              {done ? activationDoneTitle(job.total, t) : t('providerSettings.activationRunning')}
            </Text>
            <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 2, fontWeight: '800', includeFontPadding: false }}>
              {job.stage ?? job.currentName ?? t('providerSettings.activationQueued')}
            </Text>
          </View>
          {done ? (
            <IsleIconButton label={t('dialog.close')} size="sm" onPress={clear}>
              <AppIcon name="close" color={colors.textSecondary} size={15} />
            </IsleIconButton>
          ) : null}
        </View>
        <ActivationProgressBar job={job} />
        <Text numberOfLines={2} style={{ color: colors.textTertiary, fontSize: 10, lineHeight: 14, fontWeight: '800', includeFontPadding: false }}>
          {t('providerSettings.activationProgressMessage', { completed: job.completed, total: job.total, synced: job.synced, tested: job.tested, failed: job.failed })}
        </Text>
      </View>
    </MotiView>
  )
}

function activationDoneTitle(total: number, t: ReturnType<typeof useTranslation>['t']): string {
  return total === 1 ? t('providerSettings.activationSingleDone') : t('providerSettings.activationBatchDone')
}

function ActivationProgressBar({ job }: { job: ActivationJobState }) {
  const { colors } = useAppTheme()
  const progress = resolveActivationJobProgress(job)
  return (
    <View style={{ height: 7, borderRadius: colors.ui.radius.chip, backgroundColor: colors.ui.section.divider, overflow: 'hidden' }}>
      <MotiView
        animate={{ width: `${Math.max(4, Math.round(progress * 100))}%` }}
        transition={{ type: 'timing', duration: 180 }}
        style={{ height: 7, borderRadius: colors.ui.radius.chip, backgroundColor: job.failed ? colors.ui.tone.warning.foreground : colors.ui.control.primaryBackground }}
      />
    </View>
  )
}
