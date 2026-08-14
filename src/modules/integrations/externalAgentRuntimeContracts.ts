import type { ToolchainRuntimeCapability } from './toolchainRuntimeTrust'

export const EXTERNAL_AGENT_RUNTIME_DESCRIPTOR_SCHEMA = 'islemind.external-agent-runtime-descriptor.v1'
export const EXTERNAL_AGENT_RUNTIME_SESSION_REQUEST_SCHEMA = 'islemind.external-agent-runtime-session-request.v1'
export const EXTERNAL_AGENT_RUNTIME_SESSION_OUTCOME_SCHEMA = 'islemind.external-agent-runtime-session-outcome.v1'

export const EXTERNAL_AGENT_RUNTIME_PRODUCTS = Object.freeze([
  'codex-cli',
  'codex-desktop',
  'claude-code',
  'grok-cli',
] as const)

export const EXTERNAL_AGENT_RUNTIME_PROTOCOLS = Object.freeze([
  'codex-app-server',
  'claude-code-stream-json',
  'grok-acp',
] as const)

export const EXTERNAL_AGENT_RUNTIME_SESSION_IDENTITY_KINDS = Object.freeze([
  'codex-thread',
  'claude-session',
  'acp-session',
] as const)

export const EXTERNAL_AGENT_RUNTIME_REQUIRED_CAPABILITIES = Object.freeze([
  'cli',
  'task.run',
] as const satisfies readonly ToolchainRuntimeCapability[])

export const EXTERNAL_AGENT_RUNTIME_LIMITS = Object.freeze({
  descriptorNameChars: 128,
  descriptorVersionChars: 64,
  instructionChars: 32_768,
  outputChars: 131_072,
  errorMessageChars: 2_048,
})

export type ExternalAgentRuntimeProduct = typeof EXTERNAL_AGENT_RUNTIME_PRODUCTS[number]
export type ExternalAgentRuntimeProtocol = typeof EXTERNAL_AGENT_RUNTIME_PROTOCOLS[number]
export type ExternalAgentRuntimeSessionIdentityKind = typeof EXTERNAL_AGENT_RUNTIME_SESSION_IDENTITY_KINDS[number]
export type ExternalAgentRuntimeTransport = 'stdio'
export type ExternalAgentRuntimeOperation = 'open' | 'resume'
export type ExternalAgentRuntimeRequiredCapability = typeof EXTERNAL_AGENT_RUNTIME_REQUIRED_CAPABILITIES[number]

export const EXTERNAL_AGENT_RUNTIME_TASK_TOOL_IDS = Object.freeze({
  'codex-cli': 'islemind.external-agent.codex-cli',
  'codex-desktop': 'islemind.external-agent.codex-desktop',
  'claude-code': 'islemind.external-agent.claude-code',
  'grok-cli': 'islemind.external-agent.grok-cli',
} as const satisfies Readonly<Record<ExternalAgentRuntimeProduct, string>>)

export type ExternalAgentRuntimeTaskToolId =
  typeof EXTERNAL_AGENT_RUNTIME_TASK_TOOL_IDS[ExternalAgentRuntimeProduct]

export interface ExternalAgentRuntimeDescriptor {
  readonly schema: typeof EXTERNAL_AGENT_RUNTIME_DESCRIPTOR_SCHEMA
  readonly id: string
  readonly product: ExternalAgentRuntimeProduct
  readonly name: string
  readonly version: string
  readonly protocol: ExternalAgentRuntimeProtocol
  readonly transport: ExternalAgentRuntimeTransport
  readonly sessionIdentityKind: ExternalAgentRuntimeSessionIdentityKind
  readonly supportsResume: boolean
  readonly requiredRuntimeCapabilities: readonly ExternalAgentRuntimeRequiredCapability[]
}

export interface ExternalAgentRuntimeVendorSessionIdentity {
  readonly kind: ExternalAgentRuntimeSessionIdentityKind
  readonly id: string
}

interface ExternalAgentRuntimeSessionRequestBase {
  readonly schema: typeof EXTERNAL_AGENT_RUNTIME_SESSION_REQUEST_SCHEMA
  readonly requestId: string
  readonly descriptorId: string
  readonly runtimeId: string
  readonly taskId: string
  readonly protocol: ExternalAgentRuntimeProtocol
  readonly instruction: string
  readonly createdAt: number
}

export interface ExternalAgentRuntimeOpenSessionRequest extends ExternalAgentRuntimeSessionRequestBase {
  readonly operation: 'open'
}

export interface ExternalAgentRuntimeResumeSessionRequest extends ExternalAgentRuntimeSessionRequestBase {
  readonly operation: 'resume'
  readonly vendorSession: ExternalAgentRuntimeVendorSessionIdentity
}

export type ExternalAgentRuntimeSessionRequest =
  | Readonly<ExternalAgentRuntimeOpenSessionRequest>
  | Readonly<ExternalAgentRuntimeResumeSessionRequest>

export interface ExternalAgentRuntimeSessionPort {
  open(request: ExternalAgentRuntimeOpenSessionRequest, signal: AbortSignal): Promise<unknown>
  resume(request: ExternalAgentRuntimeResumeSessionRequest, signal: AbortSignal): Promise<unknown>
}

interface ExternalAgentRuntimeSessionOutcomeBase {
  readonly schema: typeof EXTERNAL_AGENT_RUNTIME_SESSION_OUTCOME_SCHEMA
  readonly requestId: string
  readonly descriptorId: string
  readonly runtimeId: string
  readonly taskId: string
  readonly protocol: ExternalAgentRuntimeProtocol
  readonly operation: ExternalAgentRuntimeOperation
  readonly completedAt: number
}

export interface ExternalAgentRuntimeCompletedSessionOutcome extends ExternalAgentRuntimeSessionOutcomeBase {
  readonly status: 'completed'
  readonly vendorSession: ExternalAgentRuntimeVendorSessionIdentity
  readonly output: string
}

export interface ExternalAgentRuntimeFailedSessionOutcome extends ExternalAgentRuntimeSessionOutcomeBase {
  readonly status: 'failed' | 'cancelled'
  readonly error: Readonly<{
    code: string
    message: string
  }>
}

export type ExternalAgentRuntimeSessionOutcome =
  | Readonly<ExternalAgentRuntimeCompletedSessionOutcome>
  | Readonly<ExternalAgentRuntimeFailedSessionOutcome>
