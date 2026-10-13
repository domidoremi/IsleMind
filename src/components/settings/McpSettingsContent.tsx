import { SettingsTaskWorkspace } from './SettingsTaskWorkspace'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { useSettingsStore } from '@/store/settingsStore'
import { useRef } from 'react'
import { SettingsSection, useSettingsTarget } from './SettingsSection'
import { useSettingsDraft } from './SettingsEditBoundary'
import { SettingsHelpButton } from './SettingsHelp'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { Text } from '@/components/ui/AppText'
import { MotiView } from 'moti'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/ui/AppIcon'
import { userFacingErrorDetail } from '@/core'
import { ISLE_MIN_TOUCH_TARGET, IsleButton, IsleChip, IsleField, IsleListItem, IslePressable, IsleToggle, useIsleDialog } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { listMcpServers, refreshMcpManifest, saveMcpServers, upsertMcpServer } from '@/bootstrap/mcpCatalog'
import {
  listMcpRemotePresets,
  normalizeMcpServerUrl,
  type McpRemotePreset,
} from '@/modules/integrations'
import { createPluginManifestFromMcpServer, validatePluginManifest } from '@/bootstrap/pluginManifest'
import type { McpPromptManifest, McpResourceManifest, McpServerConfig, McpToolManifest } from '@/types/mcpContracts'
import {
  LiquidGlassMcpSettingsExperience,
  MaterialMcpSettingsExperience,
  MinimalMcpSettingsExperience,
  MonetMcpSettingsExperience,
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
  const { colors, canonicalThemeId } = useAppTheme()
  const motion = useMotionPreference()
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const { width, fontScale } = useWindowDimensions()
  const compact = width / fontScale < 430
  const actionCompact = width < 360
  const enabled = useSettingsStore(state => state.settings.mcpEnabled ?? true)
  const updateSettings = useSettingsStore(state => state.updateSettings)
  const [servers, setServers] = useState<McpServerConfig[]>([])
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [operationError, setOperationError] = useState<string>()
  const [editingServer, setEditingServer] = useState<McpServerConfig | null>(null)
  const operationLock = useRef(false)
  const saveLock = useRef(false)
  const draftServerId = useRef<string | null>(null)
  const target = useSettingsTarget()
  const [url, setUrl] = useState('')
  const [managementOpen, setManagementOpen] = useState(false)
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null)
  const [pendingServerId, setPendingServerId] = useState<string | null>(null)
  const [presetsOpen, setPresetsOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [activeTask, setActiveTask] = useState<string | null>(null)
  const [builtInOpen, setBuiltInOpen] = useState(false)
  const [installingPresetId, setInstallingPresetId] = useState<string | null>(null)
  const discardDraft = () => { draftServerId.current = null; setEditingServer(null); setName(''); setUrl(''); setAddOpen(false); setActiveTask(null) }
  useSettingsDraft(false, installingPresetId !== null || pendingServerId !== null, () => undefined)
  const requestCloseDraft = useSettingsDraft(editingServer ? name !== editingServer.name || url !== editingServer.url : Boolean(name || url), saving, discardDraft)
  useEffect(() => { if (target === 'mcp-add') { setManagementOpen(true); setAddOpen(true); setActiveTask('mcp-add') } }, [target])
  const remotePresets = useMemo(() => listMcpRemotePresets(), [])
  const userServers = useMemo(() => servers.filter((server) => server.id !== 'islemind-builtins'), [servers])
  const installedPresetIds = useMemo(() => new Set(remotePresets.flatMap((preset) => (
    userServers.some((server) => normalizeMcpServerUrl(server) === preset.url) ? [preset.id] : []
  ))), [remotePresets, userServers])
  const builtInServer = servers.find((server) => server.id === 'islemind-builtins')
  const selectedServer = servers.find((server) => server.id === selectedServerId)
  const subtleBorderWidth = colors.ui.monet ? 1 : StyleSheet.hairlineWidth
  const foldoutPanelStyle = {
    borderRadius: Math.min(colors.ui.radius.card, 8),
    padding: compact ? 10 : 11,
    backgroundColor: colors.ui.liquidGlass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted,
    borderWidth: subtleBorderWidth,
    borderColor: colors.ui.liquidGlass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border,
  } as const

  useEffect(() => {
    void refresh()
  }, [])

  async function refresh() {
    try {
      const nextServers = await listMcpServers()
      setServers(nextServers)
      setLoaded(true)
      setLoadFailed(false)
    } catch { setLoadFailed(true) }
  }

  async function addServer() {
    const endpoint = normalizeMcpServerUrl({ id: '', url })
    if (!endpoint) {
      dialog.toast({ title: t('mcp.urlRequired'), tone: 'amber' })
      return
    }
    if (saveLock.current) return
    saveLock.current = true
    setSaving(true)
    setOperationError(undefined)
    try {
    const now = Date.now()
    draftServerId.current ??= `mcp-${now}-${Math.random().toString(36).slice(2, 8)}`
    const endpointChanged = editingServer && normalizeMcpServerUrl(editingServer) !== endpoint
    const server = await upsertMcpServer({
      id: draftServerId.current,
      transport: 'streamable-http',
      enabled: true,
      status: 'disconnected',
      manifestTtlMs: DEFAULT_TTL_MS,
      tools: [],
      resources: [],
      prompts: [],
      approvedToolNames: [],
      createdAt: now,
      ...editingServer,
      name: name.trim() || hostFromUrl(endpoint),
      url: endpoint,
      ...(endpointChanged ? { status: 'disconnected' as const, tools: [], resources: [], prompts: [], approvedToolNames: [], manifestCachedAt: undefined, manifestExpiresAt: undefined, lastError: undefined } : {}),
      updatedAt: now,
    })
    discardDraft()
    setSelectedServerId(server.id)
    setServers(current => [...current.filter(item => item.id !== server.id), server])
    dialog.toast({ title: t(editingServer ? 'settingsWorkspace.saved' : 'mcp.added'), message: endpointChanged ? t('settingsSubsystem.configurationChanged') : server.name, tone: 'mint' })
    } catch {
      setOperationError('settingsWorkspace.saveFailed')
      dialog.toast({ title: t('settingsWorkspace.saveFailed'), tone: 'danger' })
    } finally { saveLock.current = false; setSaving(false) }
  }

  async function installPreset(preset: McpRemotePreset) {
    if (operationLock.current || installedPresetIds.has(preset.id)) return
    operationLock.current = true
    setInstallingPresetId(preset.id)
    setOperationError(undefined)
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
      // Installing records configuration only. Connection is a separate explicit action.
      setServers(current => [...current.filter(item => item.id !== server.id), server])
      await refresh()
      setActiveTask(null)
      setSelectedServerId(server.id)
      dialog.toast({ title: t('mcp.presetInstalled'), message: t('settingsSubsystem.savedNotVerified'), tone: 'mint' })
    } catch {
      setOperationError('settingsWorkspace.saveFailed')
      dialog.toast({ title: t('settingsWorkspace.saveFailed'), tone: 'danger' })
    } finally {
      operationLock.current = false
      setInstallingPresetId(null)
    }
  }

  async function refreshServer(server: McpServerConfig) {
    if (operationLock.current) return
    operationLock.current = true
    setPendingServerId(server.id)
    setOperationError(undefined)
    try {
    dialog.toast({ title: t('mcp.refreshing'), message: server.name, tone: 'mint' })
    const next = await refreshMcpManifest(server)
    setServers(current => current.map(item => item.id === next.id ? next : item))
    await refresh()
    dialog.notice({
      title: next.status === 'connected' ? t('mcp.connected') : t('mcp.refreshFailed'),
      message: next.status === 'connected'
        ? t('mcp.refreshSummary', { tools: next.tools.length, resources: next.resources.length, prompts: next.prompts.length })
        : userFacingErrorDetail(next.lastError) || t('error.unknownError'),
      tone: next.status === 'connected' ? 'mint' : 'danger',
    })
    } catch { setOperationError('mcp.refreshFailed'); dialog.toast({ title: t('mcp.refreshFailed'), tone: 'danger' }) }
    finally { operationLock.current = false; setPendingServerId(null) }
  }

  async function toggleServer(server: McpServerConfig) {
    if (operationLock.current) return
    operationLock.current = true
    setPendingServerId(server.id)
    setOperationError(undefined)
    try {
      await upsertMcpServer({ ...server, enabled: !server.enabled, updatedAt: Date.now() })
      await refresh()
      dialog.toast({ title: server.enabled ? t('mcp.disabled') : t('mcp.enabled'), message: server.name, tone: server.enabled ? 'amber' : 'mint' })
    } catch { setOperationError('settingsWorkspace.saveFailed'); dialog.toast({ title: t('settingsWorkspace.saveFailed'), tone: 'danger' }) } finally {
      operationLock.current = false
      setPendingServerId(null)
    }
  }

  async function toggleTool(server: McpServerConfig, tool: McpToolManifest) {
    if (operationLock.current) return
    operationLock.current = true
    setPendingServerId(server.id)
    setOperationError(undefined)
    try {
    const enabled = !(tool.enabled && server.approvedToolNames.includes(tool.name))
    const tools = server.tools.map((item) => item.name === tool.name ? { ...item, enabled } : item)
    // Legacy/imported enabled flags are not approval. Change only the chosen tool.
    const approvedToolNames = new Set(server.approvedToolNames)
    if (enabled) approvedToolNames.add(tool.name)
    else approvedToolNames.delete(tool.name)
    await upsertMcpServer({ ...server, tools, approvedToolNames: [...approvedToolNames], updatedAt: Date.now() })
    await refresh()
    } catch { setOperationError('settingsWorkspace.saveFailed'); dialog.toast({ title: t('settingsWorkspace.saveFailed'), tone: 'danger' }) }
    finally { operationLock.current = false; setPendingServerId(null) }
  }

  async function deleteServer(server: McpServerConfig) {
    const confirmed = await dialog.confirm({
      title: t('mcp.deleteTitle'),
      message: server.name,
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      tone: 'danger',
    })
    if (!confirmed || operationLock.current) return
    operationLock.current = true
    setPendingServerId(server.id)
    setOperationError(undefined)
    try {
      const current = await listMcpServers()
      await saveMcpServers(current.filter(item => item.id !== server.id && item.id !== 'islemind-builtins'))
      await refresh()
      setSelectedServerId(null)
      dialog.toast({ title: t('mcp.deleted'), message: server.name, tone: 'mint' })
    } catch { setOperationError('settingsWorkspace.saveFailed'); dialog.toast({ title: t('settingsWorkspace.saveFailed'), tone: 'danger' }) }
    finally { operationLock.current = false; setPendingServerId(null) }
  }

  return <View style={{ gap: 12 }}>
    {operationError ? <Text accessibilityRole="alert" style={{ color: colors.ui.tone.danger.foreground }}>{t(operationError)}</Text> : null}
    {loadFailed ? <View style={{ gap: 8 }}><Text accessibilityRole="alert" style={{ color: colors.ui.tone.danger.foreground }}>{t('settingsSubsystem.loadFailed')}</Text><IsleButton label={t('common.retry')} disabled={saving || pendingServerId !== null || installingPresetId !== null} onPress={() => void refresh()} /></View> : null}
    {!enabled ? <Text style={{ color: colors.ui.tone.warning.foreground }}>{t('settingsSubsystem.paused')}</Text> : null}
    {!activeTask && !selectedServer ? <IsleToggle title={t('settings.mcp')} active={enabled} onPress={() => updateSettings({ mcpEnabled: !enabled })} /> : null}
    {!activeTask && !selectedServer ? <>
      {!loadFailed ? <Text accessibilityLiveRegion="polite" style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 22 }}>{!loaded ? t('common.loading') : t('settingsSubsystem.remoteSummary', { enabled: userServers.filter(server => server.enabled).length, disabled: userServers.filter(server => !server.enabled).length })}</Text> : null}
      <View style={{ marginTop: 20, gap: 8 }}>
      <Text accessibilityRole="header" style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '700' }}>{t('settingsUx.configuredTools')}</Text>
      {userServers.map(server => <IslePressable key={server.id} accessibilityRole="button" accessibilityLabel={server.name} onPress={() => setSelectedServerId(server.id)}
        style={{ minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 0.5, borderBottomColor: colors.ui.section.divider }}>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}><Text style={{ color: colors.text, fontSize: 16 }}>{server.name}</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{t(server.enabled ? 'settings.enabled' : 'settings.disabled')} · {t('settingsSubsystem.lastConnection', { status: t(`mcp.status.${server.status}`) })}</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{t('settingsSubsystem.approvedTools', { count: server.tools.filter(tool => tool.enabled && server.approvedToolNames.includes(tool.name)).length, total: server.tools.length })}</Text></View>
        <AppIcon name="back-next" color={colors.textSecondary} size={18} />
      </IslePressable>)}
      {loaded && !userServers.length ? <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 22 }}>{t('settingsUx.noRemoteTools')}</Text> : null}
    </View>
    </> : null}
    {selectedServer ? <>
      <IsleButton label={t('settingsUx.allOptions')} onPress={() => void requestCloseDraft(() => setSelectedServerId(null))} />
      <IsleButton label={t('settingsSubsystem.configuration')} disabled={pendingServerId !== null} onPress={() => { setEditingServer(selectedServer); draftServerId.current = selectedServer.id; setName(selectedServer.name); setUrl(selectedServer.url); setSelectedServerId(null); setActiveTask('mcp-add') }} />
      <McpServerDetails key={selectedServer.id} busy={pendingServerId !== null} server={selectedServer} onRefresh={refreshServer} onToggleServer={toggleServer} onToggleTool={toggleTool} onDelete={deleteServer} />
    </> : <SettingsTaskWorkspace value={activeTask} onTaskChange={id => { if (id !== 'mcp-add' && editingServer) discardDraft(); setActiveTask(id ?? null) }} tasks={[
      { id: 'mcp-add', title: t(editingServer ? 'settingsSubsystem.configuration' : 'mcp.addServer'), description: t('settingsUx.mcpAddHint'), icon: 'add', content: <SettingsSection id="mcp-add"><View style={{ gap: 10 }}>
          <View style={{ gap: 10 }}>
            <IsleField label={t('mcp.name')} inputProps={{ editable: !saving, value: name, onChangeText: setName, placeholder: 'Local tools' }} />
            <IsleField label={t('mcp.url')} inputProps={{ editable: !saving, value: url, onChangeText: setUrl, placeholder: 'https://example.com/mcp', keyboardType: 'url', autoCapitalize: 'none', autoCorrect: false }} />
            <IsleButton label={t(saving ? 'settingsWorkspace.saving' : 'settingsWorkspace.save')} disabled={saving} icon={<AppIcon name="add" color={colors.ui.control.primaryForeground} size={16} />} tone="primary" onPress={() => void addServer()} style={actionCompact ? { alignSelf: 'stretch' } : { alignSelf: 'flex-start', minWidth: 0 }} />
            <IsleButton label={t('settingsWorkspace.cancel')} disabled={saving} onPress={() => void requestCloseDraft(() => undefined)} />
          </View>
        </View></SettingsSection> },
      { id: 'mcp-presets', title: t('mcp.presetsTitle'), description: t('mcp.presetsSubtitle'), icon: 'mcp-network', content: <MotiView from={motion === 'full' ? { opacity: 0, translateY: -6 } : undefined} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: motion === 'full' ? 144 : 0 }} style={foldoutPanelStyle}>
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
                </MotiView> },
      ...(builtInServer ? [{ id: 'mcp-builtins', title: t('mcp.builtIn'), description: t('settingsUx.builtinsHint'), icon: 'tools' as const, content: <McpServerDetails server={builtInServer} busy={pendingServerId !== null} readonly onRefresh={refreshServer} onToggleServer={toggleServer} onToggleTool={toggleTool} onDelete={deleteServer} /> }] : []),
    ]} />}
  </View>
}

function McpFoldoutHeader({ title, description }: { title: string; description?: string }) {
  const { colors } = useAppTheme()
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '800', includeFontPadding: false }}>
        {title}
      </Text>
      {description ? (
        <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, marginTop: 2, fontWeight: '700', includeFontPadding: false }}>
          {description}
        </Text>
      ) : null}
    </View>
  )
}

function McpEmptyRow({ icon, label, detail }: { icon: ReactNode; label: string; detail?: string }) {
  const { colors } = useAppTheme()
  const borderColor = colors.ui.liquidGlass ? colors.ui.actionBar.itemBorder : colors.ui.monet ? colors.material.stroke : colors.ui.semantic.chrome.border
  return (
    <View style={{ minHeight: detail ? 60 : 44, borderRadius: Math.min(colors.ui.radius.card, 8), paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.ui.liquidGlass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted, borderWidth: colors.ui.monet ? 1 : StyleSheet.hairlineWidth, borderColor }}>
      {icon}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: '800', includeFontPadding: false }}>
          {label}
        </Text>
        {detail ? (
          <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, marginTop: 2, fontWeight: '700', includeFontPadding: false }}>
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
  busy = false,
  onRefresh,
  onToggleServer,
  onToggleTool,
  onDelete,
}: {
  server: McpServerConfig
  readonly?: boolean
  busy?: boolean
  onRefresh: (server: McpServerConfig) => Promise<void>
  onToggleServer: (server: McpServerConfig) => Promise<void>
  onToggleTool: (server: McpServerConfig, tool: McpToolManifest) => Promise<void>
  onDelete: (server: McpServerConfig) => Promise<void>
}) {
  const motion = useMotionPreference()
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const { width, fontScale } = useWindowDimensions()
  const compact = width / fontScale < 430
  const actionCompact = width < 360
  const [toolsOpen, setToolsOpen] = useState(false)
  const [resourcesOpen, setResourcesOpen] = useState(false)
  const [promptsOpen, setPromptsOpen] = useState(false)
  const subtleBorderWidth = colors.ui.monet ? 1 : StyleSheet.hairlineWidth
  const cardSurface = colors.ui.liquidGlass ? colors.ui.semantic.chrome.background : colors.ui.semantic.surface.base
  const cardBorder = colors.ui.liquidGlass ? colors.ui.actionBar.itemBorder : colors.ui.monet ? colors.material.stroke : colors.ui.semantic.chrome.border
  const mutedSurface = colors.ui.liquidGlass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted
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
      {!readonly ? <IsleButton label={t(server.enabled ? 'mcp.disableServer' : 'mcp.enableServer')} disabled={busy} compact tone={server.enabled ? 'mint' : 'soft'} onPress={() => void onToggleServer(server)} style={actionButtonStyle} /> : null}
      <IsleButton label={t(busy ? 'mcp.refreshing' : 'settingsSubsystem.refreshManifest')} disabled={busy || !server.enabled} compact icon={<AppIcon name="refresh" color={colors.textSecondary} size={14} />} onPress={() => void onRefresh(server)} style={actionButtonStyle} />
      {!readonly ? <IsleButton label={t('common.delete')} disabled={busy} compact tone="danger" icon={<AppIcon name="delete" color={colors.ui.control.dangerForeground} size={14} />} onPress={() => void onDelete(server)} style={actionButtonStyle} /> : null}
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
        leading={<IsleChip active={server.enabled}>{t(server.enabled ? 'settings.enabled' : 'settings.disabled')}</IsleChip>}
      />
      <Text style={{ color: colors.textSecondary }}>{t('settingsSubsystem.lastConnection', { status: t(`mcp.status.${server.status}`) })}</Text>
      {server.status === 'error' ? <Text accessibilityRole="alert" selectable style={{ color: colors.ui.tone.danger.foreground }}>{t('mcp.refreshFailed')}{userFacingErrorDetail(server.lastError)}</Text> : null}
      {actions}
      <Text style={{ color: colors.textSecondary }}>{t('settingsSubsystem.approvedTools', { count: server.tools.filter(tool => tool.enabled && server.approvedToolNames.includes(tool.name)).length, total: server.tools.length })}</Text>
      <View style={{ gap: 8 }}>
          <View style={{ borderRadius: Math.min(colors.ui.radius.controlMiddle, 8), padding: 8, gap: 4, backgroundColor: mutedSurface, borderWidth: subtleBorderWidth, borderColor: pluginValidation.ok ? cardBorder : colors.ui.tone.warning.border }}>
            <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: '700', includeFontPadding: false }}>{t('mcp.pluginManifest')}</Text>
            <Text style={{ color: pluginValidation.ok ? colors.textTertiary : colors.ui.tone.warning.foreground, fontSize: 14, lineHeight: 20, fontWeight: '800', includeFontPadding: false }}>{pluginPreview}</Text>
          </View>
          <McpDisclosureRow
            title={t('mcp.toolsTitle', { count: server.tools.length })}
            detail={t('mcp.toolsCollapsedDetail', { approved: server.tools.filter((tool) => tool.enabled && server.approvedToolNames.includes(tool.name)).length, total: server.tools.length })}
            icon={<AppIcon name="shield" color={colors.textTertiary} size={16} />}
            open={toolsOpen}
            onPress={() => setToolsOpen((value) => !value)}
          />
          {toolsOpen ? (
            <MotiView from={motion === 'full' ? { opacity: 0, translateY: -6 } : undefined} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: motion === 'full' ? 144 : 0 }} style={{ gap: 8 }}>
              {server.tools.map((tool) => (
                <IsleToggle
                  key={tool.name}
                  title={tool.name}
                  description={tool.description ?? t('mcp.noDescription')}
                  active={tool.enabled && server.approvedToolNames.includes(tool.name)}
                  icon={<AppIcon name="shield" color={colors.text} size={18} />}
                  onPress={() => readonly || busy ? undefined : void onToggleTool(server, tool)}
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
            <MotiView from={motion === 'full' ? { opacity: 0, translateY: -6 } : undefined} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: motion === 'full' ? 144 : 0 }} style={{ gap: 8 }}>
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
            <MotiView from={motion === 'full' ? { opacity: 0, translateY: -6 } : undefined} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: motion === 'full' ? 144 : 0 }} style={{ gap: 8 }}>
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
  const motion = useMotionPreference()
  const { colors } = useAppTheme()
  return (
    <IslePressable
      haptic
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      style={{ minHeight: ISLE_MIN_TOUCH_TARGET, borderRadius: Math.min(colors.ui.radius.controlLarge, 8), paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.ui.liquidGlass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted, borderWidth: colors.ui.monet ? 1 : StyleSheet.hairlineWidth, borderColor: colors.ui.liquidGlass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border }}
    >
      {icon}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: '800' }}>{title}</Text>
        <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, marginTop: 1 }}>{detail}</Text>
      </View>
      <MotiView animate={{ rotate: open ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: motion === 'full' ? 160 : 0 }}>
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
