import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { MotiView } from 'moti'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/ui/AppIcon'
import { ISLE_MIN_TOUCH_TARGET, IsleButton, IsleChip, IsleField, IsleListItem, IslePressable, IsleToggle, useIsleDialog } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { listMcpServers, refreshMcpManifest, saveMcpServers, upsertMcpServer } from '@/bootstrap/mcpCatalog'
import {
  listMcpRemotePresets,
  normalizeMcpServerUrl,
  type McpRemotePreset,
} from '@/modules/integrations'
import { createPluginManifestFromMcpServer, validatePluginManifest } from '@/services/pluginManifest'
import type { McpPromptManifest, McpResourceManifest, McpServerConfig, McpToolManifest } from '@/types/mcpContracts'
import {
  LimeRoadMcpSettingsExperience,
  MarkdownMcpSettingsExperience,
  MinimalMcpSettingsExperience,
} from '@/components/settings/theme-experiences/McpSettingsExperiences'

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000

function hostFromUrl(value: string): string {
  try {
    return new URL(value).host || value
  } catch {
    return value
  }
}

export function McpSettingsContent() {
  const { colors, themeId } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const { width } = useWindowDimensions()
  const compact = width < 430
  const actionCompact = width < 360
  const [servers, setServers] = useState<McpServerConfig[]>([])
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [managementOpen, setManagementOpen] = useState(false)
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null)
  const [pendingServerId, setPendingServerId] = useState<string | null>(null)
  const [presetsOpen, setPresetsOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [builtInOpen, setBuiltInOpen] = useState(false)
  const [installingPresetId, setInstallingPresetId] = useState<string | null>(null)
  const remotePresets = useMemo(() => listMcpRemotePresets(), [])
  const userServers = useMemo(() => servers.filter((server) => server.id !== 'islemind-builtins'), [servers])
  const installedPresetIds = useMemo(() => new Set(remotePresets.flatMap((preset) => (
    userServers.some((server) => normalizeMcpServerUrl(server) === preset.url) ? [preset.id] : []
  ))), [remotePresets, userServers])
  const builtInServer = servers.find((server) => server.id === 'islemind-builtins')
  const selectedServer = servers.find((server) => server.id === selectedServerId)
  const subtleBorderWidth = colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth
  const foldoutPanelStyle = {
    borderRadius: Math.min(colors.ui.radius.card, 8),
    padding: compact ? 10 : 11,
    backgroundColor: colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted,
    borderWidth: subtleBorderWidth,
    borderColor: colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border,
  } as const

  useEffect(() => {
    void refresh()
  }, [])

  async function refresh() {
    const nextServers = await listMcpServers()
    setServers(nextServers)
  }

  async function addServer() {
    const endpoint = normalizeMcpServerUrl({ id: '', url })
    if (!endpoint) {
      dialog.toast({ title: t('mcp.urlRequired'), tone: 'amber' })
      return
    }
    const now = Date.now()
    const server = await upsertMcpServer({
      id: `mcp-${now}-${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim() || hostFromUrl(endpoint),
      url: endpoint,
      transport: 'streamable-http',
      enabled: true,
      status: 'disconnected',
      manifestTtlMs: DEFAULT_TTL_MS,
      tools: [],
      resources: [],
      prompts: [],
      approvedToolNames: [],
      createdAt: now,
      updatedAt: now,
    })
    setName('')
    setUrl('')
    setAddOpen(false)
    await refresh()
    dialog.toast({ title: t('mcp.added'), message: server.name, tone: 'mint' })
  }

  async function installPreset(preset: McpRemotePreset) {
    if (installingPresetId || installedPresetIds.has(preset.id)) return
    setInstallingPresetId(preset.id)
    try {
      const now = Date.now()
      const server = await upsertMcpServer({
        id: `mcp-preset-${preset.id}`,
        name: preset.name,
        url: preset.url,
        transport: preset.transport,
        enabled: preset.enabledOnInstall,
        status: 'disconnected',
        manifestTtlMs: DEFAULT_TTL_MS,
        tools: [],
        resources: [],
        prompts: [],
        approvedToolNames: [],
        createdAt: now,
        updatedAt: now,
      })
      const connected = await refreshMcpManifest(server)
      await refresh()
      dialog.notice({
        title: connected.status === 'connected' ? t('mcp.presetConnected') : t('mcp.presetInstalled'),
        message: connected.status === 'connected'
          ? t('mcp.refreshSummary', { tools: connected.tools.length, resources: connected.resources.length, prompts: connected.prompts.length })
          : connected.lastError ?? t('mcp.presetRetry'),
        tone: connected.status === 'connected' ? 'mint' : 'amber',
      })
    } finally {
      setInstallingPresetId(null)
    }
  }

  async function refreshServer(server: McpServerConfig) {
    dialog.toast({ title: t('mcp.refreshing'), message: server.name, tone: 'mint' })
    const next = await refreshMcpManifest(server)
    await refresh()
    dialog.notice({
      title: next.status === 'connected' ? t('mcp.connected') : t('mcp.refreshFailed'),
      message: next.status === 'connected'
        ? t('mcp.refreshSummary', { tools: next.tools.length, resources: next.resources.length, prompts: next.prompts.length })
        : next.lastError ?? t('error.unknownError'),
      tone: next.status === 'connected' ? 'mint' : 'danger',
    })
  }

  async function toggleServer(server: McpServerConfig) {
    if (pendingServerId) return
    setPendingServerId(server.id)
    try {
      await upsertMcpServer({ ...server, enabled: !server.enabled, updatedAt: Date.now() })
      await refresh()
      dialog.toast({ title: server.enabled ? t('mcp.disabled') : t('mcp.enabled'), message: server.name, tone: server.enabled ? 'amber' : 'mint' })
    } finally {
      setPendingServerId(null)
    }
  }

  async function toggleTool(server: McpServerConfig, tool: McpToolManifest) {
    const tools = server.tools.map((item) => item.name === tool.name ? { ...item, enabled: !item.enabled } : item)
    const approvedToolNames = tools.filter((item) => item.enabled).map((item) => item.name)
    await upsertMcpServer({ ...server, tools, approvedToolNames, updatedAt: Date.now() })
    await refresh()
  }

  async function deleteServer(server: McpServerConfig) {
    const confirmed = await dialog.confirm({
      title: t('mcp.deleteTitle'),
      message: server.name,
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      tone: 'danger',
    })
    if (!confirmed) return
    await saveMcpServers(userServers.filter((item) => item.id !== server.id))
    await refresh()
    dialog.toast({ title: t('mcp.deleted'), message: server.name, tone: 'mint' })
  }

  const managementTrigger = (
        <IslePressable
          haptic
          accessibilityRole="button"
          accessibilityLabel={managementOpen ? t('dialog.close') : t('mcp.showDetails')}
          accessibilityState={{ expanded: managementOpen }}
          onPress={() => {
            setManagementOpen((current) => !current)
            setSelectedServerId(null)
          }}
          style={{ width: 44, height: 44, borderRadius: themeId === 'markdown' ? 4 : 8, alignItems: 'center', justifyContent: 'center', backgroundColor: themeId === 'minimal' ? 'transparent' : colors.ui.semantic.surface.muted, borderWidth: themeId === 'minimal' ? 0 : subtleBorderWidth, borderColor: colors.ui.semantic.chrome.border }}
        >
          <AppIcon name={managementOpen ? 'close' : 'settings'} color={colors.textSecondary} size={18} />
        </IslePressable>
  )
  const presetsSection = (
    <>
              <McpDisclosureRow
                title={t('mcp.presetsTitle')}
                detail={t('mcp.presetsCollapsedDetail', { installed: installedPresetIds.size, total: remotePresets.length })}
                icon={<AppIcon name="mcp-network" color={colors.textTertiary} size={16} />}
                open={presetsOpen}
                onPress={() => setPresetsOpen((value) => !value)}
              />
              {presetsOpen ? (
                <MotiView from={{ opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 144 }} style={foldoutPanelStyle}>
                  <McpFoldoutHeader title={t('mcp.presetsTitle')} description={t('mcp.presetsSubtitle')} />
                  <View style={{ gap: 8 }}>
                    {remotePresets.map((preset) => {
                      const installed = installedPresetIds.has(preset.id)
                      const installing = installingPresetId === preset.id
                      return (
                        <IsleListItem
                          key={preset.id}
                          title={preset.name}
                          description={[t(`mcp.presets.${preset.id}.useCase`), t(`mcp.presetSource.${preset.source}`), t(`mcp.presetAuthentication.${preset.authentication}`)].join(' · ')}
                          leading={<IsleChip active={installed}>{t(installed ? 'mcp.presetInstalledState' : 'mcp.presetAvailable')}</IsleChip>}
                          trailing={
                            <IsleButton
                              label={t(installed ? 'mcp.presetInstalledState' : installing ? 'mcp.presetInstalling' : 'mcp.installPreset')}
                              compact
                              disabled={installed || installingPresetId !== null}
                              icon={<AppIcon name={installed ? 'check' : 'add'} color={colors.textSecondary} size={14} />}
                              onPress={() => void installPreset(preset)}
                              style={actionCompact ? { alignSelf: 'stretch' } : undefined}
                            />
                          }
                        />
                      )
                    })}
                  </View>
                </MotiView>
              ) : null}

    </>
  )
  const addSection = (
    <>
      <McpDisclosureRow
        title={t('mcp.addServer')}
        detail={url.trim() ? hostFromUrl(url.trim()) : t('mcp.addServerCollapsedHint')}
        icon={<AppIcon name="network" color={colors.textTertiary} size={16} />}
        open={addOpen}
        onPress={() => setAddOpen((value) => !value)}
      />
      {addOpen ? (
        <MotiView from={{ opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 144 }} style={foldoutPanelStyle}>
          <McpFoldoutHeader title={t('mcp.addServer')} description={t('mcp.addServerSubtitle')} />
          <View style={{ gap: 10 }}>
            <IsleField label={t('mcp.name')} inputProps={{ value: name, onChangeText: setName, placeholder: 'Local tools' }} />
            <IsleField label={t('mcp.url')} inputProps={{ value: url, onChangeText: setUrl, placeholder: 'https://example.com/mcp', autoCapitalize: 'none', autoCorrect: false }} />
            <IsleButton label={t('mcp.add')} icon={<AppIcon name="add" color={colors.ui.control.primaryForeground} size={16} />} tone="primary" onPress={() => void addServer()} style={actionCompact ? { alignSelf: 'stretch' } : { alignSelf: 'flex-start', minWidth: 0 }} />
          </View>
        </MotiView>
      ) : null}
    </>
  )
  const builtInSection = builtInServer ? (
    <>
                  <McpDisclosureRow
                    title={t('mcp.builtIn')}
                    detail={t('mcp.builtInCollapsedDetail', { tools: builtInServer.tools.length, resources: builtInServer.resources.length, prompts: builtInServer.prompts.length })}
                    icon={<AppIcon name="tools" color={colors.textTertiary} size={16} />}
                    open={builtInOpen}
                    onPress={() => setBuiltInOpen((value) => !value)}
                  />
                  {builtInOpen ? (
                    <MotiView from={{ opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 144 }}>
                      <McpServerDetails server={builtInServer} readonly onRefresh={refreshServer} onToggleServer={toggleServer} onToggleTool={toggleTool} onDelete={deleteServer} />
                    </MotiView>
                  ) : null}
    </>
  ) : null
  const managementSections = themeId === 'markdown'
    ? <>{builtInSection}{addSection}{presetsSection}</>
    : themeId === 'minimal'
      ? <>{addSection}{presetsSection}{builtInSection}</>
      : <>{presetsSection}{addSection}{builtInSection}</>
  const management = (
    <MotiView from={{ opacity: 0, translateY: -5 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 144 }} style={{ gap: 10 }}>
      {selectedServer ? (
        <McpServerDetails server={selectedServer} onRefresh={refreshServer} onToggleServer={toggleServer} onToggleTool={toggleTool} onDelete={deleteServer} />
      ) : managementSections}
    </MotiView>
  )
  const Experience = themeId === 'lime-road'
    ? LimeRoadMcpSettingsExperience
    : themeId === 'markdown'
      ? MarkdownMcpSettingsExperience
      : MinimalMcpSettingsExperience
  return (
    <Experience
      managementOpen={managementOpen}
      managementTrigger={managementTrigger}
      management={management}
      servers={userServers}
      pendingServerId={pendingServerId}
      emptyState={<McpEmptyRow icon={<AppIcon name="mcp-network" color={colors.textTertiary} size={15} />} label={t('mcp.empty')} detail={t('mcp.emptyDetail')} />}
      compact={compact}
      onToggle={(server) => void toggleServer(server)}
      onOpenDetails={(serverId) => {
        setSelectedServerId(serverId)
        setManagementOpen(true)
      }}
    />
  )
}

function McpFoldoutHeader({ title, description }: { title: string; description?: string }) {
  const { colors } = useAppTheme()
  return (
    <View style={{ marginBottom: 10 }}>
      <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13, lineHeight: 17, fontWeight: '800', includeFontPadding: false }}>
        {title}
      </Text>
      {description ? (
        <Text numberOfLines={2} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 15, marginTop: 2, fontWeight: '700', includeFontPadding: false }}>
          {description}
        </Text>
      ) : null}
    </View>
  )
}

function McpEmptyRow({ icon, label, detail }: { icon: ReactNode; label: string; detail?: string }) {
  const { colors } = useAppTheme()
  const borderColor = colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.limeRoad ? colors.material.stroke : colors.ui.semantic.chrome.border
  return (
    <View style={{ minHeight: detail ? 60 : 44, borderRadius: Math.min(colors.ui.radius.card, 8), paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted, borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth, borderColor }}>
      {icon}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '800', includeFontPadding: false }}>
          {label}
        </Text>
        {detail ? (
          <Text numberOfLines={2} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 2, fontWeight: '700', includeFontPadding: false }}>
            {detail}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

function McpServerDetails({
  server,
  readonly = false,
  onRefresh,
  onToggleServer,
  onToggleTool,
  onDelete,
}: {
  server: McpServerConfig
  readonly?: boolean
  onRefresh: (server: McpServerConfig) => Promise<void>
  onToggleServer: (server: McpServerConfig) => Promise<void>
  onToggleTool: (server: McpServerConfig, tool: McpToolManifest) => Promise<void>
  onDelete: (server: McpServerConfig) => Promise<void>
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const { width } = useWindowDimensions()
  const compact = width < 430
  const actionCompact = width < 360
  const [toolsOpen, setToolsOpen] = useState(false)
  const [resourcesOpen, setResourcesOpen] = useState(false)
  const [promptsOpen, setPromptsOpen] = useState(false)
  const subtleBorderWidth = colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth
  const cardSurface = colors.ui.glass ? colors.ui.semantic.chrome.background : colors.ui.semantic.surface.base
  const cardBorder = colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.limeRoad ? colors.material.stroke : colors.ui.semantic.chrome.border
  const mutedSurface = colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted
  const resourceItems = server.resources.map((resource) => ({
    key: resource.uri,
    title: resource.name ?? resource.uri,
    description: formatResourceDescription(resource),
  }))
  const pluginManifest = createPluginManifestFromMcpServer(server)
  const pluginValidation = validatePluginManifest(pluginManifest)
  const pluginPermission = pluginManifest.mcp[0]?.permission ?? pluginManifest.permissions[0] ?? 'read-only'
  const pluginCapabilities = pluginManifest.requiredCapabilities.length ? pluginManifest.requiredCapabilities.join(', ') : t('common.none')
  const pluginPreview = t('mcp.pluginManifestPreview', {
    state: t(`mcp.pluginManifestReviewState.${pluginManifest.review.state}`),
    permission: pluginPermission,
    capabilities: pluginCapabilities,
    errors: pluginValidation.errors.length,
    warnings: pluginValidation.warnings.length,
  })
  const promptItems = server.prompts.map((prompt) => ({
    key: prompt.name,
    title: prompt.name,
    description: formatPromptDescription(prompt, t),
  }))
  const actionButtonStyle = actionCompact ? { alignSelf: 'stretch' as const } : { flexGrow: 1, flexShrink: 1, flexBasis: '47%' as const, minWidth: 0 }
  const actions = (
    <View style={{ flexDirection: actionCompact ? 'column' : 'row', flexWrap: actionCompact ? 'nowrap' : 'wrap', gap: 8, justifyContent: 'flex-end', alignItems: actionCompact ? 'stretch' : 'center' }}>
      {!readonly ? <IsleButton label={server.enabled ? t('settings.enabledState') : t('settings.disabledState')} compact tone={server.enabled ? 'mint' : 'soft'} onPress={() => void onToggleServer(server)} style={actionButtonStyle} /> : null}
      <IsleButton label={t('settings.sync')} compact icon={<AppIcon name="refresh" color={colors.textSecondary} size={14} />} onPress={() => void onRefresh(server)} style={actionButtonStyle} />
      {!readonly ? <IsleButton label={t('common.delete')} compact tone="danger" icon={<AppIcon name="delete" color={colors.ui.control.dangerForeground} size={14} />} onPress={() => void onDelete(server)} style={actionButtonStyle} /> : null}
    </View>
  )
  return (
    <View
      style={{
        borderRadius: Math.min(colors.ui.radius.panel, 8),
        padding: 9,
        gap: 9,
        backgroundColor: cardSurface,
        borderWidth: subtleBorderWidth,
        borderColor: cardBorder,
        shadowColor: colors.ui.control.shadow,
        shadowOpacity: 0,
        shadowRadius: 0,
        shadowOffset: { width: 0, height: 0 },
        elevation: 0,
      }}
    >
      <IsleListItem
        title={server.name}
        description={[server.url, t('mcp.refreshSummary', { tools: server.tools.length, resources: server.resources.length, prompts: server.prompts.length })].join('\n')}
        leading={<IsleChip active={server.status === 'connected'}>{t(`mcp.status.${server.status}`)}</IsleChip>}
      />
      {actions}
      <View style={{ gap: 8 }}>
          <View style={{ borderRadius: Math.min(colors.ui.radius.controlMiddle, 8), padding: 8, gap: 4, backgroundColor: mutedSurface, borderWidth: subtleBorderWidth, borderColor: pluginValidation.ok ? cardBorder : colors.ui.tone.warning.border }}>
            <Text style={{ color: colors.textSecondary, fontSize: 10, lineHeight: 13, fontWeight: '700', includeFontPadding: false }}>{t('mcp.pluginManifest')}</Text>
            <Text style={{ color: pluginValidation.ok ? colors.textTertiary : colors.ui.tone.warning.foreground, fontSize: 11, lineHeight: 16, fontWeight: '800', includeFontPadding: false }}>{pluginPreview}</Text>
          </View>
          <McpDisclosureRow
            title={t('mcp.toolsTitle', { count: server.tools.length })}
            detail={t('mcp.toolsCollapsedDetail', { approved: server.tools.filter((tool) => tool.enabled).length, total: server.tools.length })}
            icon={<AppIcon name="shield" color={colors.textTertiary} size={16} />}
            open={toolsOpen}
            onPress={() => setToolsOpen((value) => !value)}
          />
          {toolsOpen ? (
            <MotiView from={{ opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 144 }} style={{ gap: 8 }}>
              {server.tools.map((tool) => (
                <IsleToggle
                  key={tool.name}
                  title={tool.name}
                  description={tool.description ?? t('mcp.noDescription')}
                  active={tool.enabled}
                  icon={<AppIcon name="shield" color={colors.text} size={18} />}
                  onPress={() => readonly ? undefined : void onToggleTool(server, tool)}
                />
              ))}
              {!server.tools.length ? <McpEmptyRow icon={<AppIcon name="shield" color={colors.textTertiary} size={15} />} label={t('mcp.noTools')} /> : null}
            </MotiView>
          ) : null}
          <McpDisclosureRow
            title={t('mcp.resourcesTitle', { count: server.resources.length })}
            detail={t('mcp.resourcesCollapsedDetail', { count: server.resources.length })}
            icon={<AppIcon name="knowledge-database" color={colors.textTertiary} size={16} />}
            open={resourcesOpen}
            onPress={() => setResourcesOpen((value) => !value)}
          />
          {resourcesOpen ? (
            <MotiView from={{ opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 144 }} style={{ gap: 8 }}>
              {resourceItems.map((resource) => (
                <IsleListItem
                  key={resource.key}
                  title={resource.title}
                  description={resource.description}
                  leading={<IsleChip>{t('mcp.resourceChip')}</IsleChip>}
                />
              ))}
              {!resourceItems.length ? <McpEmptyRow icon={<AppIcon name="knowledge-database" color={colors.textTertiary} size={15} />} label={t('mcp.noResources')} /> : null}
            </MotiView>
          ) : null}
          <McpDisclosureRow
            title={t('mcp.promptsTitle', { count: server.prompts.length })}
            detail={t('mcp.promptsCollapsedDetail', { count: server.prompts.length })}
            icon={<AppIcon name="message" color={colors.textTertiary} size={16} />}
            open={promptsOpen}
            onPress={() => setPromptsOpen((value) => !value)}
          />
          {promptsOpen ? (
            <MotiView from={{ opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 144 }} style={{ gap: 8 }}>
              {promptItems.map((prompt) => (
                <IsleListItem
                  key={prompt.key}
                  title={prompt.title}
                  description={prompt.description}
                  leading={<IsleChip>{t('mcp.promptChip')}</IsleChip>}
                />
              ))}
              {!promptItems.length ? <McpEmptyRow icon={<AppIcon name="message" color={colors.textTertiary} size={15} />} label={t('mcp.noPrompts')} /> : null}
            </MotiView>
          ) : null}
      </View>
    </View>
  )
}

function McpDisclosureRow({ title, detail, icon, open, onPress }: { title: string; detail: string; icon: ReactNode; open: boolean; onPress: () => void }) {
  const { colors } = useAppTheme()
  return (
    <IslePressable
      haptic
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      style={{ minHeight: ISLE_MIN_TOUCH_TARGET, borderRadius: Math.min(colors.ui.radius.controlLarge, 8), paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted, borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth, borderColor: colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border }}
    >
      {icon}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 17, fontWeight: '800' }}>{title}</Text>
        <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 15, marginTop: 1 }}>{detail}</Text>
      </View>
      <MotiView animate={{ rotate: open ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: 160 }}>
        <AppIcon name="collapse" color={colors.textTertiary} size={16} />
      </MotiView>
    </IslePressable>
  )
}

function formatResourceDescription(resource: McpResourceManifest): string | undefined {
  const parts = [resource.description, resource.mimeType, resource.uri].filter(Boolean)
  return parts.length ? parts.join(' · ') : undefined
}

function formatPromptDescription(prompt: McpPromptManifest, t: (key: string, options?: Record<string, unknown>) => string): string | undefined {
  const argumentNames = (prompt.arguments ?? [])
    .map((argument) => (argument && typeof argument.name === 'string' ? argument.name : ''))
    .filter(Boolean)
  const argumentSummary = argumentNames.length
    ? `${t('mcp.promptArguments', { count: argumentNames.length })}: ${argumentNames.slice(0, 4).join(', ')}${argumentNames.length > 4 ? '…' : ''}`
    : undefined
  const parts = [prompt.description, argumentSummary].filter(Boolean)
  return parts.length ? parts.join(' · ') : undefined
}
