export const MCP_REMOTE_PRESET_IDS = [
  'context7',
  'microsoft-learn',
] as const

export type McpRemotePresetId = typeof MCP_REMOTE_PRESET_IDS[number]

export type McpRemotePresetUseCase =
  | 'library-documentation'
  | 'microsoft-documentation'

export interface McpRemotePreset {
  readonly id: McpRemotePresetId
  readonly name: string
  readonly url: string
  readonly transport: 'streamable-http'
  readonly useCase: McpRemotePresetUseCase
  readonly source: 'official' | 'open-source'
  readonly authentication: 'none' | 'optional-api-key'
  readonly protocolPreference: 'latest-with-legacy-fallback'
  readonly enabledOnInstall: true
  readonly autoApproveTools: false
}

const MCP_REMOTE_PRESETS: readonly McpRemotePreset[] = Object.freeze([
  Object.freeze({
    id: 'context7',
    name: 'Context7',
    url: 'https://mcp.context7.com/mcp',
    transport: 'streamable-http',
    useCase: 'library-documentation',
    source: 'official',
    authentication: 'optional-api-key',
    protocolPreference: 'latest-with-legacy-fallback',
    enabledOnInstall: true,
    autoApproveTools: false,
  }),
  Object.freeze({
    id: 'microsoft-learn',
    name: 'Microsoft Learn',
    url: 'https://learn.microsoft.com/api/mcp',
    transport: 'streamable-http',
    useCase: 'microsoft-documentation',
    source: 'official',
    authentication: 'none',
    protocolPreference: 'latest-with-legacy-fallback',
    enabledOnInstall: true,
    autoApproveTools: false,
  }),
])

export function listMcpRemotePresets(): readonly McpRemotePreset[] {
  return MCP_REMOTE_PRESETS.map(cloneMcpRemotePreset)
}

export function getMcpRemotePreset(id: McpRemotePresetId): McpRemotePreset {
  const preset = MCP_REMOTE_PRESETS.find((item) => item.id === id)
  if (!preset) throw new Error(`Unknown MCP remote preset: ${id}`)
  return cloneMcpRemotePreset(preset)
}

function cloneMcpRemotePreset(preset: McpRemotePreset): McpRemotePreset {
  return { ...preset }
}
