import type { ReactNode } from 'react'
import { ScrollView, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Text } from '@/components/ui/AppText'
import { IsleButton } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { WorkspaceSurface } from '@/presentation/layout/WorkspaceSurface'
import type { MessageCitation } from '@/types/contextContracts'

export function WebSourceSnapshot({ url, citation, nativeFailure, onOpenExternal, context }: {
  url?: string
  citation?: MessageCitation
  nativeFailure: boolean
  onOpenExternal?: () => Promise<void>
  context?: ReactNode
}) {
  const { t } = useTranslation()
  const { colors } = useAppTheme()
  const typography = colors.design!.semantic.typography
  return <ScrollView testID="web-source-snapshot" style={{ flex: 1, minHeight: 0 }}
    contentContainerStyle={{ padding: 12, paddingBottom: 32 }}>
    <WorkspaceSurface role="reading" style={{ gap: 20 }}>
      <View style={{ gap: 10 }}>
        <Text style={[typography.label, { color: colors.textSecondary }]}>{t('source.capturedCitation')}</Text>
        <Text selectable accessibilityRole="header" style={[typography.headline, { color: colors.text }]}>{citation?.title ?? (url ? new URL(url).hostname : t('source.source'))}</Text>
        {url ? <Text selectable style={[typography.caption, { color: colors.textSecondary }]}>{url}</Text> : null}
      </View>
      <Text selectable testID="web-source-captured-excerpt" style={[typography.body, { color: colors.text }]}>
        {citation?.excerpt || t('taskWorkspace.source.noExcerpt')}
      </Text>
      <WorkspaceSurface role="support" style={{ gap: 10 }}>
        <Text style={[typography.label, { color: colors.text }]}>{t('source.previewUnavailable')}</Text>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          {t(!url ? 'taskWorkspace.source.originalUnavailable' : nativeFailure ? 'source.previewUnavailableMessage' : 'source.previewUnsupportedWebMessage')}
        </Text>
        {url && onOpenExternal ? <IsleButton compact label={t('source.openInBrowser')} tone="primary" onPress={() => void onOpenExternal()} style={{ alignSelf: 'flex-start' }} /> : null}
      </WorkspaceSurface>
      {context}
    </WorkspaceSurface>
  </ScrollView>
}
