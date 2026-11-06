import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import type { ProviderConnectionReferences as ReferenceReport } from '@/core'
import { Text } from '@/components/ui/AppText'
import { IsleButton, IslePressable } from '@/components/ui/isle'
import { useSettingsLeave } from '@/components/settings/SettingsEditBoundary'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import type { ProviderConnectionReferencePort } from '@/presentation/features/settings/providerConnectionReferencePort'
import { providerConnectionReferenceCoverage, providerConnectionReferenceDestination } from '@/presentation/features/settings/providerConnectionReferencePresentation'

export function ProviderConnectionReferences({ providerId, port }: { providerId: string; port: ProviderConnectionReferencePort }) {
  const { t } = useTranslation()
  const { colors } = useAppTheme()
  const typography = colors.design!.semantic.typography
  const providers = useSettingsStore(state => state.providers)
  const leave = useSettingsLeave()
  const [open, setOpen] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [report, setReport] = useState<ReferenceReport>()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [expanded, setExpanded] = useState<string[]>([])
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setBusy(true); setFailed(false)
    void port.load([providerId], controller.signal).then(value => {
      if (!controller.signal.aborted) setReport(value)
    }).catch(() => { if (!controller.signal.aborted) setFailed(true) })
      .finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => controller.abort()
  }, [open, providerId, port, refresh])
  const current = report?.providerIds.length === 1 && report.providerIds[0] === providerId ? report : undefined
  const secondary = [typography.body, { color: colors.textSecondary }]
  return <View testID="provider-connection-references" style={styles.root}>
    <IslePressable testID="provider-references-toggle" accessibilityRole="button" accessibilityLabel={t('connectionReferences.title')}
      accessibilityState={{ expanded: open }} onPress={() => setOpen(value => !value)}
      style={[styles.disclosure, { borderColor: colors.ui.section.divider }]}>
      <Text style={[typography.label, { color: colors.text, flex: 1 }]}>{t('connectionReferences.title')}</Text>
      <Text style={secondary}>{t(open ? 'connectionReferences.collapse' : 'connectionReferences.view')}</Text>
    </IslePressable>
    {open ? <View testID="provider-references-report" style={styles.content}>
      <Text style={secondary}>{t('connectionReferences.scope')}</Text>
      {busy ? <Text accessibilityLiveRegion="polite" style={secondary}>{t('common.loading')}</Text> : null}
      {failed ? <Text accessibilityRole="alert" style={[typography.body, { color: colors.ui.tone.warning.foreground }]}>{t('connectionReferences.loadFailed')}</Text> : null}
      {current ? <>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>{t('connectionReferences.captured', { time: new Date(current.capturedAt).toLocaleString() })}</Text>
        {current.groups.filter(group => group.total).map(group => {
          const all = expanded.includes(group.kind)
          return <View key={group.kind} testID={`provider-references-${group.kind}`} style={styles.group}>
            <Text style={[typography.label, { color: colors.text }]}>{t(`connectionReferences.count.${group.kind}`, { count: group.total })}</Text>
            {group.items.slice(0, all ? 25 : 3).map(reference => {
              const destination = providerConnectionReferenceDestination(reference)
              const label = reference.label || t(`connectionReferences.label.${reference.kind}`)
              const content = <View style={styles.reference}>
                <Text style={[typography.body, { color: colors.text }]}>{label}{reference.draft ? ` · ${t('connectionReferences.draft')}` : ''}</Text>
                {reference.targets.map((target, index) => <Text key={index} style={secondary}>
                  {providers.find(provider => provider.id === target.providerId)?.name || target.providerId} · {t(`connectionReferences.role.${target.role}`)}{target.model ? ` · ${target.model}` : ''}
                </Text>)}
                {destination ? <Text style={[typography.caption, { color: colors.textSecondary }]}>{t('connectionReferences.open')}</Text> : null}
              </View>
              return destination ? <IslePressable key={reference.id} testID={`provider-reference-${reference.kind}-${reference.id}`}
                accessibilityRole="button" accessibilityLabel={`${t('connectionReferences.open')} · ${label}`}
                onPress={() => void leave(() => router.push(destination))} style={styles.referenceAction}>{content}</IslePressable>
                : <View key={reference.id}>{content}</View>
            })}
            {group.items.length > 3 ? <IsleButton label={t(all ? 'connectionReferences.showLess' : 'connectionReferences.showMore')}
              onPress={() => setExpanded(value => all ? value.filter(kind => kind !== group.kind) : [...value, group.kind])} /> : null}
            {group.truncated ? <Text style={secondary}>{t('connectionReferences.listLimited', { count: group.items.length })}</Text> : null}
          </View>
        })}
        {!current.groups.some(group => group.total) ? <Text style={secondary}>
          {t(current.conversations.savedRemaining || current.conversations.unreadable ? 'connectionReferences.noKnownReferences' : 'connectionReferences.none')}
        </Text> : null}
        {providerConnectionReferenceCoverage(current, t).map((line, index) => <Text key={index} style={secondary}>{line}</Text>)}
        <Text style={secondary}>{t('connectionReferences.keptAfterDelete')}</Text>
        {current.groups.some(group => group.kind === 'default' && group.total) ? <Text style={secondary}>{t('connectionReferences.defaultAfterDelete')}</Text> : null}
        {current.groups.some(group => group.kind === 'favorite' && group.total) ? <Text style={secondary}>{t('connectionReferences.favoritesAfterDelete')}</Text> : null}
        {current.groups.some(group => ['default', 'preferred', 'favorite'].includes(group.kind) && group.total) ? <IsleButton
          label={t('connectionReferences.manageModels')} onPress={() => void leave(() => router.push('/settings/category/models'))} /> : null}
      </> : null}
      <IsleButton testID="provider-references-refresh" label={t(failed ? 'common.retry' : 'connectionReferences.refresh')}
        busy={busy} disabled={busy} onPress={() => setRefresh(value => value + 1)} />
    </View> : null}
  </View>
}

const styles = StyleSheet.create({
  root: { minWidth: 0 },
  disclosure: { minHeight: 48, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 10 },
  content: { minWidth: 0, gap: 12, paddingBottom: 12 },
  group: { minWidth: 0, gap: 6 },
  reference: { minWidth: 0, gap: 3, paddingVertical: 8 },
  referenceAction: { minWidth: 0, minHeight: 48 },
})
