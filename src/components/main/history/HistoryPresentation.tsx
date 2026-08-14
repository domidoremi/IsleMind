import type { ReactNode } from 'react'
import { StyleSheet, Text, View, type ViewStyle } from 'react-native'
import type { ThemeId } from '@/types/settingsContracts'
import type { NavigationGlyph } from '@/components/navigation/AnimatedNavigationIcon'
import { IsleEmptyState } from '@/components/ui/isle'

export interface HistoryVisualTokens {
  text: string
  textSecondary: string
  textTertiary: string
  canvas: string
  surface: string
  surfaceMuted: string
  border: string
  borderStrong: string
  accent: string
  accentBackground: string
  accentBorder: string
  dangerBackground: string
  dangerForeground: string
  dangerBorder: string
}

export type HistoryEmptyStateKind = 'search-pending' | 'search-empty' | 'history-empty'

interface HistoryEmptyStateFrameProps {
  themeId: ThemeId
  tokens: HistoryVisualTokens
  kind: HistoryEmptyStateKind
  title: string
  description?: string
  actionLabel?: string
  actionGlyph?: NavigationGlyph
  actionBusy?: boolean
  actionDisabled?: boolean
  onAction?: () => void
}

/**
 * Empty history is a first-class page state rather than a shared card with a
 * different palette. The action contract remains the same, while each theme
 * gets its own visual reading order and editorial wrapper.
 */
export function HistoryEmptyStateFrame({
  themeId,
  tokens,
  kind,
  title,
  description,
  actionLabel,
  actionGlyph,
  actionBusy,
  actionDisabled,
  onAction,
}: HistoryEmptyStateFrameProps) {
  const empty = (
    <IsleEmptyState
      title={title}
      description={description}
      actionLabel={actionLabel}
      actionGlyph={actionGlyph}
      actionBusy={actionBusy}
      actionDisabled={actionDisabled}
      onAction={onAction}
      contextual
    />
  )

  if (themeId === 'lime-road') {
    return (
      <View testID={`history-empty-experience-lime-road-${kind}`} style={[styles.themeEmptySurface, styles.routeEmptySurface, { borderLeftColor: tokens.accent }]}>
        {empty}
      </View>
    )
  }

  if (themeId === 'markdown') {
    return (
      <View testID={`history-empty-experience-markdown-${kind}`} style={[styles.themeEmptySurface, styles.documentEmptySurface, { borderLeftColor: tokens.borderStrong }]}>
        {empty}
      </View>
    )
  }

  return <View testID={`history-empty-experience-minimal-${kind}`} style={styles.quietEmptyRoot}>{empty}</View>
}

interface HistoryHeaderFrameProps {
  themeId: ThemeId
  tokens: HistoryVisualTokens
  compact: boolean
  shellNavigation: boolean
  conversationCount: number
  sectionLabel: string
  documentPath: string
  header: ReactNode
  search: ReactNode
  summary: ReactNode
}

/**
 * History keeps one interaction surface but gives each theme an explicit
 * composition. The children remain the live header/search controls owned by
 * the screen, so focus, search announcements, and navigation stay unchanged.
 */
export function HistoryHeaderFrame({ themeId, tokens, compact, shellNavigation, conversationCount: _conversationCount, sectionLabel: _sectionLabel, documentPath: _documentPath, header, search, summary }: HistoryHeaderFrameProps) {
  switch (themeId) {
    case 'lime-road':
      return (
        <View testID="history-header-experience-lime-road" style={[styles.headerBase, { paddingHorizontal: compact ? 14 : 16, paddingTop: shellNavigation ? 8 : 12, paddingBottom: shellNavigation ? 10 : 14 }]}>
          <View style={[styles.routeHeaderFocus, { borderLeftColor: tokens.accent }]}>
            {header}
            <View style={styles.headerSearch}>{search}</View>
          </View>
          {summary}
        </View>
      )
    case 'markdown':
      return (
        <View testID="history-header-experience-markdown" style={[styles.headerBase, { paddingHorizontal: compact ? 14 : 16, paddingTop: shellNavigation ? 8 : 12, paddingBottom: shellNavigation ? 10 : 14 }]}>
          <View style={[styles.documentHeaderFocus, { borderBottomColor: tokens.border }]}>
            {header}
            <View style={styles.headerSearch}>{search}</View>
          </View>
          {summary}
        </View>
      )
    case 'minimal':
    default:
      return (
        <View testID="history-header-experience-minimal" style={[styles.headerBase, { paddingHorizontal: compact ? 14 : 16, paddingTop: shellNavigation ? 8 : 12, paddingBottom: shellNavigation ? 10 : 14 }]}>
          {header}
          <View style={styles.headerSearch}>{search}</View>
          {summary}
        </View>
      )
  }
}

interface HistoryRowFrameProps {
  themeId: ThemeId
  tokens: HistoryVisualTokens
  compact: boolean
  index: number
  active: boolean
  content: ReactNode
  actions: ReactNode
  expandedActions: ReactNode
  style?: ViewStyle
}

export function HistoryRowFrame({ themeId, tokens, compact, index: _index, active, content, actions, expandedActions, style }: HistoryRowFrameProps) {
  const compactStyle = compact ? styles.compactRow : undefined
  switch (themeId) {
    case 'lime-road':
      return (
        <View testID="history-row-experience-lime-road" style={[styles.rowBase, styles.routeRow, compactStyle, { backgroundColor: active ? tokens.surfaceMuted : 'transparent', borderBottomColor: tokens.border, borderLeftColor: active ? tokens.accent : 'transparent' }, style]}>
          <View style={styles.rowBody}>
            <View style={styles.rowMainLine}>
              {content}
              {actions}
            </View>
            {expandedActions}
          </View>
        </View>
      )
    case 'markdown':
      return (
        <View testID="history-row-experience-markdown" style={[styles.rowBase, styles.documentRow, compactStyle, { borderBottomColor: tokens.border }, style]}>
          <View style={styles.rowBody}>
            <View style={styles.rowMainLine}>
              {content}
              {actions}
            </View>
            {expandedActions}
          </View>
        </View>
      )
    case 'minimal':
    default:
      return (
        <View testID="history-row-experience-minimal" style={[styles.rowBase, styles.quietRow, compactStyle, { backgroundColor: active ? tokens.surfaceMuted : 'transparent', borderBottomColor: tokens.border }, style]}>
          <View style={styles.rowMainLine}>
            {content}
            {actions}
          </View>
          {expandedActions}
        </View>
      )
  }
}

interface HistoryRowContentProps {
  themeId: ThemeId
  tokens: HistoryVisualTokens
  title: string
  preview: string
  meta: string
  active: boolean
  activeLabel: string
  searchMatchSummary?: string
  searchMatchFieldLabel?: string
  statusLabel?: string
  statusColor?: string
}

export function HistoryRowContent({ themeId, tokens, title, preview, meta, active, activeLabel, searchMatchSummary, searchMatchFieldLabel, statusLabel, statusColor }: HistoryRowContentProps) {
  const searchMatchStyle = themeId === 'lime-road' ? styles.routeSearchMatch : themeId === 'markdown' ? styles.documentSearchMatch : styles.quietSearchMatch
  return (
    <>
      <Text numberOfLines={1} style={[styles.rowTitle, themeId === 'markdown' ? styles.documentRowTitle : undefined, { color: tokens.text, fontWeight: active ? '800' : '700' }]}>{title}</Text>
      {searchMatchSummary && searchMatchFieldLabel ? (
        <View style={searchMatchStyle}>
          <Text numberOfLines={1} style={[styles.searchMatchLabel, { color: tokens.accent }]}>{searchMatchFieldLabel}</Text>
          <Text numberOfLines={2} style={[styles.rowPreview, styles.searchMatchPreview, { color: tokens.textSecondary }]}>{searchMatchSummary}</Text>
        </View>
      ) : (
        <Text numberOfLines={themeId === 'markdown' ? 1 : 2} style={[styles.rowPreview, themeId === 'markdown' ? styles.documentPreview : undefined, { color: tokens.textSecondary }]}>{preview}</Text>
      )}
      <HistoryRowMetadata tokens={tokens} meta={meta} active={active} activeLabel={activeLabel} statusLabel={statusLabel} statusColor={statusColor} compact={themeId === 'markdown'} />
    </>
  )
}

function HistoryRowMetadata({ tokens, meta, active, activeLabel, statusLabel, statusColor, compact = false }: {
  tokens: HistoryVisualTokens
  meta: string
  active: boolean
  activeLabel: string
  statusLabel?: string
  statusColor?: string
  compact?: boolean
}) {
  return (
    <View style={[styles.rowMetadata, compact ? styles.documentMetadata : undefined]}>
      <Text numberOfLines={1} style={[styles.rowMetadataText, { color: tokens.textTertiary }]}>{meta}</Text>
      {active ? <Text numberOfLines={1} style={[styles.rowMetadataEmphasis, { color: tokens.accent }]}>{activeLabel}</Text> : null}
      {statusLabel ? <Text numberOfLines={1} style={[styles.rowMetadataEmphasis, { color: statusColor ?? tokens.textSecondary }]}>{statusLabel}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  headerBase: {
    width: '100%',
  },
  headerSearch: {
    marginTop: 8,
  },
  routeHeaderFocus: {
    paddingLeft: 10,
    borderLeftWidth: 3,
  },
  documentHeaderFocus: {
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  routeHeaderRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  routeMarker: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeMarkerText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    includeFontPadding: false,
  },
  routeHeaderContent: {
    flex: 1,
    minWidth: 0,
  },
  routeRule: {
    height: 2,
    width: 34,
    marginTop: 8,
    marginLeft: 44,
    opacity: 0.72,
  },
  routeSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  routeLabel: {
    width: 42,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '900',
    includeFontPadding: false,
  },
  routeSearch: {
    flex: 1,
    minWidth: 0,
  },
  documentBreadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingBottom: 8,
    marginBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  documentBreadcrumbText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    includeFontPadding: false,
  },
  documentBreadcrumbSlash: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '700',
    includeFontPadding: false,
  },
  documentSearchRule: {
    marginTop: 8,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowBase: {
    width: '100%',
    minHeight: 86,
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  compactRow: {
    paddingHorizontal: 2,
  },
  quietRow: {
    paddingVertical: 15,
  },
  routeRow: {
    minHeight: 88,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderLeftWidth: 3,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  documentRow: {
    minHeight: 78,
    paddingVertical: 11,
    paddingHorizontal: 2,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 4,
  },
  routeRail: {
    width: 34,
    alignItems: 'center',
    paddingTop: 2,
  },
  routeIndex: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '900',
    includeFontPadding: false,
  },
  routeRailLine: {
    width: 2,
    flex: 1,
    minHeight: 40,
    marginTop: 6,
    opacity: 0.56,
  },
  documentIndexRail: {
    width: 38,
    paddingTop: 2,
  },
  documentIndex: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    includeFontPadding: false,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowMainLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  rowTitle: {
    minWidth: 0,
    flexShrink: 1,
    fontSize: 15.5,
    lineHeight: 20,
    includeFontPadding: false,
  },
  documentRowTitle: {
    fontSize: 14.5,
  },
  rowPreview: {
    minWidth: 0,
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
    fontWeight: '500',
    includeFontPadding: false,
  },
  documentPreview: {
    marginTop: 3,
  },
  quietSearchMatch: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 6,
    minWidth: 0,
  },
  routeSearchMatch: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 6,
    minWidth: 0,
    paddingLeft: 8,
  },
  documentSearchMatch: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 4,
    minWidth: 0,
  },
  searchMatchLabel: {
    fontSize: 11,
    lineHeight: 17,
    fontWeight: '800',
    includeFontPadding: false,
  },
  searchMatchPreview: {
    flex: 1,
    marginTop: 0,
  },
  rowMetadata: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 7,
  },
  documentMetadata: {
    marginTop: 5,
  },
  rowMetadataText: {
    minWidth: 0,
    flexShrink: 1,
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '500',
    includeFontPadding: false,
  },
  rowMetadataEmphasis: {
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '800',
    includeFontPadding: false,
  },
  quietEmptyRoot: {
    flex: 1,
    width: '100%',
    minHeight: 260,
  },
  themeEmptySurface: {
    flex: 1,
    width: '100%',
    minHeight: 260,
  },
  routeEmptySurface: {
    borderLeftWidth: 3,
    paddingLeft: 8,
  },
  documentEmptySurface: {
    borderLeftWidth: 2,
    paddingLeft: 8,
  },
  routeEmptyRoot: {
    flex: 1,
    width: '100%',
    minHeight: 280,
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingHorizontal: 8,
  },
  routeEmptyRail: {
    width: 22,
    alignItems: 'center',
    borderRightWidth: StyleSheet.hairlineWidth,
    marginVertical: 24,
  },
  routeEmptyLine: {
    width: 2,
    flex: 1,
    maxHeight: 150,
    marginTop: 18,
    opacity: 0.54,
  },
  routeEmptyMarker: {
    position: 'absolute',
    top: 42,
    width: 11,
    height: 11,
    borderRadius: 6,
    borderWidth: 2,
  },
  routeEmptyBody: {
    flex: 1,
    minWidth: 0,
    paddingLeft: 12,
  },
  routeEmptyKicker: {
    marginTop: 28,
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  documentEmptyRoot: {
    flex: 1,
    width: '100%',
    minHeight: 280,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 2,
    overflow: 'hidden',
  },
  documentEmptyHeader: {
    minHeight: 30,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  documentEmptyPath: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
  },
  documentEmptyStatus: {
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
})
