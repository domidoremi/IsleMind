import { useState } from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Text } from '@/components/ui/AppText'
import { useAppTheme } from '@/hooks/useAppTheme'
import type { RedactedUsageDetailField, RedactedUsageRequestDetail } from './usageRequestDetailTypes'

const readingIds = new Set(['total', 'latency'])
const routeIds = new Set(['provider', 'original-provider', 'original-model', 'source', 'measurement'])
const tokenIds = new Set(['input', 'output', 'cache', 'reasoning'])
const timingIds = new Set(['first-token', 'cost'])
const diagnosticIds = new Set(['retries', 'failovers', 'error'])

export function UsageRequestDetail({ detail, redactedLabel, statusColor }: {
  detail: RedactedUsageRequestDetail
  redactedLabel: string
  statusColor: string
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const { width, fontScale } = useWindowDimensions()
  const [columnWidth, setColumnWidth] = useState(0)
  const singleColumn = Math.min(width, columnWidth || width) / fontScale < 270
  const typography = colors.design!.semantic.typography
  const model = detail.fields.find(field => field.id === 'model')
  const knownIds = new Set(['model', ...readingIds, ...routeIds, ...tokenIds, ...timingIds, ...diagnosticIds])
  const groups = [
    { id: 'readings', label: undefined, fields: detail.fields.filter(field => readingIds.has(field.id)) },
    { id: 'route', label: t('usage.detailRoute'), fields: detail.fields.filter(field => routeIds.has(field.id)) },
    { id: 'tokens', label: t('usage.detailTokens'), fields: detail.fields.filter(field => tokenIds.has(field.id)) },
    { id: 'timing', label: t('usage.detailTiming'), fields: detail.fields.filter(field => timingIds.has(field.id)) },
    { id: 'diagnostics', label: t('usage.detailDiagnostics'), fields: detail.fields.filter(field => diagnosticIds.has(field.id)) },
    { id: 'other', label: t('usage.detailOther'), fields: detail.fields.filter(field => !knownIds.has(field.id)) },
  ]

  return <View testID="usage-request-detail" style={[styles.root, { backgroundColor: colors.material.sheet.body }]} onLayout={event => setColumnWidth(event.nativeEvent.layout.width)}>
    <View style={styles.heading}>
      <View style={styles.statusLine}>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        <Text style={[typography.label, { color: statusColor }]}>{detail.statusLabel}</Text>
        {detail.subtitle ? <Text style={[typography.caption, { color: colors.textSecondary, flexShrink: 1 }]}>{detail.subtitle}</Text> : null}
      </View>
      {model ? <DetailField field={model} headline /> : <Text style={[typography.headline, { color: colors.text }]}>{detail.title}</Text>}
      <Text testID="usage-detail-redaction" style={[typography.caption, { color: colors.textSecondary }]}>{redactedLabel}</Text>
    </View>
    {groups.filter(group => group.fields.length > 0).map(group => <View key={group.id} testID={`usage-detail-group-${group.id}`}
      style={[styles.group, group.id !== 'readings' && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.ui.semantic.chrome.border }]}>
      {group.label ? <Text accessibilityRole="header" style={[typography.label, { color: colors.textSecondary }]}>{group.label}</Text> : null}
      <View style={styles.fields}>
        {group.fields.map(field => <View key={field.id} testID={`usage-detail-cell-${field.id}`} style={[styles.cell, singleColumn && styles.singleCell]}>
          <DetailField field={field} prominent={group.id === 'readings'} />
        </View>)}
      </View>
    </View>)}
  </View>
}

function DetailField({ field, prominent = false, headline = false }: {
  field: RedactedUsageDetailField
  prominent?: boolean
  headline?: boolean
}) {
  const { colors } = useAppTheme()
  const typography = colors.design!.semantic.typography
  const valueColor = field.tone === 'success' ? colors.ui.tone.success.foreground
    : field.tone === 'warning' ? colors.ui.tone.warning.foreground
      : field.tone === 'danger' ? colors.ui.tone.danger.foreground : colors.text
  return <View testID={`usage-detail-field-${field.id}`} style={styles.field}>
    <Text style={[typography.caption, { color: colors.textSecondary }]}>{field.label}</Text>
    <Text selectable testID={`usage-detail-value-${field.id}`}
      style={[headline ? typography.headline : prominent ? typography.title : typography.body, prominent && styles.reading, { color: valueColor }]}>{field.value}</Text>
  </View>
}

const styles = StyleSheet.create({
  root: { minWidth: 0, gap: 14 },
  heading: { minWidth: 0, gap: 14 },
  statusLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 6 },
  statusDot: { width: 6, height: 6, borderRadius: 3, flexShrink: 0 },
  group: { minWidth: 0, gap: 12, paddingTop: 14 },
  fields: { minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 18 },
  cell: { minWidth: 0, flexBasis: '44%', flexGrow: 1 },
  singleCell: { flexBasis: '100%' },
  field: { minWidth: 0, gap: 5 },
  reading: { fontSize: 28, lineHeight: 34 },
})
