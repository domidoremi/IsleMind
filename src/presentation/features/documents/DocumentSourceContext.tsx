import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { router } from 'expo-router'
import { Text } from '@/components/ui/AppText'
import { IsleButton } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import type { DocumentDraft } from '@/modules/documents'
import type { DocumentSourceTab } from './documentEditorViewState'

export function DocumentSourceContext({ draft, tab, busy, onRemoveReview }: {
  draft: DocumentDraft
  tab: DocumentSourceTab
  busy: boolean
  onRemoveReview: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useAppTheme()
  const typography = colors.design!.semantic.typography
  const origin = draft.origin
  const review = draft.reviewContext
  const body = { ...typography.body, color: colors.text }
  const secondary = { ...typography.caption, color: colors.textSecondary }

  if (tab === 'review' && review) return <View testID="document-review-context" style={{ gap: 14 }}>
    <Text accessibilityRole="header" style={[typography.title, { color: colors.text }]}>{t('documents.review.title')}</Text>
    <Text selectable style={secondary}>{t('documents.review.notice')}</Text>
    <Text selectable style={secondary}>{t('documents.review.acceptedAt', { time: new Date(review.acceptedAt).toLocaleString() })}</Text>
    <Text selectable style={secondary}>{t(draft.title === review.title && draft.body === review.body ? 'documents.review.matches' : 'documents.review.changed')}</Text>
    <Text selectable style={[typography.label, { color: colors.text }]}>{review.title}</Text>
    <Text selectable testID="document-review-body" style={body}>{review.body}</Text>
    {review.sources.map((source, index) => <View key={`${index}:${source.citationId}`} style={{ gap: 6 }}>
      <Text selectable style={[typography.label, { color: colors.text }]}>[S{index + 1}] {source.title} · {t(`source.${source.type}`)}</Text>
      <Text selectable style={secondary}>{t('documents.review.sourceVersion', { id: source.documentId ?? source.citationId, citation: source.citationId, time: new Date(source.updatedAt).toLocaleString() })}</Text>
      <Text selectable testID={`document-review-source-${index}`} style={body}>{source.text}</Text>
    </View>)}
    <IsleButton label={t('documents.review.remove')} disabled={busy} onPress={onRemoveReview} />
  </View>

  if (!origin) return null
  return <View testID="document-origin" style={{ gap: 14 }}>
    <Text accessibilityRole="header" style={[typography.title, { color: colors.text }]}>{t('documents.originTitle')}</Text>
    <Text selectable style={secondary}>{t('documents.originNotice')}</Text>
    <Text selectable style={body}>{origin.conversationTitle} · {new Date(origin.messageTimestamp).toLocaleString()}</Text>
    <Text selectable style={secondary}>{t(`documents.originStatus_${origin.messageStatus}`)}{origin.model ? ` · ${origin.model}` : ''}</Text>
    <Text selectable style={secondary}>{t(draft.body === origin.originalText ? 'documents.originUnchanged' : 'documents.originEdited')}</Text>
    <IsleButton label={t('documents.openChat')} onPress={() => router.push({ pathname: '/chat/[id]', params: { id: origin.conversationId } })} />
    <Text selectable style={body}>{origin.originalText}</Text>
    {origin.citations.map((citation, index) => <View key={`${index}:${citation.id}`} style={{ gap: 6 }}>
      <Text selectable style={[typography.label, { color: colors.text }]}>[{index + 1}] {citation.title} · {t(`source.${citation.type}`)}</Text>
      {citation.excerpt ? <Text selectable style={secondary}>{citation.excerpt}</Text> : null}
      {citation.url ? <Text selectable style={secondary}>{citation.url}</Text> : null}
    </View>)}
  </View>
}
