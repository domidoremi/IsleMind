import { Text, View } from 'react-native'
import { X } from 'lucide-react-native'
import { MotiView } from 'moti'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { IsleIconButton } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { resolveActivationJobProgress, useActivationJobStore, type ActivationJobState } from '@/store/activationJobStore'
import { motionTokens } from '@/theme/animation'

export function ActivationProgressBanner() {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
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
      style={{ position: 'absolute', top: Math.max(insets.top, 10) + 8, left: 14, right: 14, zIndex: 200 }}
    >
      <View style={{ borderRadius: 24, padding: 12, backgroundColor: colors.material.chrome, borderWidth: 1, borderColor: colors.borderStrong, shadowColor: colors.shadowTint, shadowOpacity: 0.2, shadowRadius: 0, shadowOffset: { width: 0, height: 4 }, elevation: 8, gap: 9 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '900' }}>
              {done ? activationDoneTitle(job.total, t) : t('providerSettings.activationRunning')}
            </Text>
            <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 2, fontWeight: '800' }}>
              {job.stage ?? job.currentName ?? t('providerSettings.activationQueued')}
            </Text>
          </View>
          {done ? (
            <IsleIconButton label={t('dialog.close')} size="sm" onPress={clear}>
              <X color={colors.textSecondary} size={15} />
            </IsleIconButton>
          ) : null}
        </View>
        <ActivationProgressBar job={job} />
        <Text style={{ color: colors.textTertiary, fontSize: 10, lineHeight: 15, fontWeight: '900' }}>
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
    <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.islandRaised, overflow: 'hidden' }}>
      <MotiView
        animate={{ width: `${Math.max(4, Math.round(progress * 100))}%` }}
        transition={{ type: 'timing', duration: 180 }}
        style={{ height: 8, borderRadius: 4, backgroundColor: job.failed ? colors.warning : colors.primary }}
      />
    </View>
  )
}
