import { SettingsNavigationContent } from '@/components/settings/SettingsNavigationContent'

export function SettingsScreenContent({ shellNavigation = false, onHome }: { shellNavigation?: boolean; onHome?: () => void } = {}) {
  return <SettingsNavigationContent shellNavigation={shellNavigation} onHome={onHome} />
}
