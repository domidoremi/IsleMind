import { AnimatedNavigationTrigger } from '@/components/navigation/AnimatedNavigationTrigger'
import * as Application from 'expo-application'
import Constants from 'expo-constants'
import { memo, useEffect, useMemo, useState } from 'react'
import { Keyboard, ScrollView, Text, View } from 'react-native'
import { router, type Href } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { IslePressable, IsleSearchField } from '@/components/ui/isle'
import { AppIcon, type AppIconName } from '@/components/ui/AppIcon'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import { buildSettingsIndex, searchSettingsIndex, SETTINGS_CATEGORIES, SETTINGS_DESTINATIONS, type SettingsCategory, type SettingsDestination } from '@/presentation/features/settings/settingsRegistry'

const icons: Record<SettingsCategory, AppIconName> = { models: 'bot', knowledge: 'network', tools: 'command', personalization: 'sun', privacy: 'shield', maintenance: 'settings-sliders' }
let locationSequence = 0
export function openSettingsDestination(entry: SettingsDestination) {
  Keyboard.dismiss()
  router.push({ pathname: entry.route, params: { ...(entry.section ? { section: entry.section, locate: String(++locationSequence) } : {}), returnTo: 'settings' } } as Href)
}
function NavigationRow({ title, status, icon, onPress, id }: { title: string; status?: string; icon: AppIconName; onPress: () => void; id: string }) {
  const { colors } = useAppTheme()
  return <IslePressable testID={id} accessibilityRole="button" accessibilityLabel={[title, status].filter(Boolean).join(', ')} onPress={onPress} style={{ minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16, borderRadius: colors.ui.radius.card, backgroundColor: colors.ui.semantic.surface.base, borderWidth: 1, borderColor: colors.ui.semantic.chrome.border }}>
    <AppIcon name={icon} color={colors.primary} size={24} />
    <View style={{ flex: 1, gap: 5 }}><Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>{title}</Text>{status ? <Text style={{ fontSize: 14, lineHeight: 21, color: colors.textSecondary }}>{status}</Text> : null}</View>
    <AppIcon name="arrow-right" size={18} color={colors.textSecondary} />
  </IslePressable>
}

/** Query state is deliberately outside the settings/store subscriber. */
const SettingsSearch = memo(function SettingsSearch() {
  const { t, i18n } = useTranslation()
  const { colors } = useAppTheme()
  const [query, setQuery] = useState('')
  const [settled, setSettled] = useState('')
  useEffect(() => { const timer = setTimeout(() => setSettled(query), 120); return () => clearTimeout(timer) }, [query])
  const index = useMemo(() => buildSettingsIndex(key => t(key)), [t, i18n.language])
  const results = useMemo(() => searchSettingsIndex(index, settled), [index, settled])
  return <View style={{ gap: 10 }}>
    <IsleSearchField value={query} onChangeText={setQuery} placeholder={t('settings.search')} accessibilityLabel={t('settings.search')} clearAccessibilityLabel={t('common.clearSearch')} onClear={() => { setQuery(''); setSettled('') }} />
    {settled.trim() ? <View testID="settings-search-results" style={{ gap: 8 }}>
      {!results.length ? <Text accessibilityLiveRegion="polite" style={{ fontSize: 14, color: colors.textSecondary }}>{t('settings.controlSearchEmpty')}</Text> : results.map(entry => <NavigationRow key={entry.id} id={`settings-result-${entry.id}`} title={entry.title} status={t(`settingsWorkspace.categories.${entry.category}`)} icon={icons[entry.category]} onPress={() => openSettingsDestination(entry)} />)}
    </View> : null}
  </View>
})

export const SettingsNavigationContent = memo(function SettingsNavigationContent({ category, shellNavigation = false, onHome }: { category?: SettingsCategory; shellNavigation?: boolean; onHome?: () => void }) {
  const { t } = useTranslation()
  const { colors, canonicalThemeId } = useAppTheme()
  const providerCount = useSettingsStore(state => state.providers.length)
  const hasDefault = useSettingsStore(state => state.providers.some(provider => provider.enabled && provider.id === state.settings.defaultProvider))
  const language = useSettingsStore(state => state.settings.language)
  const ragMode = useSettingsStore(state => state.settings.ragMode ?? 'hybrid')
  const enabledTools = useSettingsStore(state => Number(state.settings.skillsEnabled ?? true) + Number(state.settings.mcpEnabled ?? true))
  const accessRules = useSettingsStore(state => (state.settings.providerAllowlist?.length ?? 0) + (state.settings.providerBlocklist?.length ?? 0) + (state.settings.modelAllowlist?.length ?? 0) + (state.settings.modelBlocklist?.length ?? 0))
  const statuses: Record<SettingsCategory, string> = {
    models: t('settingsWorkspace.providerCount', { count: providerCount }),
    knowledge: t(ragMode === 'off' ? 'contextPanel.ragOff' : ragMode === 'fts' ? 'contextPanel.ragFts' : 'contextPanel.ragHybrid'),
    tools: t('settingsWorkspace.enabledTools', { count: enabledTools }),
    personalization: t(`settingsWorkspace.themes.${canonicalThemeId}`) + ' · ' + language,
    privacy: t('settingsWorkspace.accessRules', { count: accessRules }),
    maintenance: 'v' + (Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '—'),
  }
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: shellNavigation ? 96 : 40 }}>
    <View style={{ width: '100%', maxWidth: 860, alignSelf: 'center', gap: 14 }}>
      {!category ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>{!shellNavigation ? <AnimatedNavigationTrigger variant="iconButton" label={t('common.backToChat')} size="md" glyph="back" onNavigate={onHome ?? (() => router.replace('/'))} color={colors.text} /> : null}<Text accessibilityRole="header" style={{ fontSize: 28, fontWeight: '800', color: colors.text }}>{t('settings.title')}</Text></View> : null}
      <SettingsSearch />
      {!category && !hasDefault ? <NavigationRow id="settings-action-provider" icon="provider-key" title={t('settingsWorkspace.needsAttention')} status={t('settings.noDefault')} onPress={() => openSettingsDestination(SETTINGS_DESTINATIONS[0])} /> : null}
      {category ? SETTINGS_DESTINATIONS.filter(entry => entry.category === category && !entry.fieldOnly).map(entry => <NavigationRow key={entry.id} id={`settings-entry-${entry.id}`} title={t(entry.titleKey)} icon={icons[category]} onPress={() => openSettingsDestination(entry)} />) : SETTINGS_CATEGORIES.map(item => <NavigationRow key={item} id={`settings-category-${item}`} title={t(`settingsWorkspace.categories.${item}`)} status={statuses[item]} icon={icons[item]} onPress={() => router.push(`/settings/category/${item}` as Href)} />)}
    </View>
  </ScrollView>
})
