import { StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { AppIcon, type AppIconName } from '@/components/ui/AppIcon'
import { IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'

const RUNTIME_REPAIR_ACTION_HIT_SLOP = { top: 8, right: 6, bottom: 8, left: 6 }

export interface RuntimeRepairIntent {
  key: string
  prompt: string
  payloadJson: string
  payloadSchema: string
  repairStepCount: number
  scope: string
  summary: string
  action: string
  actionLabel: string
  target: string
  targetLabel: string
  event: string
  latestEventId?: string
  sourceEventIds: string[]
  eventCount: number
  issueCodes: string[]
  severity?: string
  severityLabel?: string
}

export function RuntimeRepairIntentCard({
  intent,
  onSubmit,
  onApplyDraft,
  onDismiss,
}: {
  intent: RuntimeRepairIntent
  onSubmit?: () => void
  onApplyDraft?: () => void
  onDismiss?: () => void
}) {
  const { colors, isGlass } = useAppTheme()
  const { t } = useTranslation()
  const subtleBorderWidth = colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth
  return (
    <View
      style={{
        marginBottom: 5,
        borderRadius: colors.ui.radius.panel,
        padding: 10,
        backgroundColor: isGlass ? colors.ui.semantic.chrome.background : colors.ui.limeRoad ? colors.ui.semantic.surface.base : colors.ui.semantic.surface.base,
        borderWidth: subtleBorderWidth,
        borderColor: colors.ui.limeRoad ? colors.material.stroke : isGlass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 28, height: 28, borderRadius: colors.ui.radius.controlSmall, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ui.tone.warning.background, borderWidth: subtleBorderWidth, borderColor: colors.ui.tone.warning.border }}>
          <AppIcon name="retry" color={colors.ui.tone.warning.foreground} size={15} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: 12.5, lineHeight: 17, fontWeight: '800', includeFontPadding: false, textAlignVertical: 'center' }}>{t('chat.runtimeRepairIntentTitle')}</Text>
          <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 10.5, lineHeight: 15, fontWeight: '700', marginTop: 2, includeFontPadding: false, textAlignVertical: 'center' }}>
            {t('chat.runtimeRepairIntentMeta', {
              severity: intent.severityLabel ?? t('common.unknown'),
              action: intent.actionLabel,
              target: intent.targetLabel,
              eventCount: intent.eventCount,
            })}
          </Text>
          <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 10.5, lineHeight: 15, fontWeight: '800', marginTop: 2, includeFontPadding: false, textAlignVertical: 'center' }}>
            {t('chat.runtimeRepairIntentDetail', { scope: intent.scope, summary: intent.summary })}
          </Text>
          <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10, lineHeight: 14, fontWeight: '800', marginTop: 2, includeFontPadding: false, textAlignVertical: 'center' }}>
            {t('chat.runtimeRepairIntentIssues', { issueCodes: intent.issueCodes.length ? intent.issueCodes.join(', ') : t('common.none') })}
          </Text>
          <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10, lineHeight: 14, fontWeight: '800', marginTop: 2, includeFontPadding: false, textAlignVertical: 'center' }}>
            {t('chat.runtimeRepairIntentEventId', { schema: intent.payloadSchema, stepCount: intent.repairStepCount, eventId: intent.latestEventId ?? intent.sourceEventIds[0] ?? t('common.none') })}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
        <RuntimeRepairIntentButton label={t('chat.runtimeRepairIntentSend')} icon="send" primary onPress={onSubmit} />
        <RuntimeRepairIntentButton label={t('chat.runtimeRepairIntentApplyDraft')} icon="edit" onPress={onApplyDraft} />
        <RuntimeRepairIntentButton label={t('common.done')} icon="collapse" onPress={onDismiss} />
      </View>
    </View>
  )
}

function RuntimeRepairIntentButton({
  label,
  icon,
  primary = false,
  onPress,
}: {
  label: string
  icon: AppIconName
  primary?: boolean
  onPress?: () => void
}) {
  const { colors } = useAppTheme()
  const subtleBorderWidth = colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth
  return (
    <IslePressable
      haptic
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={RUNTIME_REPAIR_ACTION_HIT_SLOP}
      style={{
        minHeight: 36,
        flexGrow: primary ? 1.4 : 1,
        flexShrink: 1,
        flexBasis: primary ? '42%' : '26%',
        minWidth: 0,
        borderRadius: colors.ui.radius.controlLarge,
        paddingHorizontal: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        backgroundColor: primary ? colors.ui.control.primaryBackground : colors.ui.semantic.surface.muted,
        borderWidth: subtleBorderWidth,
        borderColor: primary ? colors.ui.control.primaryBorder : colors.ui.semantic.chrome.border,
      }}
    >
      <AppIcon name={icon} color={primary ? colors.ui.control.primaryForeground : colors.textSecondary} size={13} />
      <Text numberOfLines={1} style={{ color: primary ? colors.ui.control.primaryForeground : colors.textSecondary, fontSize: 10.5, lineHeight: 14, fontWeight: '800', includeFontPadding: false, textAlignVertical: 'center' }}>{label}</Text>
    </IslePressable>
  )
}
