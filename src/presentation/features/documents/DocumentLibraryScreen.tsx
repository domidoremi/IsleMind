import { useCallback, useState } from 'react'
import { router, useFocusEffect } from 'expo-router'
import { ScrollView, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { IsleButton, IslePressable, IsleSearchField } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import type { DocumentRepository, DocumentSummary } from '@/modules/documents'
import { ThemeDetailFrame } from '@/presentation/app-shell/ThemeDetailFrame'

export default function DocumentLibraryScreen({ repository }: { repository: DocumentRepository }) {
  const { t } = useTranslation()
  const { colors } = useAppTheme()
  const [documents, setDocuments] = useState<DocumentSummary[]>([])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  useFocusEffect(useCallback(() => {
    const controller = new AbortController()
    setStatus('loading')
    void repository.list({ signal: controller.signal }).then((rows) => {
      if (!controller.signal.aborted) { setDocuments(rows); setStatus('ready') }
    }).catch(() => { if (!controller.signal.aborted) setStatus('error') })
    return () => controller.abort()
  }, [repository, attempt]))
  const visible = documents.filter((document) => document.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))

  return <ThemeDetailFrame kind="documents" title={t('documents.title')} backLabel={t('common.back')}
    onBack={() => router.canGoBack() ? router.back() : router.replace('/conversations')}
    actions={<IsleButton label={t('documents.new')} compact onPress={() => router.push('/documents/edit')} />}>
    <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 20, gap: 16, width: '100%', maxWidth: 880, alignSelf: 'center', paddingBottom: 40 }}>
      <Text selectable style={{ color: colors.textSecondary }}>{t('documents.libraryNotice')}</Text>
      <IsleSearchField value={query} onChangeText={setQuery} onClear={() => setQuery('')} clearAccessibilityLabel={t('common.clearSearch')} placeholder={t('documents.search')} accessibilityLabel={t('documents.search')} />
      {status === 'loading' ? <Text accessibilityLiveRegion="polite" style={{ color: colors.textSecondary }}>{t('common.loading')}</Text> : null}
      {status === 'error' ? <View style={{ gap: 12 }}>
        <Text selectable accessibilityRole="alert" style={{ color: colors.text }}>{t('documents.loadFailed')}</Text>
        <IsleButton label={t('common.retry')} onPress={() => setAttempt((value) => value + 1)} />
      </View> : null}
      {status === 'ready' && !visible.length ? <Text selectable style={{ color: colors.textSecondary }}>{t(query.trim() ? 'documents.noMatches' : 'documents.empty')}</Text> : null}
      {status === 'ready' ? visible.map((document) => <IslePressable key={document.id} accessibilityRole="button" accessibilityLabel={document.title}
        onPress={() => router.push({ pathname: '/documents/edit', params: { id: document.id } })}
        style={{ paddingVertical: 18, gap: 6, borderBottomWidth: 1, borderBottomColor: colors.ui.semantic.chrome.border }}>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>{document.title}</Text>
        <Text style={{ color: colors.textSecondary }}>{t('documents.updated', { time: new Date(document.updatedAt).toLocaleString() })}</Text>
      </IslePressable>) : null}
    </ScrollView>
  </ThemeDetailFrame>
}
