import { router, useLocalSearchParams } from 'expo-router'
import { GuideReader } from '@/components/settings/SettingsHelp'
export default function HelpChapterScreen() {
  const { slug, anchor } = useLocalSearchParams<{ slug: string; anchor?: string }>()
  return <GuideReader key={slug} initialSlug={slug} initialAnchor={anchor} onClose={() => router.canGoBack() ? router.back() : router.replace('/settings')} />
}
