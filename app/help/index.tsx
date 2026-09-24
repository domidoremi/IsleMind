import { router } from 'expo-router'
import { GuideReader } from '@/components/settings/SettingsHelp'
export default function HelpScreen() {
  return <GuideReader onClose={() => router.canGoBack() ? router.back() : router.replace('/settings')} />
}
