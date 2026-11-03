import type { ReactNode } from 'react'
import { ActivityIndicator, FlatList, View } from 'react-native'
import { Text } from '@/components/ui/AppText'
import { useTranslation } from 'react-i18next'
import { IsleButton, IsleChip } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import type { KnowledgeLocalSourceReader } from '@/modules/knowledge'
import type { MessageCitation } from '@/types/contextContracts'
import { WorkspaceSurface } from '@/presentation/layout/WorkspaceSurface'
import { useWorkspaceLayout } from '@/presentation/layout/useWorkspaceLayout'
import { useCanonicalSourceController } from './useCanonicalSourceController'

export interface CanonicalSourceReaderProps {
  conversationId: string
  messageId: string
  messageTimestamp: number
  citation: MessageCitation
  readLocalSource: KnowledgeLocalSourceReader['readLocalSource']
  header: ReactNode
}

/** A disposable, scoped read projection; captured citation text is never rewritten. */
export function CanonicalSourceReader({ conversationId, messageId, messageTimestamp, citation, readLocalSource, header }: CanonicalSourceReaderProps) {
  const { colors } = useAppTheme()
  const { t, i18n } = useTranslation()
  const layout = useWorkspaceLayout()
  const controller = useCanonicalSourceController({ conversationId, messageId, citation, readLocalSource })
  const { document, memory, chunks, citedChunk, showAll, updatedAt, status } = controller
  const typography = colors.design!.semantic.typography
  const textStyle = { ...typography.body, color: colors.text }
  const captionStyle = { ...typography.caption, color: colors.textSecondary }

  return (
    <WorkspaceSurface role="reading" testID="source-local-workspace" style={{ flex: 1, minHeight: 0, marginHorizontal: 12, marginTop: 12, marginBottom: 16, padding: 16, gap: 12 }}>
      <View testID="source-reader-commands" style={{ minWidth: 0, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <Text testID="source-reader-label" style={[typography.label, {
          color: colors.textSecondary, flexGrow: 1, flexBasis: layout.wide ? 'auto' : '100%',
        }]}>{t('source.currentSavedSource')}</Text>
        <View testID="source-reader-actions" style={{ minWidth: 0, maxWidth: '100%', flexShrink: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {citedChunk && chunks.length > 1 ? <IsleButton compact
            label={t(showAll ? 'source.showCitedSection' : 'source.showAllSavedSections', { count: chunks.length })}
            onPress={controller.toggleSections} /> : null}
          {status !== 'unlinked' ? <IsleButton compact label={t('source.refreshSavedSource')} onPress={controller.refreshSource} /> : null}
        </View>
      </View>
    <FlatList
      testID="canonical-source-reader"
      style={{ flex: 1, minWidth: 0, minHeight: 0 }}
      data={controller.visibleChunks}
      keyExtractor={(chunk) => chunk.id}
      initialNumToRender={3}
      windowSize={5}
      contentContainerStyle={{ paddingTop: 8, paddingBottom: 24, gap: 20 }}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          <Text selectable accessibilityRole="header" style={[typography.headline, { color: colors.text }]}>{document?.title ?? citation.title}</Text>
          <Text style={captionStyle}>{t('source.currentSavedSourceNotice')}</Text>
            {updatedAt !== undefined ? (
              <Text style={captionStyle}>
                {t('source.savedUpdatedAt', { date: new Date(updatedAt).toLocaleString(i18n.language) })}
              </Text>
            ) : null}
            {updatedAt !== undefined && updatedAt > messageTimestamp ? (
              <Text accessibilityRole="alert" style={captionStyle}>{t('source.updatedAfterResponse')}</Text>
            ) : null}
            {status === 'loading' ? <ActivityIndicator accessibilityLabel={t('source.loadingSavedSource')} style={{ marginTop: 12 }} /> : null}
            {status === 'missing' || status === 'unlinked' || status === 'error' ? (
              <Text accessibilityRole="alert" style={{ ...textStyle, marginTop: 12 }}>
                {t(status === 'missing' ? 'source.savedSourceMissing' : status === 'unlinked' ? 'source.savedSourceUnlinked' : 'source.savedSourceReadFailed')}
              </Text>
            ) : null}
            {document ? (
              <View style={{ gap: 8 }}>
                {document.status !== 'ready' ? <Text accessibilityRole="alert" style={textStyle}>{t('source.savedDocumentNotReady')}</Text> : null}
                {citation.chunkId && !citedChunk ? <Text accessibilityRole="alert" style={textStyle}>{t('source.citedSectionMissing')}</Text> : null}
                {!chunks.length ? <Text style={textStyle}>{t('source.noSavedText')}</Text> : null}
              </View>
            ) : null}
            {memory ? (
              <View style={{ gap: 8, marginTop: 12 }}>
                <IsleChip>{t(`source.memoryStatus_${memory.status}`)}</IsleChip>
                <Text selectable style={textStyle}>{memory.content}</Text>
              </View>
            ) : null}
        </View>
      }
      ListFooterComponent={<View testID="source-captured-context" style={{ paddingTop: 8 }}>{header}</View>}
      renderItem={({ item }) => (
        <View testID={`source-section-${item.id}`} style={{ gap: 10 }}>
          <Text accessibilityRole="header" style={[typography.label, { color: colors.textSecondary }]}>
            {t(item.id === citation.chunkId ? 'source.savedCitedSection' : 'source.savedSection', { index: (item.chunkIndex ?? item.ordinal) + 1 })}
          </Text>
          {item.headingPath?.length ? <Text style={captionStyle}>{item.headingPath.join(' / ')}</Text> : null}
          <Text selectable style={textStyle}>{item.content}</Text>
        </View>
      )}
    />
    </WorkspaceSurface>
  )
}
