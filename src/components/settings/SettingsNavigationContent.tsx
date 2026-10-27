import { AnimatedNavigationTrigger } from '@/components/navigation/AnimatedNavigationTrigger'
import { memo, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Keyboard, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { Text } from '@/components/ui/AppText'
import { router, type Href } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { IsleButton, IslePressable, IsleSearchField } from '@/components/ui/isle'
import { GlassSurface } from '@/components/ui/isle/GlassSurface'
import { glassShadowStyle } from '@/components/ui/isle/glassShadowStyle'
import { AppIcon, type AppIconName } from '@/components/ui/AppIcon'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import { buildSettingsIndex, searchSettingsIndex, SETTINGS_DESTINATIONS, type SettingsCategory, type SettingsDestination } from '@/presentation/features/settings/settingsRegistry'
import { SettingsNavigationRow } from './SettingsNavigationRow'
import { useSettingsSearch } from './useSettingsSearch'

const icons: Record<SettingsCategory, AppIconName> = { models: 'bot', knowledge: 'network', tools: 'command', personalization: 'sun', privacy: 'shield', maintenance: 'settings-sliders' }
const entryIcons: Record<string, AppIconName> = { 'model-availability': 'model', generation: 'preferences-sliders', appearance: 'sun', interaction: 'toggle-on', identity: 'bot', mcp: 'mcp-network', skills: 'skills-sparkles', agents: 'reasoning', workflow: 'workflow', knowledge: 'knowledge', memory: 'memory-brain', context: 'search', usage: 'chart', data: 'layers', governance: 'shield', notifications: 'device', help: 'source', diagnostics: 'health', updates: 'download', danger: 'delete' }
let locationSequence = 0
export function openSettingsDestination(entry: SettingsDestination) {
  Keyboard.dismiss()
  router.push({ pathname: entry.route, params: { ...(entry.section ? { section: entry.section, locate: String(++locationSequence) } : {}), returnTo: 'settings' } } as Href)
}
/** Search persistence is isolated from execution settings/store subscribers. */
const SettingsSearch = memo(function SettingsSearch({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation()
  const { colors } = useAppTheme()
  const { query, setQuery, failure, retry } = useSettingsSearch()
  const [settled, setSettled] = useState(query)
  useEffect(() => { const timer = setTimeout(() => setSettled(query), 120); return () => clearTimeout(timer) }, [query])
  const index = useMemo(() => buildSettingsIndex(key => t(key)), [t, i18n.language])
  const results = useMemo(() => searchSettingsIndex(index, settled), [index, settled])
  return <View style={{ gap: 24 }}>
    <IsleSearchField value={query} onChangeText={setQuery} placeholder={t('settings.search')} accessibilityLabel={t('settings.search')} clearAccessibilityLabel={t('common.clearSearch')} onClear={() => { setQuery(''); setSettled('') }} />
    {failure ? <View style={{ gap: 8 }}>
      <Text accessibilityRole="alert" style={{ color: colors.ui.tone.danger.foreground }}>{t(failure === 'load' ? 'settingsSubsystem.loadFailed' : 'settingsWorkspace.saveFailed')}</Text>
      <IsleButton compact label={t('common.retry')} onPress={retry} />
    </View> : null}
    {settled.trim() ? <SettingsListSurface testID="settings-search-results">
      {!results.length ? <Text accessibilityLiveRegion="polite" style={{ padding: 18, fontSize: 14, color: colors.textSecondary }}>{t('settings.controlSearchEmpty')}</Text> : results.map((entry, index) => <SettingsNavigationRow key={entry.id} id={`settings-result-${entry.id}`} title={entry.title} status={t(`settingsWorkspace.categories.${entry.category}`)} icon={entryIcons[entry.id] ?? icons[entry.category]} last={index === results.length - 1} onPress={() => openSettingsDestination(entry)} />)}
    </SettingsListSurface> : children}
  </View>
})

/** Shared destinations, different composition: a ledger, editorial flow, or a bounded control group. */
function SettingsListSurface({ children, testID, tiles = false }: { children: ReactNode; testID?: string; tiles?: boolean }) {
  const { colors, canonicalThemeId } = useAppTheme()
  const open = canonicalThemeId === 'minimal' || canonicalThemeId === 'monet'
  const journal = canonicalThemeId === 'animal-island-ui'
  const glass = canonicalThemeId === 'liquid-glass'
  return <View testID={testID} style={{ padding: open || tiles ? 0 : 4, paddingLeft: journal ? 12 : undefined,
    borderRadius: open || tiles ? 0 : journal ? 4 : glass ? 28 : 20,
    backgroundColor: open || tiles ? 'transparent' : glass ? colors.ui.semantic.chrome.background : colors.ui.semantic.surface.raised,
    borderTopWidth: open ? StyleSheet.hairlineWidth : 0, borderTopColor: colors.ui.section.divider,
    borderLeftWidth: journal ? 3 : 0, borderLeftColor: colors.ui.icon.accentForeground,
    flexDirection: tiles ? 'row' : 'column', flexWrap: tiles ? 'wrap' : 'nowrap', gap: tiles ? 8 : 0,
    ...(glass ? glassShadowStyle(colors, 'control') : null),
  }}>{children}</View>
}

function ConnectionEntry({ label, name, model, action, hasConnections, onPress }: {
  label: string; name: string; model?: string; action: string; hasConnections: boolean; onPress: () => void
}) {
  const { colors, canonicalThemeId, design } = useAppTheme()
  const type = design?.semantic.typography ?? colors.design!.semantic.typography
  const minimal = canonicalThemeId === 'minimal'
  const editorial = canonicalThemeId === 'monet'
  const material = canonicalThemeId === 'material'
  const glass = canonicalThemeId === 'liquid-glass'
  const journal = canonicalThemeId === 'animal-island-ui'
  const foreground = material ? colors.design!.semantic.color.onPrimaryContainer : colors.text
  const content = <IslePressable testID="settings-entry-providers" accessibilityRole="button" accessibilityLabel={[label, name, model].filter(Boolean).join(', ')}
    onPress={onPress} style={{ padding: minimal ? 4 : editorial ? 0 : 22, paddingVertical: minimal ? 16 : 22,
      borderRadius: material ? 28 : journal ? 4 : glass ? 32 : 0,
      borderTopWidth: minimal ? 1 : 0, borderBottomWidth: minimal || editorial ? 1 : journal ? 2 : 0,
      borderColor: minimal || editorial ? colors.ui.section.divider : colors.ui.icon.accentForeground,
      backgroundColor: material ? colors.design!.semantic.color.primaryContainer : journal ? colors.ui.semantic.surface.raised : 'transparent', gap: minimal ? 10 : 18 }}>
    <View style={{ flexDirection: glass ? 'column' : 'row', alignItems: glass ? 'center' : 'flex-start', gap: 16 }}>
      {!editorial ? <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: minimal ? 28 : 48, height: minimal ? 32 : 48,
        borderRadius: glass ? 24 : journal ? 6 : material ? 16 : 0, borderWidth: journal ? 1 : 0, borderColor: colors.ui.section.divider,
        backgroundColor: material || glass ? colors.ui.semantic.surface.raised : 'transparent', alignItems: 'center', justifyContent: 'center',
        ...(glass ? glassShadowStyle(colors, 'control') : null) }}><AppIcon name={hasConnections ? 'model' : 'add'} size={minimal ? 22 : 26} color={colors.ui.icon.accentForeground} /></View> : null}
      <View style={{ flex: glass ? undefined : 1, minWidth: 0, maxWidth: '100%', alignItems: glass ? 'center' : 'stretch', gap: editorial ? 8 : 4 }}>
        <Text style={{ ...type.caption, color: foreground }}>{label}</Text>
        <Text style={{ ...type.headline, ...(minimal ? { fontSize: 18, lineHeight: 26 } : null), color: foreground, textAlign: glass ? 'center' : 'left' }}>{name}</Text>
        {model ? <Text style={{ ...type.caption, color: foreground, textAlign: glass ? 'center' : 'left' }}>{model}</Text> : null}
      </View>
    </View>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: minimal ? 44 : 0,
      paddingTop: material || journal ? 14 : 0, borderTopWidth: material || journal ? StyleSheet.hairlineWidth : 0, borderTopColor: colors.ui.section.divider }}>
      {!minimal && !editorial ? <AppIcon name={hasConnections ? 'settings-sliders' : 'paste'} size={16} color={foreground} /> : null}
      <Text style={{ ...type.label, flex: 1, color: foreground }}>{action}</Text>
      <AppIcon name="arrow-right" size={editorial ? 24 : 18} color={foreground} />
    </View>
  </IslePressable>
  return glass ? <GlassSurface colors={colors} variant="floating" borderRadius={32}>{content}</GlassSurface> : content
}

export const SettingsNavigationContent = memo(function SettingsNavigationContent({ category, shellNavigation = false, onHome }: { category?: SettingsCategory; shellNavigation?: boolean; onHome?: () => void }) {
  const { t } = useTranslation()
  const { colors, canonicalThemeId } = useAppTheme()
  const { width, fontScale } = useWindowDimensions()
  const wide = width / fontScale >= 900
  const minimal = canonicalThemeId === 'minimal'
  const editorial = canonicalThemeId === 'monet'
  const material = canonicalThemeId === 'material'
  const journal = canonicalThemeId === 'animal-island-ui'
  const glass = canonicalThemeId === 'liquid-glass'
  // At large text sizes the same destinations return to a readable single column.
  const everydayTiles = material && width / fontScale >= 350
  const type = colors.design!.semantic.typography
  const providerCount = useSettingsStore(state => state.providers.length)
  const defaultProvider = useSettingsStore(state => state.providers.find(provider => provider.enabled && provider.id === state.settings.defaultProvider))
  const preferred = useSettingsStore(state => state.settings.lastPreferredModel)
  const preferredModel = defaultProvider && preferred?.providerId === defaultProvider.id ? preferred.model : undefined
  const hasDefault = Boolean(defaultProvider)
  const hasConnections = providerCount > 0
  const language = useSettingsStore(state => state.settings.language)
  const summaries: Record<string, string | undefined> = {
    providers: providerCount ? t('settingsWorkspace.providerCount', { count: providerCount }) : undefined,
    'model-availability': preferredModel,
    appearance: t(`settingsWorkspace.themes.${canonicalThemeId}`) + ' · ' + ({ 'zh-CN': '简体中文', en: 'English', ja: '日本語' }[language] ?? language),
  }
  const groups = [
    { id: 'everyday', entries: ['model-availability', 'preferences', 'appearance'] },
    { id: 'capabilities', entries: ['mcp', 'skills', 'agents', 'knowledge', 'memory', 'context'] },
    { id: 'manage', entries: ['usage', 'data', 'governance', 'notifications'] },
    { id: 'support', entries: ['help', 'diagnostics', 'updates', 'danger'] },
  ]
  const row = (entry: SettingsDestination, index: number, entries: SettingsDestination[], tile = false) => <SettingsNavigationRow key={entry.id} id={`settings-entry-${entry.id}`} last={index === entries.length - 1} tile={tile}
    title={t(entry.id === 'providers' && !hasConnections ? 'settingsUx.addConnection' : entry.titleKey)}
    status={summaries[entry.id]} icon={entryIcons[entry.id] ?? icons[entry.category]}
    preview={entry.id === 'appearance' ? <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', gap: 3 }}>
      {[colors.ui.icon.accentForeground, colors.ui.section.divider, colors.ui.semantic.surface.muted].map((color, index) => <View key={index} style={{ width: 7, height: 20, borderRadius: 4, backgroundColor: color }} />)}
    </View> : undefined}
    onPress={() => entry.id === 'providers' && !hasConnections
      ? router.push({ pathname: '/settings/providers', params: { setup: 'add', returnTo: 'settings' } })
      : openSettingsDestination(entry)} />
  const openConnections = () => hasConnections ? openSettingsDestination(SETTINGS_DESTINATIONS.find(entry => entry.id === 'providers')!)
    : router.push({ pathname: '/settings/providers', params: { setup: 'add', returnTo: 'settings' } })
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: wide ? 32 : editorial ? 24 : 18, paddingTop: wide ? 28 : editorial ? 24 : 12, paddingBottom: shellNavigation ? 96 : 40 }}>
    <View style={{ width: '100%', maxWidth: editorial ? 880 : 1000, alignSelf: 'center', gap: minimal ? 16 : editorial ? 32 : 22 }}>
      {!category ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: editorial ? 16 : 8,
        borderBottomWidth: journal ? 2 : 0, borderBottomColor: colors.ui.section.divider }}>{!shellNavigation ? <AnimatedNavigationTrigger variant="iconButton" label={t('common.backToChat')} size="md" glyph="back" onNavigate={onHome ?? (() => router.replace('/'))} color={colors.text} /> : null}
        <View style={{ flex: 1, gap: editorial ? 8 : 2, alignItems: editorial ? 'center' : 'flex-start' }}>
          <Text style={{ ...type.caption, letterSpacing: editorial ? 4 : 2, color: colors.textSecondary }}>ISLEMIND</Text>
          <Text accessibilityRole="header" style={{ ...type.display, ...(minimal ? { fontSize: 26, lineHeight: 34 } : null), color: colors.text }}>{t('settings.title')}</Text>
        </View>
        <IslePressable accessibilityRole="button" accessibilityLabel={t('settingsWorkspace.manual')} onPress={() => openSettingsDestination(SETTINGS_DESTINATIONS.find(entry => entry.id === 'help')!)}
          style={{ minWidth: 44, minHeight: 44, borderRadius: glass ? 22 : journal ? 6 : material ? 16 : 0,
            backgroundColor: material || glass ? colors.ui.icon.accentBackground : 'transparent', alignItems: 'center', justifyContent: 'center' }}><AppIcon name="source" size={21} color={colors.ui.icon.accentForeground} /></IslePressable>
      </View> : null}
      <SettingsSearch>
      {category ? <SettingsListSurface>{SETTINGS_DESTINATIONS.filter(entry => entry.category === category && !entry.fieldOnly).map(row)}</SettingsListSurface>
        : <View style={{ gap: editorial ? 40 : minimal ? 24 : 28 }}>
          <ConnectionEntry label={t(hasDefault ? 'settingsUx.design.currentConnection' : 'settingsWorkspace.categories.models')}
            name={defaultProvider?.name ?? t(hasConnections ? 'settings.providers' : 'settingsUx.addConnection')} model={preferredModel}
            action={t(hasConnections ? 'settingsUx.design.manageConnections' : 'settingsUx.design.pasteConfiguration')}
            hasConnections={hasConnections} onPress={openConnections} />
          <View testID="settings-groups" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: editorial ? 40 : wide ? 28 : 24 }}>
            {groups.map((group, groupIndex) => <View key={group.id} style={{ width: wide ? '47%' : '100%', flexGrow: wide ? 1 : 0, gap: editorial ? 16 : 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: minimal || editorial ? 0 : 6 }}>
                {editorial || journal ? <Text accessible={false} importantForAccessibility="no" style={{ ...type.title, color: colors.textTertiary }}>{String(groupIndex + 1).padStart(2, '0')}</Text> : null}
                <Text accessibilityRole="header" style={{ ...(editorial || journal ? type.title : type.label), color: editorial || journal ? colors.text : colors.textSecondary }}>{t(`settingsUx.groups.${group.id}`)}</Text>
              </View>
              <SettingsListSurface testID={`settings-group-${group.id}`} tiles={everydayTiles && group.id === 'everyday'}>
                {group.entries.map(id => SETTINGS_DESTINATIONS.find(entry => entry.id === id)!).map((entry, index, entries) => row(entry, index, entries, everydayTiles && group.id === 'everyday'))}
              </SettingsListSurface>
            </View>)}
          </View>
        </View>}
      </SettingsSearch>
    </View>
  </ScrollView>
})
