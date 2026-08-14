import { createRuntimePairingPolicy } from './runtimePairingPolicy'
import { createRuntimeSnapshotPolicy } from './runtimeSnapshotPolicy'
import { stableIdentityString } from './toolchainIdentity'

export const TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA = 'islemind.runtime-protocol.v0'
export const TOOLCHAIN_RUNTIME_EVENT_ENTRY_LIMIT = 24
export const TOOLCHAIN_RUNTIME_EVENT_KEY_LIMIT = 16
export const TOOLCHAIN_RUNTIME_KINDS = ['android-app', 'termux', 'desktop', 'remote'] as const
export const TOOLCHAIN_TRANSPORTS = ['stdio', 'streamable-http', 'http'] as const
export const TOOLCHAIN_RUNTIME_CAPABILITIES = [
  'app-action',
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
] as const

export type ToolchainRuntimeKind = typeof TOOLCHAIN_RUNTIME_KINDS[number]
export type ToolchainTransport = typeof TOOLCHAIN_TRANSPORTS[number]
export type ToolchainRuntimeCapability = typeof TOOLCHAIN_RUNTIME_CAPABILITIES[number]

export interface ToolchainRuntimeSnapshot {
  id: string
  name: string
  kind: ToolchainRuntimeKind
  protocolSchema: typeof TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA
  online: boolean
  transports: ToolchainTransport[]
  capabilities: ToolchainRuntimeCapability[]
  dependencies?: Record<string, string>
  pairedAt?: number
  lastSeenAt?: number
}

export const TOOLCHAIN_RUNTIME_PAIRING_POLICY = createRuntimePairingPolicy({
  protocolSchema: TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA,
  eventEntryLimit: TOOLCHAIN_RUNTIME_EVENT_ENTRY_LIMIT,
  eventKeyLimit: TOOLCHAIN_RUNTIME_EVENT_KEY_LIMIT,
})

export const TOOLCHAIN_RUNTIME_SNAPSHOT_POLICY = createRuntimeSnapshotPolicy<
  ToolchainRuntimeKind,
  ToolchainTransport,
  ToolchainRuntimeCapability,
  ToolchainRuntimeSnapshot
>({
  runtimeKinds: TOOLCHAIN_RUNTIME_KINDS,
  transports: TOOLCHAIN_TRANSPORTS,
  capabilities: TOOLCHAIN_RUNTIME_CAPABILITIES,
  sanitizeStableId: TOOLCHAIN_RUNTIME_PAIRING_POLICY.sanitizeExactStableIdToken,
  sanitizeDependencyMap: TOOLCHAIN_RUNTIME_PAIRING_POLICY.sanitizeRuntimePairingDependencyMap,
  stableIdentityString,
})
