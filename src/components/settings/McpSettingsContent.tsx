import { useEffect, useMemo, useState } from 'react'
import { Text, View, useWindowDimensions } from 'react-native'
import { Network, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react-native'
import { useTranslation } from 'react-i18next'
import { IsleButton } from '@/components/ui/isle'
import { useIsleDialog } from '@/components/ui/isle'
import { IsleField, IsleListItem, IsleSection, IsleToggle } from '@/components/ui/isle'
import { IsleChip } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { listMcpServers, refreshMcpManifest, saveMcpServers, upsertMcpServer } from '@/services/mcp'
import type { McpPromptManifest, McpResourceManifest, McpServerConfig, McpToolManifest } from '@/types'

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000

export function McpSettingsContent() {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const { width } = useWindowDimensions()
  const compact = width < 430
  const [servers, setServers] = useState<McpServerConfig[]>([])
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const userServers = useMemo(() => servers.filter((server) => server.id !== 'islemind-builtins'), [servers])
  const builtInServer = servers.find((server) => server.id === 'islemind-builtins')

  useEffect(() => {
    void refresh()
  }, [])

  async function refresh() {
    setServers(await listMcpServers())
  }

  async function addServer() {
    const endpoint = url.trim()
    if (!/^https?:\/\//i.test(endpoint)) {
      dialog.toast({ title: t('mcp.urlRequired'), tone: 'amber' })
      return
    }
    const now = Date.now()
    const server = await upsertMcpServer({
      id: `mcp-${now}-${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim() || new URL(endpoint).host,
      url: endpoint,
      transport: 'sse',
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
    await refresh()
    dialog.toast({ title: t('mcp.added'), message: server.name, tone: 'mint' })
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
    await upsertMcpServer({ ...server, enabled: !server.enabled, updatedAt: Date.now() })
    await refresh()
    dialog.toast({ title: server.enabled ? t('mcp.disabled') : t('mcp.enabled'), message: server.name, tone: server.enabled ? 'amber' : 'mint' })
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

  return (
    <View style={{ gap: 12 }}>
      <IsleSection
        title={t('mcp.addServer')}
        subtitle={t('mcp.addServerSubtitle')}
        action={<Network color={colors.textSecondary} size={18} />}
      >
        <View style={{ gap: 10 }}>
          <IsleField label={t('mcp.name')} inputProps={{ value: name, onChangeText: setName, placeholder: 'Local tools' }} />
          <IsleField label={t('mcp.url')} inputProps={{ value: url, onChangeText: setUrl, placeholder: 'https://example.com/mcp', autoCapitalize: 'none', autoCorrect: false }} />
          <IsleButton label={t('mcp.add')} icon={<Plus color={colors.ui.control.primaryForeground} size={16} />} tone="primary" onPress={() => void addServer()} style={compact ? { alignSelf: 'stretch' } : { alignSelf: 'flex-start', minWidth: 0 }} />
        </View>
      </IsleSection>

      {builtInServer ? (
        <IsleSection title={t('mcp.builtIn')}>
          <ServerCard server={builtInServer} readonly onRefresh={refreshServer} onToggleServer={toggleServer} onToggleTool={toggleTool} onDelete={deleteServer} />
        </IsleSection>
      ) : null}

      <IsleSection title={`${t('mcp.servers')} ${userServers.length}`}>
        <View style={{ gap: 8 }}>
          {userServers.map((server) => (
            <ServerCard key={server.id} server={server} onRefresh={refreshServer} onToggleServer={toggleServer} onToggleTool={toggleTool} onDelete={deleteServer} />
          ))}
          {!userServers.length ? <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '800' }}>{t('mcp.empty')}</Text> : null}
        </View>
      </IsleSection>
    </View>
  )
}

function ServerCard({
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
  const resourceItems = server.resources.map((resource) => ({
    key: resource.uri,
    title: resource.name ?? resource.uri,
    description: formatResourceDescription(resource),
  }))
  const promptItems = server.prompts.map((prompt) => ({
    key: prompt.name,
    title: prompt.name,
    description: formatPromptDescription(prompt, t),
  }))
  const actions = (
    <View style={{ flexDirection: compact ? 'column' : 'row', flexWrap: compact ? 'nowrap' : 'wrap', gap: 8, justifyContent: 'flex-end', alignItems: compact ? 'stretch' : 'center' }}>
      {!readonly ? <IsleButton label={server.enabled ? t('settings.enabledState') : t('settings.disabledState')} compact tone={server.enabled ? 'mint' : 'soft'} onPress={() => void onToggleServer(server)} style={compact ? { alignSelf: 'stretch' } : undefined} /> : null}
      <IsleButton label={t('settings.sync')} compact icon={<RefreshCw color={colors.textSecondary} size={14} />} onPress={() => void onRefresh(server)} style={compact ? { alignSelf: 'stretch' } : undefined} />
      {!readonly ? <IsleButton label={t('common.delete')} compact tone="danger" icon={<Trash2 color={colors.ui.tone.danger.foreground} size={14} />} onPress={() => void onDelete(server)} style={compact ? { alignSelf: 'stretch' } : undefined} /> : null}
    </View>
  )
  return (
    <View
      style={{
        borderRadius: colors.ui.radius.panel,
        padding: compact ? 10 : 12,
        gap: 10,
        backgroundColor: colors.ui.card.defaultBackground,
        borderWidth: colors.ui.minimal ? 1 : 2,
        borderColor: server.enabled ? colors.material.strokeStrong : colors.material.stroke,
        shadowColor: colors.ui.control.shadow,
        shadowOpacity: colors.ui.card.shadowOpacity,
        shadowRadius: colors.ui.card.shadowRadius,
        shadowOffset: { width: 0, height: colors.ui.card.shadowOffset },
        elevation: colors.ui.card.shadowOpacity > 0 ? 1 : 0,
      }}
    >
      <IsleListItem
        title={server.name}
        description={[server.url, t('mcp.refreshSummary', { tools: server.tools.length, resources: server.resources.length, prompts: server.prompts.length })].join('\n')}
        leading={<IsleChip active={server.status === 'connected'}>{t(`mcp.status.${server.status}`)}</IsleChip>}
      />
      {actions}
      <View style={{ gap: 8 }}>
        <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900', letterSpacing: 0.3 }}>{t('mcp.toolsTitle', { count: server.tools.length })}</Text>
        {server.tools.map((tool) => (
          <IsleToggle
            key={tool.name}
            title={tool.name}
            description={tool.description ?? t('mcp.noDescription')}
            active={tool.enabled}
            icon={<ShieldCheck color={colors.text} size={18} />}
            onPress={() => readonly ? undefined : void onToggleTool(server, tool)}
          />
        ))}
        {!server.tools.length ? <Text style={{ color: colors.textTertiary, fontSize: 12, fontWeight: '800' }}>{t('mcp.noTools')}</Text> : null}
      </View>
      <View style={{ gap: 8 }}>
        <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900', letterSpacing: 0.3 }}>{t('mcp.resourcesTitle', { count: server.resources.length })}</Text>
        {resourceItems.map((resource) => (
          <IsleListItem
            key={resource.key}
            title={resource.title}
            description={resource.description}
            leading={<IsleChip>{t('mcp.resourceChip')}</IsleChip>}
          />
        ))}
        {!resourceItems.length ? <Text style={{ color: colors.textTertiary, fontSize: 12, fontWeight: '800' }}>{t('mcp.noResources')}</Text> : null}
      </View>
      <View style={{ gap: 8 }}>
        <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900', letterSpacing: 0.3 }}>{t('mcp.promptsTitle', { count: server.prompts.length })}</Text>
        {promptItems.map((prompt) => (
          <IsleListItem
            key={prompt.key}
            title={prompt.title}
            description={prompt.description}
            leading={<IsleChip>{t('mcp.promptChip')}</IsleChip>}
          />
        ))}
        {!promptItems.length ? <Text style={{ color: colors.textTertiary, fontSize: 12, fontWeight: '800' }}>{t('mcp.noPrompts')}</Text> : null}
      </View>
    </View>
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
