import type { TaskId } from '@/core'

import type {
  ExternalToolExecutionResult,
  ToolAdapter,
  ToolRequest,
} from './contracts'
import {
  createServerToolManifests,
  type ExternalToolDescriptor,
  type IntegrationToolManifest,
} from './toolManifest'

export const BUILT_IN_CAPABILITY_SERVER_ID = 'islemind-builtins'
export const BUILT_IN_WORKSPACE_ABSENT_REVISION = 'absent:v1'

export const BUILT_IN_CAPABILITY_TOOL_NAMES = [
  'search_web',
  'crawl_web',
  'read_file',
  'edit_file',
] as const

export type BuiltInCapabilityToolName = typeof BUILT_IN_CAPABILITY_TOOL_NAMES[number]

export type BuiltInCapabilityOutcomeCode =
  | 'completed'
  | 'cancelled'
  | 'timed_out'
  | 'permission_required'
  | 'confirmation_required'
  | 'policy_denied'
  | 'schema_invalid'
  | 'path_outside_workspace'
  | 'mime_unsupported'
  | 'size_limit_exceeded'
  | 'network_target_denied'
  | 'redirect_denied'
  | 'precondition_required'
  | 'precondition_failed'
  | 'conflict'
  | 'idempotency_required'
  | 'idempotency_conflict'
  | 'capability_unavailable'
  | 'execution_failed'

export interface BuiltInCapabilityOutcome {
  code: BuiltInCapabilityOutcomeCode
  retryable: boolean
  message: string
}

export interface BuiltInCapabilityExecutionResult extends ExternalToolExecutionResult {
  capabilityOutcome: BuiltInCapabilityOutcome
}

export type BuiltInCapabilityAdapter = ToolAdapter & {
  readonly definition: ToolAdapter['definition'] & {
    readonly id: `builtin:${string}:${BuiltInCapabilityToolName}`
    readonly source: 'builtin'
  }
  execute(
    request: ToolRequest,
    options: { signal: AbortSignal },
  ): Promise<BuiltInCapabilityExecutionResult>
}

export type BuiltInCapabilityPermission =
  | 'files.read'
  | 'files.write'
  | 'network.remote'

export interface BuiltInCapabilityToolPolicy {
  readonly permissions: readonly BuiltInCapabilityPermission[]
  readonly requiresConfirmation: boolean
}

const BUILT_IN_CAPABILITY_TOOL_POLICIES: Readonly<Record<
  BuiltInCapabilityToolName,
  BuiltInCapabilityToolPolicy
>> = {
  search_web: { permissions: ['network.remote'], requiresConfirmation: false },
  crawl_web: { permissions: ['network.remote'], requiresConfirmation: false },
  read_file: { permissions: ['files.read'], requiresConfirmation: false },
  edit_file: { permissions: ['files.read', 'files.write'], requiresConfirmation: true },
}

/** Returns a clone so callers cannot mutate the canonical capability policy. */
export function getBuiltInCapabilityToolPolicy(
  name: BuiltInCapabilityToolName,
): BuiltInCapabilityToolPolicy {
  const policy = BUILT_IN_CAPABILITY_TOOL_POLICIES[name]
  return {
    permissions: [...policy.permissions],
    requiresConfirmation: policy.requiresConfirmation,
  }
}

export interface BuiltInCapabilityAdmissionRequest {
  taskId: TaskId
  toolId: string
  toolName: BuiltInCapabilityToolName
  requiredPermissions: readonly BuiltInCapabilityPermission[]
  requiresConfirmation: boolean
}

export type BuiltInCapabilityAdmissionDecision =
  | {
      status: 'allowed'
      taskId: TaskId
      toolId: string
      grantedPermissions: readonly BuiltInCapabilityPermission[]
      confirmed: boolean
      confirmationTokenDigest?: string
      idempotencyKey?: string
    }
  | {
      status: 'confirmation_required' | 'permission_required' | 'denied' | 'unavailable'
      taskId?: TaskId
      toolId?: string
      reason?: string
    }

/**
 * The task/runtime layer supplies this attestation. Tool arguments can never
 * self-assert permission, confirmation, or an idempotency key.
 */
export interface BuiltInCapabilityAdmissionPort {
  admit(
    request: BuiltInCapabilityAdmissionRequest,
    options: { signal: AbortSignal },
  ): Promise<BuiltInCapabilityAdmissionDecision>
}

export interface BuiltInWebSearchResult {
  title: string
  url: string
  snippet?: string
}

export interface BuiltInWebSearchPort {
  search(
    input: { query: string; limit: number },
    options: { signal: AbortSignal; timeoutMs: number },
  ): Promise<readonly BuiltInWebSearchResult[]>
}

export type BuiltInNetworkTargetAdmission =
  | {
      status: 'allowed'
      canonicalUrl: string
      permitToken: string
      resolvedAddressDigest: string
      classification: 'public'
    }
  | {
      status: 'denied' | 'unresolved' | 'unavailable'
      reason?: string
    }

/**
 * Implementations must resolve the target at admission time and bind the
 * returned opaque permit to the actual connection, preventing DNS rebinding.
 */
export interface BuiltInNetworkTrustPort {
  admitTarget(
    url: string,
    options: { signal: AbortSignal },
  ): Promise<BuiltInNetworkTargetAdmission>
}

export interface BuiltInWebFetchResponse {
  requestedUrl: string
  finalUrl: string
  status: number
  mimeType?: string
  byteLength: number
  body?: string
  redirectUrl?: string
}

/**
 * Fetch implementations must use manual redirects, enforce maxBytes while
 * streaming, and bind the opaque target permit to the connected address.
 */
export interface BuiltInWebFetchPort {
  fetch(
    input: {
      url: string
      targetPermit: string
      maxBytes: number
      redirect: 'manual'
      acceptedMimeTypes: readonly string[]
    },
    options: { signal: AbortSignal; timeoutMs: number },
  ): Promise<BuiltInWebFetchResponse>
}

export interface BuiltInRemoteWebCrawlPage {
  url: string
  title?: string
  text: string
  byteLength: number
  depth: number
}

export interface BuiltInRemoteWebCrawlResult {
  pages: readonly BuiltInRemoteWebCrawlPage[]
}

/**
 * Returns page extraction performed by a configured remote vendor. This port
 * does not assert DNS resolution or bind an address to the vendor connection;
 * callers must validate its returned public URLs and all declared limits.
 */
export interface BuiltInRemoteWebCrawlPort {
  crawl(
    input: {
      url: string
      maxDepth: number
      maxPages: number
      maxBytes: number
      maxPageBytes: number
      maxTextCharsPerPage: number
      maxTotalTextChars: number
      sameOriginOnly: true
    },
    options: { signal: AbortSignal; timeoutMs: number },
  ): Promise<BuiltInRemoteWebCrawlResult>
}

export interface BuiltInWorkspaceFileInfo {
  relativePath: string
  revision: string
  byteLength: number
  mimeType: string
}

export interface BuiltInWorkspaceFileReadResult extends BuiltInWorkspaceFileInfo {
  text: string
}

export type BuiltInWorkspaceFileEditResult =
  | {
      status: 'applied' | 'replayed'
      relativePath: string
      previousRevision: string
      revision: string
      byteLength: number
      mimeType: string
    }
  | {
      status: 'conflict'
      relativePath: string
      expectedRevision: string
      actualRevision?: string
    }
  | {
      status: 'idempotency_conflict' | 'unavailable'
      relativePath: string
      reason?: string
    }

/**
 * The port is scoped to exactly one workspace root and must independently
 * re-check containment before every read.
 */
export interface BuiltInWorkspaceFileReadPort {
  readonly workspaceScopeId: string
  inspect(
    relativePath: string,
    options: { signal: AbortSignal },
  ): Promise<BuiltInWorkspaceFileInfo | undefined>
  readText(
    relativePath: string,
    options: { signal: AbortSignal; maxBytes: number },
  ): Promise<BuiltInWorkspaceFileReadResult>
}

/**
 * A read-capable workspace port that also proves atomic compare-and-swap and
 * durable idempotency for edits.
 */
export interface BuiltInWorkspaceFilePort extends BuiltInWorkspaceFileReadPort {
  editTextAtomic(
    input: {
      relativePath: string
      text: string
      mimeType: string
      expectedRevision: string
      idempotencyKey: string
    },
    options: { signal: AbortSignal },
  ): Promise<BuiltInWorkspaceFileEditResult>
}

export interface BuiltInCapabilityAdapterDependencies {
  admission: BuiltInCapabilityAdmissionPort
  webSearch?: BuiltInWebSearchPort
  networkTrust?: BuiltInNetworkTrustPort
  webFetch?: BuiltInWebFetchPort
  remoteWebCrawl?: BuiltInRemoteWebCrawlPort
  workspaceFileRead?: BuiltInWorkspaceFileReadPort
  workspaceFiles?: BuiltInWorkspaceFilePort
  now?: () => number
}

const BUILT_IN_CAPABILITY_TOOL_DESCRIPTORS: readonly ExternalToolDescriptor[] = [
  {
    name: 'search_web',
    description: 'Search configured web providers and return bounded public results without exposing credentials.',
    permission: 'read-only',
    enabled: true,
    inputSchema: objectSchema({
      query: { type: 'string', minLength: 1, maxLength: 500 },
      limit: { type: 'integer', minimum: 1, maximum: 10 },
      timeoutMs: { type: 'integer', minimum: 1_000, maximum: 15_000 },
    }, ['query']),
  },
  {
    name: 'crawl_web',
    description: 'Crawl a public HTTPS site with strict same-origin, depth, page, byte, redirect, and timeout limits.',
    permission: 'read-only',
    enabled: true,
    inputSchema: objectSchema({
      url: { type: 'string', maxLength: 2_048 },
      maxDepth: { type: 'integer', minimum: 0, maximum: 3 },
      maxPages: { type: 'integer', minimum: 1, maximum: 12 },
      maxBytes: { type: 'integer', minimum: 1_024, maximum: 2_097_152 },
      timeoutMs: { type: 'integer', minimum: 1_000, maximum: 15_000 },
    }, ['url']),
  },
  {
    name: 'read_file',
    description: 'Read bounded UTF-8 text from a workspace-relative file after containment and MIME validation.',
    permission: 'read-only',
    enabled: true,
    inputSchema: objectSchema({
      path: { type: 'string', maxLength: 512 },
      maxBytes: { type: 'integer', minimum: 1, maximum: 262_144 },
    }, ['path']),
  },
  {
    name: 'edit_file',
    description: 'Atomically create or replace bounded UTF-8 text only when the caller supplies the current or explicit absent revision.',
    permission: 'read-write',
    enabled: true,
    inputSchema: objectSchema({
      path: {
        type: 'string',
        pattern: '^workspace/.+',
        maxLength: 512,
        description: 'Writable workspace path beginning with workspace/, for example workspace/notes.txt.',
      },
      text: { type: 'string', maxLength: 262_144 },
      expectedRevision: {
        type: 'string',
        pattern: '^(?:absent:v1|sha256:[a-f0-9]{64})$',
        maxLength: 71,
        description: 'Use absent:v1 to create a missing file; otherwise use the exact sha256 revision returned by read_file.',
      },
      mimeType: { type: 'string', maxLength: 128 },
    }, ['path', 'text', 'expectedRevision']),
  },
]

export function listBuiltInCapabilityToolDescriptors(input: {
  enabledToolNames?: readonly BuiltInCapabilityToolName[]
} = {}): readonly ExternalToolDescriptor[] {
  const enabledToolNames = input.enabledToolNames
    ? new Set<BuiltInCapabilityToolName>(input.enabledToolNames)
    : undefined
  return BUILT_IN_CAPABILITY_TOOL_DESCRIPTORS.map((descriptor) => ({
    ...cloneDescriptor(descriptor),
    enabled: descriptor.enabled && (enabledToolNames === undefined || enabledToolNames.has(descriptor.name as BuiltInCapabilityToolName)),
  }))
}

/** Replaces same-name legacy descriptors while preserving unrelated built-ins. */
export function mergeBuiltInCapabilityToolDescriptors(
  existing: readonly ExternalToolDescriptor[],
  input: { enabledToolNames?: readonly BuiltInCapabilityToolName[] } = {},
): ExternalToolDescriptor[] {
  const replacements = new Map(listBuiltInCapabilityToolDescriptors(input).map((item) => [item.name, item]))
  const merged = existing
    .filter((item) => !replacements.has(item.name))
    .map(cloneDescriptor)
  merged.push(...[...replacements.values()].map(cloneDescriptor))
  return merged
}

export function createBuiltInCapabilityToolManifests(input: {
  serverId?: string
  serverName?: string
  enabled?: boolean
  enabledToolNames?: readonly BuiltInCapabilityToolName[]
} = {}): IntegrationToolManifest[] {
  return createServerToolManifests({
    source: 'builtin',
    serverId: input.serverId ?? BUILT_IN_CAPABILITY_SERVER_ID,
    serverName: input.serverName ?? 'IsleMind Built-ins',
    status: 'connected',
    enabled: input.enabled ?? true,
    tools: listBuiltInCapabilityToolDescriptors({ enabledToolNames: input.enabledToolNames }),
  })
}

function objectSchema(
  properties: Record<string, Record<string, unknown>>,
  required: readonly string[] = [],
): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required: [...required],
  }
}

function cloneDescriptor(input: ExternalToolDescriptor): ExternalToolDescriptor {
  return {
    ...input,
    ...(input.inputSchema ? { inputSchema: cloneJsonRecord(input.inputSchema) } : {}),
  }
}

function cloneJsonRecord(input: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(input)) as Record<string, unknown>
}
