import { useCallback, useState, type ReactNode } from 'react'
import { ActivityIndicator, FlatList, Text, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { IsleButton, IsleChip, IsleSection } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import type { KnowledgeLocalSource, KnowledgeLocalSourceReader, KnowledgeLocalSourceReference } from '@/modules/knowledge'
import type { MessageCitation } from '@/types/contextContracts'

export interface CanonicalSourceReaderProps {
  conversationId: string
  messageId: string
  messageTimestamp: number
  citation: MessageCitation
  readLocalSource: KnowledgeLocalSourceReader['readLocalSource']
  header: ReactNode
}

type ReadState = { key: string } & (
  | { status: 'loading' | 'missing' | 'unlinked' | 'error' }
  | { status: 'ready'; source: KnowledgeLocalSource }
)

/** A disposable, scoped read projection; captured citation text is never rewritten. */
export function CanonicalSourceReader({ conversationId, messageId, messageTimestamp, citation, readLocalSource, header }: CanonicalSourceReaderProps) {
  const { colors } = useAppTheme()
  const { t, i18n } = useTranslation()
  const [refresh, setRefresh] = useState(0)
  const [state, setState] = useState<ReadState>()
  const [expandedKey, setExpandedKey] = useState<string>()
  const key = JSON.stringify([conversationId, messageId, citation.type, citation.id, citation.documentId, citation.chunkId, refresh])
  const current = state?.key === key ? state : undefined
  const documentId = citation.documentId
  const sourceId = citation.id
  const sourceType = citation.type

  useFocusEffect(useCallback(() => {
    const controller = new AbortController()
    const reference: KnowledgeLocalSourceReference | undefined = sourceType === 'knowledge' && documentId
      ? { type: 'knowledge', documentId }
      : sourceType === 'memory'
        ? { type: 'memory', memoryId: sourceId, conversationId }
        : undefined
    setState({ key, status: reference ? 'loading' : 'unlinked' })
    if (reference) void (async () => {
      try {
        const source = await readLocalSource(reference, { signal: controller.signal })
        if (!controller.signal.aborted) setState(source ? { key, status: 'ready', source } : { key, status: 'missing' })
      } catch {
        if (!controller.signal.aborted) setState({ key, status: 'error' })
      }
    })()
    return () => controller.abort()
  }, [conversationId, documentId, key, readLocalSource, sourceId, sourceType]))

  const source = current?.status === 'ready' ? current.source : undefined
  const document = source?.type === 'knowledge' ? source.document : undefined
  const memory = source?.type === 'memory' ? source.memory : undefined
  const chunks = source?.type === 'knowledge' ? source.chunks : []
  const citedChunk = citation.chunkId ? chunks.find((chunk) => chunk.id === citation.chunkId) : undefined
  const showAll = expandedKey === key || !citedChunk
  const updatedAt = document?.updatedAt ?? memory?.updatedAt
  const status = current?.status ?? 'loading'
  const textStyle = { color: colors.textSecondary, fontSize: 14, lineHeight: 22 }

  return (
    <FlatList
      testID="canonical-source-reader"
      data={showAll ? chunks : citedChunk ? [citedChunk] : []}
      keyExtractor={(chunk) => chunk.id}
      initialNumToRender={3}
      windowSize={5}
      contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 12, paddingBottom: 42, gap: 12 }}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          {header}
          <IsleSection title={t('source.currentSavedSource')} material="raised" elevated={false}>
            <Text style={textStyle}>{t('source.currentSavedSourceNotice')}</Text>
            {source && updatedAt !== undefined ? (
              <Text style={{ ...textStyle, marginTop: 8 }}>
                {t('source.savedUpdatedAt', { date: new Date(updatedAt).toLocaleString(i18n.language) })}
              </Text>
            ) : null}
            {updatedAt !== undefined && updatedAt > messageTimestamp ? (
              <Text accessibilityRole="alert" style={{ ...textStyle, marginTop: 8 }}>{t('source.updatedAfterResponse')}</Text>
            ) : null}
            {status === 'loading' ? <ActivityIndicator accessibilityLabel={t('source.loadingSavedSource')} style={{ marginTop: 12 }} /> : null}
            {status === 'missing' || status === 'unlinked' || status === 'error' ? (
              <Text accessibilityRole="alert" style={{ ...textStyle, marginTop: 12 }}>
                {t(status === 'missing' ? 'source.savedSourceMissing' : status === 'unlinked' ? 'source.savedSourceUnlinked' : 'source.savedSourceReadFailed')}
              </Text>
            ) : null}
            {document ? (
              <View style={{ gap: 8, marginTop: 12 }}>
                <Text style={{ ...textStyle, color: colors.text, fontWeight: '700' }}>{document.title}</Text>
                {document.status !== 'ready' ? <Text accessibilityRole="alert" style={textStyle}>{t('source.savedDocumentNotReady')}</Text> : null}
                {citation.chunkId && !citedChunk ? <Text accessibilityRole="alert" style={textStyle}>{t('source.citedSectionMissing')}</Text> : null}
                {!chunks.length ? <Text style={textStyle}>{t('source.noSavedText')}</Text> : null}
                {citedChunk && chunks.length > 1 ? (
                  <IsleButton
                    label={t(showAll ? 'source.showCitedSection' : 'source.showAllSavedSections', { count: chunks.length })}
                    onPress={() => setExpandedKey(showAll ? undefined : key)}
                  />
                ) : null}
              </View>
            ) : null}
            {memory ? (
              <View style={{ gap: 8, marginTop: 12 }}>
                <IsleChip>{t(`source.memoryStatus_${memory.status}`)}</IsleChip>
                <Text selectable style={textStyle}>{memory.content}</Text>
              </View>
            ) : null}
            {status !== 'unlinked' ? (
              <View style={{ marginTop: 12 }}>
                <IsleButton label={t('source.refreshSavedSource')} onPress={() => setRefresh((value) => value + 1)} />
              </View>
            ) : null}
          </IsleSection>
        </View>
      }
      renderItem={({ item }) => (
        <IsleSection
          title={t(item.id === citation.chunkId ? 'source.savedCitedSection' : 'source.savedSection', { index: (item.chunkIndex ?? item.ordinal) + 1 })}
          subtitle={item.headingPath?.join(' / ')}
          material="raised"
          elevated={false}
        >
          <Text selectable style={textStyle}>{item.content}</Text>
        </IsleSection>
      )}
    />
  )
}
