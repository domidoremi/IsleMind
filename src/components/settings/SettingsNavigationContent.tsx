import { AnimatedNavigationTrigger } from '@/components/navigation/AnimatedNavigationTrigger'
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Keyboard, ScrollView, StyleSheet, View } from 'react-native'
import { Text } from '@/components/ui/AppText'
import { router, type Href } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { IsleButton, IsleMotionFrame, IslePressable, IsleSearchField } from '@/components/ui/isle'
import { AppIcon, type AppIconName } from '@/components/ui/AppIcon'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import { buildSettingsIndex, searchSettingsIndex, SETTINGS_DESTINATIONS, type SettingsCategory, type SettingsDestination } from '@/presentation/features/settings/settingsRegistry'
import { SettingsNavigationRow } from './SettingsNavigationRow'
import { useSettingsSearch } from './useSettingsSearch'
import { SettingsConnectionCard } from './SettingsConnectionCard'
import { SETTINGS_TASK_AREAS, useSettingsTaskNavigation, type SettingsTaskArea } from './settingsTaskNavigationState'
import { useWorkspaceLayout } from '@/presentation/layout/useWorkspaceLayout'
import { WorkspaceChoice } from '@/presentation/layout/WorkspaceChoice'

const icons: Record<SettingsCategory, AppIconName> = { models: 'bot', knowledge: 'network', tools: 'command', personalization: 'sun', privacy: 'shield', maintenance: 'settings-sliders' }
const entryIcons: Record<string, AppIconName> = { 'model-availability': 'model', generation: 'preferences-sliders', appearance: 'sun', interaction: 'toggle-on', identity: 'bot', mcp: 'mcp-network', skills: 'skills-sparkles', agents: 'reasoning', workflow: 'workflow', knowledge: 'knowledge', memory: 'memory-brain', context: 'search', usage: 'chart', data: 'layers', governance: 'shield', notifications: 'device', help: 'source', diagnostics: 'health', updates: 'download', danger: 'delete' }
const taskEntries: Record<SettingsTaskArea, readonly string[]> = {
  everyday: ['model-availability', 'preferences', 'appearance'],
  capabilities: ['mcp', 'skills', 'agents', 'knowledge', 'memory', 'context'],
  manage: ['usage', 'data', 'governance', 'notifications'],
  support: ['help', 'diagnostics', 'updates', 'danger'],
}
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
  const searching = Boolean(settled.trim())
  return <View style={{ flex: 1, minHeight: 0, gap: 12 }}>
    <View testID="settings-search-commands" style={{ gap: 8 }}>
      <IsleSearchField value={query} onChangeText={setQuery} placeholder={t('settings.search')} accessibilityLabel={t('settings.search')} clearAccessibilityLabel={t('common.clearSearch')} onClear={() => { setQuery(''); setSettled('') }} />
      {failure ? <View style={{ gap: 8 }}>
      <Text accessibilityRole="alert" style={{ color: colors.ui.tone.danger.foreground }}>{t(failure === 'load' ? 'settingsSubsystem.loadFailed' : 'settingsWorkspace.saveFailed')}</Text>
      <IsleButton compact label={t('common.retry')} onPress={retry} />
      </View> : null}
    </View>
    <View testID="settings-task-view" style={searching ? styles.hidden : styles.flex}
      accessibilityElementsHidden={searching} importantForAccessibility={searching ? 'no-hide-descendants' : 'auto'}>
      {children}
    </View>
    {searching ? <ScrollView testID="settings-search-results" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.searchResults}>
      <Text accessibilityLiveRegion="polite" style={[colors.design!.semantic.typography.caption, { color: colors.textSecondary }]}>
        {t(results.length ? 'taskWorkspace.settings.resultCount' : 'settings.controlSearchEmpty', { count: results.length })}
      </Text>
      {results.map(entry => <SettingsNavigationRow key={entry.id} id={`settings-result-${entry.id}`} title={entry.title}
        status={t(`settingsWorkspace.categories.${entry.category}`)} icon={entryIcons[entry.id] ?? icons[entry.category]}
        workspace last onPress={() => openSettingsDestination(entry)} />)}
    </ScrollView> : null}
  </View>
})

export const SettingsNavigationContent = memo(function SettingsNavigationContent({ category, shellNavigation = false, onHome }: { category?: SettingsCategory; shellNavigation?: boolean; onHome?: () => void }) {
  const { t } = useTranslation()
  const { colors, canonicalThemeId } = useAppTheme()
  const layout = useWorkspaceLayout()
  const { area, select } = useSettingsTaskNavigation()
  const scroll = useRef<ScrollView>(null)
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
  const entries = category ? SETTINGS_DESTINATIONS.filter(entry => entry.category === category && !entry.fieldOnly)
    : taskEntries[area].map(id => SETTINGS_DESTINATIONS.find(entry => entry.id === id)!)
  const tileGrid = layout.wide && !category && area === 'everyday'
  const row = (entry: SettingsDestination) => <SettingsNavigationRow key={entry.id} id={`settings-entry-${entry.id}`} last workspace
    tile={tileGrid}
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
  return <View testID="settings-workspace" style={[styles.workspace, { maxWidth: layout.maxWidth, paddingHorizontal: layout.gutter }]}>
      {!category ? <View style={styles.header}>{!shellNavigation ? <AnimatedNavigationTrigger variant="iconButton" label={t('common.backToChat')} size="md" glyph="back" onNavigate={onHome ?? (() => router.replace('/'))} color={colors.text} /> : null}
        <View style={{ flex: 1, gap: 2 }}>
          <Text accessibilityRole="header" style={[type.headline, { color: colors.text }, canonicalThemeId === 'minimal' ? { fontSize: 26, lineHeight: 34 } : undefined]}>{t('settings.title')}</Text>
        </View>
        <IslePressable accessibilityRole="button" accessibilityLabel={t('settingsWorkspace.manual')} onPress={() => openSettingsDestination(SETTINGS_DESTINATIONS.find(entry => entry.id === 'help')!)}
          style={[styles.manual, { borderRadius: colors.design!.semantic.radius.medium, backgroundColor: colors.ui.icon.accentBackground }]}>
          <AppIcon name="source" size={21} color={colors.ui.icon.accentForeground} />
        </IslePressable>
      </View> : null}
      <SettingsSearch>
        <View style={styles.flex}>
          {!category ? <View testID="settings-task-navigator" accessibilityRole="tablist" style={styles.taskNavigator}>
            {SETTINGS_TASK_AREAS.map(id => <WorkspaceChoice key={id} testID={`settings-task-${id}`}
              label={t(`settingsUx.groups.${id}`)} selected={area === id}
              onPress={() => {
                if (area === id) return
                select(id)
                scroll.current?.scrollTo({ y: 0, animated: false })
              }} />)}
          </View> : null}
          <ScrollView ref={scroll} testID="settings-task-scroll" keyboardShouldPersistTaps="handled"
            contentContainerStyle={[styles.taskCanvas, { paddingBottom: shellNavigation ? 96 : 40 }]}>
            <View style={[styles.taskLayout, { flexDirection: layout.wide && !category ? 'row' : 'column', gap: layout.gap }]}>
              {!category ? <View style={layout.wide ? { width: layout.sidebarWidth } : undefined}>
                <SettingsConnectionCard name={defaultProvider?.name} model={preferredModel} hasDefault={hasDefault}
                  hasConnections={hasConnections} onOpen={openConnections} />
              </View> : null}
              <View testID="settings-active-task" style={{ flex: 1, minWidth: 0, gap: 12 }}>
                <View style={styles.taskHeading}>
                  <Text testID={`settings-group-heading-${category ?? area}`} accessibilityRole="header"
                    style={[type.label, { color: colors.textSecondary }]}>
                    {t(category ? `settingsWorkspace.categories.${category}` : `settingsUx.groups.${area}`)}
                  </Text>
                  <Text style={[type.caption, { color: colors.textTertiary }]}>{t('settingsWorkspace.itemCount', { count: entries.length })}</Text>
                </View>
                <IsleMotionFrame role="section" testID={`settings-group-${category ?? area}`}>
                  <View testID="settings-task-items" style={[styles.taskItems, tileGrid ? styles.tileGrid : styles.taskList]}>
                    {entries.map(row)}
                  </View>
                </IsleMotionFrame>
              </View>
            </View>
          </ScrollView>
        </View>
      </SettingsSearch>
  </View>
})

const styles = StyleSheet.create({
  workspace: { flex: 1, minHeight: 0, minWidth: 0, width: '100%', alignSelf: 'center', paddingTop: 12, gap: 16 },
  flex: { flex: 1, minHeight: 0 },
  hidden: { display: 'none' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8 },
  manual: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  taskNavigator: { minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', gap: 4, paddingBottom: 12 },
  taskCanvas: { paddingTop: 8 },
  taskLayout: { minWidth: 0, alignItems: 'stretch' },
  taskHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  taskItems: { minWidth: 0, width: '100%', gap: 4 },
  taskList: { flexDirection: 'column', flexWrap: 'nowrap', alignItems: 'stretch' },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch' },
  searchResults: { gap: 8, paddingBottom: 40 },
})
