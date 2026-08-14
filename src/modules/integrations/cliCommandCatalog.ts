import type {
  AdmittedToolKind,
  AdmittedToolManifest,
  AdmittedToolTransport,
} from './toolchainManifestAdmission'
import { sanitizeToolCommandReference } from './toolchainManifestAdmission'
import { isUnsafeRuntimePairingText } from './textSafety'

export interface ToolchainCliCommandSpec {
  commandRef: string
  toolKind: AdmittedToolKind
  argv: string[]
  transport?: AdmittedToolTransport
  requiredInputKeys?: string[]
  outputKeys?: string[]
}

interface CliCommandCatalogEntry {
  readonly commandRef: string
  readonly toolKind: AdmittedToolKind
  readonly argv: readonly string[]
  readonly transport?: AdmittedToolTransport
  readonly requiredInputKeys?: readonly string[]
  readonly outputKeys?: readonly string[]
}

const CLI_COMMAND_CATALOG = [
  {
    commandRef: 'islemind.skill.validate',
    toolKind: 'skill',
    argv: ['islemind', 'skill', 'validate'],
    requiredInputKeys: ['path'],
    outputKeys: ['report', 'logs'],
  },
  {
    commandRef: 'islemind.cli.doctor',
    toolKind: 'cli',
    argv: ['islemind', 'doctor'],
    outputKeys: ['report', 'logs'],
  },
  {
    commandRef: 'islemind.mcp.serve.streamable-http',
    toolKind: 'mcp',
    argv: ['islemind', 'mcp', 'serve', '--transport', 'streamable-http'],
    transport: 'streamable-http',
    outputKeys: ['endpoint', 'logs'],
  },
  {
    commandRef: 'islemind.git.commit-preview',
    toolKind: 'workflow',
    argv: ['islemind', 'git', 'commit-preview'],
    outputKeys: ['preview', 'patch'],
  },
] as const satisfies readonly CliCommandCatalogEntry[]

export function resolveToolchainCliCommandSpec(
  commandRef: unknown,
): ToolchainCliCommandSpec | undefined {
  const safeRef = sanitizeToolCommandReference(commandRef)
  if (!safeRef) return undefined
  const spec = CLI_COMMAND_CATALOG.find((item) => item.commandRef === safeRef)
  return spec && isTrustedToolchainCliCommandSpec(spec)
    ? cloneToolchainCliCommandSpec(spec)
    : undefined
}

export function resolveToolchainCliCommandSpecForManifest(
  manifest: AdmittedToolManifest,
): ToolchainCliCommandSpec | undefined {
  if (manifest.entry.executor !== 'cli' && manifest.entry.type !== 'cli') return undefined
  const spec = resolveToolchainCliCommandSpec(manifest.entry.command)
  if (!spec || spec.toolKind !== manifest.kind) return undefined
  if (manifest.entry.transport !== undefined && spec.transport !== manifest.entry.transport) return undefined
  return spec
}

function cloneToolchainCliCommandSpec(spec: CliCommandCatalogEntry): ToolchainCliCommandSpec {
  return {
    commandRef: spec.commandRef,
    toolKind: spec.toolKind,
    argv: [...spec.argv],
    transport: spec.transport,
    requiredInputKeys: spec.requiredInputKeys ? [...spec.requiredInputKeys] : undefined,
    outputKeys: spec.outputKeys ? [...spec.outputKeys] : undefined,
  }
}

function isTrustedToolchainCliCommandSpec(spec: CliCommandCatalogEntry): boolean {
  return (
    sanitizeToolCommandReference(spec.commandRef) === spec.commandRef &&
    Array.isArray(spec.argv) &&
    spec.argv.length >= 2 &&
    spec.argv.length <= 12 &&
    spec.argv[0] === 'islemind' &&
    spec.argv.every(isSafeCliArg) &&
    isSafeCliKeyList(spec.requiredInputKeys) &&
    isSafeCliKeyList(spec.outputKeys)
  )
}

function isSafeCliArg(input: unknown): input is string {
  if (typeof input !== 'string' || input.trim() !== input) return false
  const value = input
  if (!value || isUnsafeRuntimePairingText(value)) return false
  return /^[a-z0-9_.:-]+$/i.test(value)
}

function isSafeCliKeyList(input: unknown): boolean {
  if (input === undefined) return true
  return Array.isArray(input) && input.length <= 24 && input.every(isSafeCliArg)
}
