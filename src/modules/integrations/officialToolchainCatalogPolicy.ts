import type {
  McpToolchainPermission,
  McpToolchainRuntimeCapability,
  McpToolchainRuntimeKind,
  McpToolchainRuntimeSupport,
  McpToolchainRuntimeSupportMap,
  McpToolchainTransport,
} from './mcpToolchainManifest'

export type OfficialToolchainToolKind = 'app-action' | 'cli' | 'mcp' | 'skill' | 'workflow'
export type OfficialToolchainEntryExecutor = 'app' | 'cli' | 'mcp' | 'remote'

export interface OfficialToolchainManifest<TManifestSchema extends string> {
  schema: TManifestSchema
  id: string
  title: string
  kind: OfficialToolchainToolKind
  version: string
  description?: string
  runtimes: McpToolchainRuntimeSupportMap
  permissions: McpToolchainPermission[]
  entry: {
    type: OfficialToolchainToolKind
    command?: string
    action?: string
    mcpToolName?: string
    transport?: McpToolchainTransport
    endpoint?: string
    executor?: OfficialToolchainEntryExecutor
  }
  requires?: {
    capabilities?: McpToolchainRuntimeCapability[]
    dependencies?: Record<string, string>
    memoryMb?: number
  }
  inputs?: Record<string, {
    type: 'string' | 'path' | 'boolean' | 'number' | 'json'
    required?: boolean
  }>
  outputs?: Record<string, { type: 'json' | 'text' | 'artifact' | 'log' }>
  diagnosticHint?: string
}

export interface OfficialToolchainRuntimeSnapshot<TRuntimeProtocolSchema extends string> {
  id: string
  name: string
  kind: McpToolchainRuntimeKind
  protocolSchema: TRuntimeProtocolSchema
  online: boolean
  transports: McpToolchainTransport[]
  capabilities: McpToolchainRuntimeCapability[]
  dependencies?: Record<string, string>
  pairedAt?: number
  lastSeenAt?: number
}

export interface OfficialToolchainCatalogPolicyDependencies<
  TManifestSchema extends string,
  TRuntimeProtocolSchema extends string,
> {
  manifestSchema: TManifestSchema
  runtimeProtocolSchema: TRuntimeProtocolSchema
}

export function createOfficialToolchainCatalogPolicy<
  const TManifestSchema extends string,
  const TRuntimeProtocolSchema extends string,
>(
  dependencies: OfficialToolchainCatalogPolicyDependencies<
    TManifestSchema,
    TRuntimeProtocolSchema
  >,
) {
  function createRuntimeSupport(
    input: Partial<Record<McpToolchainRuntimeKind, McpToolchainRuntimeSupport>>,
  ): McpToolchainRuntimeSupportMap {
    return {
      'android-app': normalizeRuntimeSupport(input['android-app']),
      termux: normalizeRuntimeSupport(input.termux),
      desktop: normalizeRuntimeSupport(input.desktop),
      remote: normalizeRuntimeSupport(input.remote),
    }
  }

  const officialTools: OfficialToolchainManifest<TManifestSchema>[] = [
    {
      schema: dependencies.manifestSchema,
      id: 'islemind.runtime.health',
      title: 'Runtime Health',
      kind: 'app-action',
      version: '0.1.0',
      description: 'Read the paired runtime health and capability envelope.',
      runtimes: createRuntimeSupport({
        'android-app': 'supported',
        termux: 'supported',
        desktop: 'supported',
        remote: 'supported',
      }),
      permissions: [],
      entry: { type: 'app-action', action: 'runtime.health', executor: 'app' },
      requires: { capabilities: ['app-action'] },
      outputs: { health: { type: 'json' } },
      diagnosticHint: 'Use this first when the Android control plane cannot see a runtime.',
    },
    {
      schema: dependencies.manifestSchema,
      id: 'islemind.registry.list',
      title: 'Registry List',
      kind: 'app-action',
      version: '0.1.0',
      description: 'List installable IsleMind tools with compatibility and permission metadata.',
      runtimes: createRuntimeSupport({
        'android-app': 'supported',
        termux: 'supported',
        desktop: 'supported',
        remote: 'supported',
      }),
      permissions: [],
      entry: { type: 'app-action', action: 'registry.list', executor: 'app' },
      requires: { capabilities: ['app-action'] },
      outputs: { registry: { type: 'json' } },
      diagnosticHint: 'Registry listing is metadata-only and should remain available on Android.',
    },
    {
      schema: dependencies.manifestSchema,
      id: 'islemind.skill.validate',
      title: 'Validate Skill',
      kind: 'skill',
      version: '0.1.0',
      description: 'Validate an IsleMind skill package and return a JSON report.',
      runtimes: createRuntimeSupport({ termux: 'supported', desktop: 'supported', remote: 'supported' }),
      permissions: ['files.read', 'task.run'],
      entry: { type: 'skill', executor: 'cli', command: 'islemind.skill.validate' },
      requires: {
        capabilities: ['skills', 'cli', 'files.read', 'task.run'],
        dependencies: { node: '>=20' },
        memoryMb: 256,
      },
      inputs: { path: { type: 'path', required: true } },
      outputs: { report: { type: 'json' }, logs: { type: 'log' } },
      diagnosticHint: 'If unavailable on Android, pair Termux or a desktop runtime with Node.js 20+.',
    },
    {
      schema: dependencies.manifestSchema,
      id: 'islemind.cli.doctor',
      title: 'CLI Doctor',
      kind: 'cli',
      version: '0.1.0',
      description: 'Run IsleMind CLI environment checks and return a bounded JSON report.',
      runtimes: createRuntimeSupport({ termux: 'supported', desktop: 'supported', remote: 'supported' }),
      permissions: ['task.run'],
      entry: { type: 'cli', executor: 'cli', command: 'islemind.cli.doctor' },
      requires: {
        capabilities: ['cli', 'task.run', 'logs.stream'],
        dependencies: { node: '>=20' },
        memoryMb: 128,
      },
      outputs: { report: { type: 'json' }, logs: { type: 'log' } },
      diagnosticHint: 'Use this after pairing a runtime to verify the CLI bridge without Android spawning shell commands.',
    },
    {
      schema: dependencies.manifestSchema,
      id: 'islemind.mcp.serve',
      title: 'Serve MCP Gateway',
      kind: 'mcp',
      version: '0.1.0',
      description: 'Start the IsleMind MCP gateway over Streamable HTTP.',
      runtimes: createRuntimeSupport({ termux: 'supported', desktop: 'supported', remote: 'supported' }),
      permissions: ['network.local', 'task.run'],
      entry: {
        type: 'cli',
        executor: 'cli',
        command: 'islemind.mcp.serve.streamable-http',
        transport: 'streamable-http',
      },
      requires: {
        capabilities: ['cli', 'mcp-gateway', 'network.local', 'task.run'],
        dependencies: { node: '>=20' },
        memoryMb: 256,
      },
      outputs: { endpoint: { type: 'json' }, logs: { type: 'log' } },
      diagnosticHint: 'Android should connect to this gateway through the Runtime API instead of spawning stdio processes.',
    },
    {
      schema: dependencies.manifestSchema,
      id: 'islemind.logs.collect',
      title: 'Collect Diagnostics',
      kind: 'app-action',
      version: '0.1.0',
      description: 'Collect bounded diagnostics with secret redaction.',
      runtimes: createRuntimeSupport({
        'android-app': 'supported',
        termux: 'supported',
        desktop: 'supported',
        remote: 'supported',
      }),
      permissions: ['context.read'],
      entry: { type: 'app-action', action: 'logs.collect', executor: 'app' },
      requires: { capabilities: ['app-action', 'context.read', 'logs.stream'] },
      outputs: { diagnostics: { type: 'artifact' } },
      diagnosticHint: 'Diagnostics bundles must omit raw secrets and unbounded task logs.',
    },
    {
      schema: dependencies.manifestSchema,
      id: 'islemind.git.commit-preview',
      title: 'Commit Preview',
      kind: 'workflow',
      version: '0.1.0',
      description: 'Prepare a visible commit preview for migrated toolchain changes.',
      runtimes: createRuntimeSupport({ desktop: 'supported', remote: 'supported' }),
      permissions: ['files.write', 'git.commit', 'task.run'],
      entry: { type: 'workflow', executor: 'cli', command: 'islemind.git.commit-preview' },
      requires: {
        capabilities: ['workflow', 'cli', 'files.write', 'git', 'task.run'],
        dependencies: { git: '>=2' },
        memoryMb: 128,
      },
      outputs: { preview: { type: 'json' }, patch: { type: 'artifact' } },
      diagnosticHint: 'Git and release actions must enter waiting_for_user before changing repository state.',
    },
  ]

  function createDefaultRuntimes(now = Date.now()): OfficialToolchainRuntimeSnapshot<TRuntimeProtocolSchema>[] {
    return [
      {
        id: 'android-app',
        name: 'IsleMind Android App',
        kind: 'android-app',
        protocolSchema: dependencies.runtimeProtocolSchema,
        online: true,
        transports: ['http'],
        capabilities: ['app-action', 'context.read', 'network.local', 'task.cancel', 'logs.stream'],
        dependencies: {},
        lastSeenAt: now,
      },
      {
        id: 'termux-local',
        name: 'Termux Runtime',
        kind: 'termux',
        protocolSchema: dependencies.runtimeProtocolSchema,
        online: true,
        transports: ['stdio', 'streamable-http', 'http'],
        capabilities: [
          'cli',
          'mcp-gateway',
          'skills',
          'workflow',
          'context.read',
          'files.read',
          'files.write',
          'network.local',
          'task.run',
          'task.cancel',
          'logs.stream',
          'git',
          'background-tasks',
        ],
        dependencies: { node: '20.0.0', git: '2.40.0' },
        pairedAt: now,
        lastSeenAt: now,
      },
      {
        id: 'desktop-local',
        name: 'Desktop Runtime',
        kind: 'desktop',
        protocolSchema: dependencies.runtimeProtocolSchema,
        online: true,
        transports: ['stdio', 'streamable-http', 'http'],
        capabilities: [
          'cli',
          'mcp-gateway',
          'skills',
          'workflow',
          'context.read',
          'files.read',
          'files.write',
          'network.local',
          'network.remote',
          'task.run',
          'task.cancel',
          'logs.stream',
          'secrets',
          'git',
          'background-tasks',
        ],
        dependencies: { node: '22.0.0', git: '2.44.0' },
        pairedAt: now,
        lastSeenAt: now,
      },
      {
        id: 'remote-primary',
        name: 'Remote Runtime',
        kind: 'remote',
        protocolSchema: dependencies.runtimeProtocolSchema,
        online: true,
        transports: ['streamable-http', 'http'],
        capabilities: [
          'cli',
          'mcp-gateway',
          'skills',
          'workflow',
          'context.read',
          'files.read',
          'files.write',
          'network.remote',
          'task.run',
          'task.cancel',
          'logs.stream',
          'secrets',
          'git',
          'background-tasks',
        ],
        dependencies: { node: '22.0.0', git: '2.44.0' },
        pairedAt: now,
        lastSeenAt: now,
      },
    ]
  }

  return {
    createRuntimeSupport,
    officialTools,
    createDefaultRuntimes,
  }
}

function normalizeRuntimeSupport(
  input: McpToolchainRuntimeSupport | undefined,
): McpToolchainRuntimeSupport {
  return input === 'supported' || input === 'requires-companion' ? input : 'unsupported'
}
