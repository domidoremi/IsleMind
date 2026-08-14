import {
  sanitizeAppActionReference,
  sanitizeMcpToolReference,
  sanitizeToolCommandReference,
  type AdmittedRuntimeCapability,
  type AdmittedRuntimeKind,
  type AdmittedToolManifest,
  type AdmittedToolTransport,
} from './toolchainManifestAdmission'
import { sanitizeToolchainEndpointReference } from './endpointPayloadPolicy'

export type RuntimeHandoffDeliveryKind = 'android-app-action' | 'companion-http' | 'runtime-local' | 'remote-http'

export interface RuntimeHandoffSnapshot {
  id: string
  kind: AdmittedRuntimeKind
  transports: AdmittedToolTransport[]
  capabilities: AdmittedRuntimeCapability[]
  dependencies?: Record<string, string>
}

export interface RuntimeHandoffEntryRef {
  type: AdmittedToolManifest['entry']['type']
  executor?: AdmittedToolManifest['entry']['executor']
  commandRef?: string
  action?: string
  mcpToolName?: string
  transport?: AdmittedToolTransport
  endpoint?: string
}

export interface RuntimeHandoffPolicyDependencies {
  runtimeCapabilities: readonly AdmittedRuntimeCapability[]
  satisfiesDependency(version: string | undefined, range: string): boolean
}

export interface RuntimeHandoffPolicy {
  inferRequiredCapabilities(manifest: AdmittedToolManifest): AdmittedRuntimeCapability[]
  missingRuntimeDependencies(manifest: AdmittedToolManifest, runtime: RuntimeHandoffSnapshot): string[]
  resolveRuntimeHandoffDelivery(manifest: AdmittedToolManifest, runtime: RuntimeHandoffSnapshot): RuntimeHandoffDeliveryKind
  createRuntimeHandoffEntryRef(manifest: AdmittedToolManifest): RuntimeHandoffEntryRef
  sanitizeRuntimeHandoffEndpointRef(input: unknown): string | undefined
  runtimeHandoffBlockedReasons(manifest: AdmittedToolManifest, runtime: RuntimeHandoffSnapshot): string[]
}

export function createRuntimeHandoffPolicy(
  dependencies: RuntimeHandoffPolicyDependencies,
): RuntimeHandoffPolicy {
  function inferRequiredCapabilities(manifest: AdmittedToolManifest): AdmittedRuntimeCapability[] {
    const capabilities = new Set<AdmittedRuntimeCapability>(manifest.requires?.capabilities ?? [])
    if (manifest.entry.type === 'app-action') capabilities.add('app-action')
    if (manifest.entry.type === 'cli') capabilities.add('cli')
    if (manifest.entry.type === 'mcp') capabilities.add('mcp-gateway')
    if (manifest.entry.type === 'skill') capabilities.add('skills')
    if (manifest.entry.type === 'workflow') capabilities.add('workflow')
    for (const permission of manifest.permissions) {
      const capability = permissionToCapability(permission)
      if (capability) capabilities.add(capability)
    }
    return Array.from(capabilities)
  }

  function missingRuntimeDependencies(
    manifest: AdmittedToolManifest,
    runtime: RuntimeHandoffSnapshot,
  ): string[] {
    return Object.entries(manifest.requires?.dependencies ?? {})
      .filter(([name, range]) => !dependencies.satisfiesDependency(runtime.dependencies?.[name], range))
      .map(([name, range]) => `${name}${range}`)
  }

  function resolveRuntimeHandoffDelivery(
    manifest: AdmittedToolManifest,
    runtime: RuntimeHandoffSnapshot,
  ): RuntimeHandoffDeliveryKind {
    if (runtime.kind === 'android-app' && manifest.entry.type === 'app-action') return 'android-app-action'
    if (runtime.kind === 'remote') return 'remote-http'
    if (manifest.entry.transport === 'streamable-http' || manifest.entry.transport === 'http') return 'companion-http'
    return 'runtime-local'
  }

  function createRuntimeHandoffEntryRef(manifest: AdmittedToolManifest): RuntimeHandoffEntryRef {
    return {
      type: manifest.entry.type,
      executor: manifest.entry.executor,
      commandRef: manifest.entry.executor === 'cli' || manifest.entry.type === 'cli'
        ? sanitizeToolCommandReference(manifest.entry.command)
        : undefined,
      action: manifest.entry.type === 'app-action' ? sanitizeAppActionReference(manifest.entry.action) : undefined,
      mcpToolName: manifest.entry.type === 'mcp' ? sanitizeMcpToolReference(manifest.entry.mcpToolName) : undefined,
      transport: manifest.entry.transport,
      endpoint: sanitizeRuntimeHandoffEndpointRef(manifest.entry.endpoint),
    }
  }

  function sanitizeRuntimeHandoffEndpointRef(input: unknown): string | undefined {
    return sanitizeToolchainEndpointReference(input)
  }

  function runtimeHandoffBlockedReasons(
    manifest: AdmittedToolManifest,
    runtime: RuntimeHandoffSnapshot,
  ): string[] {
    const blockedReasons: string[] = []
    if (manifest.runtimes[runtime.kind] !== 'supported') {
      blockedReasons.push(`${runtime.kind} is ${manifest.runtimes[runtime.kind]}.`)
    }
    if (manifest.entry.transport && !runtime.transports.includes(manifest.entry.transport)) {
      blockedReasons.push(`${runtime.id} does not support ${manifest.entry.transport}.`)
    }
    const missingCapabilities = inferRequiredCapabilities(manifest)
      .filter((capability) => !runtime.capabilities.includes(capability))
    const missingDependencies = missingRuntimeDependencies(manifest, runtime)
    if (missingCapabilities.length) {
      blockedReasons.push(`${runtime.id} is missing required capabilities: ${missingCapabilities.join(', ')}.`)
    }
    if (missingDependencies.length) {
      blockedReasons.push(`${runtime.id} is missing required dependencies: ${missingDependencies.join(', ')}.`)
    }
    return blockedReasons
  }

  function permissionToCapability(permission: AdmittedToolManifest['permissions'][number]): AdmittedRuntimeCapability | undefined {
    if (permission === 'secrets.use') return 'secrets'
    if (permission === 'git.commit' || permission === 'git.push' || permission === 'release.publish') return 'git'
    return dependencies.runtimeCapabilities.includes(permission as AdmittedRuntimeCapability)
      ? permission as AdmittedRuntimeCapability
      : undefined
  }

  return {
    inferRequiredCapabilities,
    missingRuntimeDependencies,
    resolveRuntimeHandoffDelivery,
    createRuntimeHandoffEntryRef,
    sanitizeRuntimeHandoffEndpointRef,
    runtimeHandoffBlockedReasons,
  }
}
