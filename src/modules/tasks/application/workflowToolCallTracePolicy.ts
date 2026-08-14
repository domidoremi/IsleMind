export const WORKFLOW_TOOL_CALL_TRACE_CONTRACT = 'islemind.agent.tool-call-trace.v1'

export type WorkflowToolCallMode = 'native-provider' | 'tagged-json-fallback' | 'mcp-runtime'
export type WorkflowToolCallPermission = 'read-only' | 'read-write' | 'destructive'
export type WorkflowToolCallTraceStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'error'
  | 'skipped'
  | 'cancelled'

export interface WorkflowToolCallTraceMetadataInput {
  mode: WorkflowToolCallMode
  source: string
  toolName?: string
  toolId?: string
  serverId?: string
  permission?: WorkflowToolCallPermission
  status?: WorkflowToolCallTraceStatus
  errorCode?: string
  providerType?: string
}

export interface WorkflowToolCallTraceContractResult {
  ok: boolean
  errors: string[]
}

export interface WorkflowToolCallTraceShape {
  contract: typeof WORKFLOW_TOOL_CALL_TRACE_CONTRACT
  type: 'tool'
  toolName: string
  source: string
  status: WorkflowToolCallTraceStatus
  mode: WorkflowToolCallMode
  hasPermission: boolean
  hasServerId: boolean
  hasErrorCode: boolean
}

export interface WorkflowToolCallTraceLike {
  type: string
  status: WorkflowToolCallTraceStatus
  metadata?: Record<string, unknown>
}

export interface WorkflowToolCallTracePolicyDependencies {
  redactSensitiveText: (input: string) => string
  sanitizeTraceMetadataValue: (value: unknown) => unknown
}

export interface WorkflowToolCallTracePolicy {
  buildWorkflowToolCallTraceMetadata: (
    input: WorkflowToolCallTraceMetadataInput,
  ) => Record<string, unknown>
  inferWorkflowToolNameFromTraceContent: (title: string, content: string) => string
  validateWorkflowToolCallTraceContract: (
    trace: WorkflowToolCallTraceLike,
  ) => WorkflowToolCallTraceContractResult
  extractWorkflowToolCallTraceShape: (
    trace: WorkflowToolCallTraceLike,
  ) => WorkflowToolCallTraceShape | undefined
  equivalentWorkflowToolCallTraceShape: (
    left: WorkflowToolCallTraceLike,
    right: WorkflowToolCallTraceLike,
  ) => boolean
  stripWorkflowToolRequestBlocks: (output: string, tagName?: string) => string
  containsRawWorkflowToolRequestJson: (output: string, tagName?: string) => boolean
}

export function createWorkflowToolCallTracePolicy(
  dependencies: WorkflowToolCallTracePolicyDependencies,
): WorkflowToolCallTracePolicy {
  const sanitizeToolTraceText = (value: string): string => {
    return dependencies.redactSensitiveText(value).trim().slice(0, 160) || 'tool'
  }

  const buildWorkflowToolCallTraceMetadata = (
    input: WorkflowToolCallTraceMetadataInput,
  ): Record<string, unknown> => {
    const toolName = sanitizeToolTraceText(input.toolName || 'tool')
    const source = sanitizeToolTraceText(input.source || 'tool')
    const metadata: Record<string, unknown> = {
      toolCallContract: WORKFLOW_TOOL_CALL_TRACE_CONTRACT,
      toolCallMode: input.mode,
      toolCallSource: source,
      source,
      toolName,
    }
    if (input.toolId) metadata.toolId = sanitizeToolTraceText(input.toolId)
    if (input.serverId) metadata.serverId = sanitizeToolTraceText(input.serverId)
    if (input.permission) metadata.permission = input.permission
    if (input.status) metadata.toolCallStatus = input.status
    if (input.errorCode) metadata.errorCode = sanitizeToolTraceText(input.errorCode)
    if (input.providerType) metadata.providerType = sanitizeToolTraceText(input.providerType)
    return dependencies.sanitizeTraceMetadataValue(metadata) as Record<string, unknown>
  }

  const validateWorkflowToolCallTraceContract = (
    trace: WorkflowToolCallTraceLike,
  ): WorkflowToolCallTraceContractResult => {
    const errors: string[] = []
    const metadata = trace.metadata ?? {}
    if (trace.type !== 'tool') {
      errors.push('Agent tool-call trace contract applies only to tool traces.')
    }
    if (metadata.toolCallContract !== WORKFLOW_TOOL_CALL_TRACE_CONTRACT) {
      errors.push('Agent tool-call traces must record the contract id.')
    }
    if (!isWorkflowToolCallMode(metadata.toolCallMode)) {
      errors.push('Agent tool-call traces must record a known toolCallMode.')
    }
    if (typeof metadata.toolName !== 'string' || !metadata.toolName.trim()) {
      errors.push('Agent tool-call traces must record toolName.')
    }
    if (typeof metadata.toolCallSource !== 'string' || !metadata.toolCallSource.trim()) {
      errors.push('Agent tool-call traces must record toolCallSource.')
    }
    if (metadata.source !== metadata.toolCallSource) {
      errors.push('Agent tool-call trace source must match toolCallSource.')
    }
    if (
      metadata.toolCallStatus !== undefined
      && !isProcessTraceStatus(metadata.toolCallStatus)
    ) {
      errors.push('Agent tool-call trace toolCallStatus must be a known trace status.')
    }
    if (
      metadata.toolCallIndex !== undefined
      && !isNonNegativeInteger(metadata.toolCallIndex)
    ) {
      errors.push('Agent tool-call trace toolCallIndex must be a non-negative integer.')
    }
    if (
      metadata.maxToolCallsPerStep !== undefined
      && !isBoundedInteger(metadata.maxToolCallsPerStep, 1, 3)
    ) {
      errors.push('Agent tool-call trace maxToolCallsPerStep must be an integer from 1 to 3.')
    }
    if (
      metadata.requestedToolCallCount !== undefined
      && !isPositiveInteger(metadata.requestedToolCallCount)
    ) {
      errors.push('Agent tool-call trace requestedToolCallCount must be a positive integer.')
    }
    return {
      ok: errors.length === 0,
      errors,
    }
  }

  const extractWorkflowToolCallTraceShape = (
    trace: WorkflowToolCallTraceLike,
  ): WorkflowToolCallTraceShape | undefined => {
    const audit = validateWorkflowToolCallTraceContract(trace)
    if (!audit.ok) return undefined
    const metadata = trace.metadata ?? {}
    return {
      contract: WORKFLOW_TOOL_CALL_TRACE_CONTRACT,
      type: 'tool',
      toolName: String(metadata.toolName),
      source: String(metadata.toolCallSource),
      status: (metadata.toolCallStatus as WorkflowToolCallTraceStatus | undefined) ?? trace.status,
      mode: metadata.toolCallMode as WorkflowToolCallMode,
      hasPermission: typeof metadata.permission === 'string',
      hasServerId: typeof metadata.serverId === 'string'
        && metadata.serverId.trim().length > 0,
      hasErrorCode: typeof metadata.errorCode === 'string'
        && metadata.errorCode.trim().length > 0,
    }
  }

  const equivalentWorkflowToolCallTraceShape = (
    left: WorkflowToolCallTraceLike,
    right: WorkflowToolCallTraceLike,
  ): boolean => {
    const leftShape = extractWorkflowToolCallTraceShape(left)
    const rightShape = extractWorkflowToolCallTraceShape(right)
    if (!leftShape || !rightShape) return false
    return leftShape.contract === rightShape.contract
      && leftShape.type === rightShape.type
      && leftShape.toolName === rightShape.toolName
      && leftShape.status === rightShape.status
      && leftShape.hasPermission === rightShape.hasPermission
      && leftShape.hasServerId === rightShape.hasServerId
      && leftShape.hasErrorCode === rightShape.hasErrorCode
  }

  const stripWorkflowToolRequestBlocks = (
    output: string,
    tagName = 'islemind_mcp_call',
  ): string => {
    const escaped = escapeRegExp(tagName)
    const withoutTaggedBlocks = output
      .replace(new RegExp(`<${escaped}>[\\s\\S]*?</${escaped}>`, 'gi'), '')
      .trim()
    return looksLikeRawWorkflowToolRequestJson(withoutTaggedBlocks)
      ? ''
      : withoutTaggedBlocks
  }

  const containsRawWorkflowToolRequestJson = (
    output: string,
    tagName = 'islemind_mcp_call',
  ): boolean => {
    const text = output.trim()
    if (!text) return false
    const escaped = escapeRegExp(tagName)
    if (new RegExp(`<${escaped}>[\\s\\S]*?</${escaped}>`, 'i').test(text)) {
      return true
    }
    return looksLikeRawWorkflowToolRequestJson(text)
  }

  return {
    buildWorkflowToolCallTraceMetadata,
    inferWorkflowToolNameFromTraceContent,
    validateWorkflowToolCallTraceContract,
    extractWorkflowToolCallTraceShape,
    equivalentWorkflowToolCallTraceShape,
    stripWorkflowToolRequestBlocks,
    containsRawWorkflowToolRequestJson,
  }
}

function inferWorkflowToolNameFromTraceContent(title: string, content: string): string {
  const candidates = [
    content.match(/(?:tool|function|name|工具|関数|名称|名前)[^\n:：]*[:：]\s*([A-Za-z0-9_.:-]+)/i)?.[1],
    title.match(/(?:tool|function|工具|関数|名称|名前)[^\w.-]*([A-Za-z0-9_.:-]+)/i)?.[1],
  ].filter(Boolean) as string[]
  return candidates.find((item) => item.trim())?.trim() || 'provider_tool'
}

function looksLikeRawWorkflowToolRequestJson(text: string): boolean {
  if (!text.startsWith('{') || !text.endsWith('}')) return false
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const hasToolName = typeof parsed.tool === 'string'
      || typeof parsed.toolName === 'string'
      || typeof parsed.name === 'string'
    const hasArguments = parsed.arguments !== undefined
      || parsed.args !== undefined
      || parsed.input !== undefined
    return hasToolName && hasArguments
  } catch {
    return false
  }
}

function isWorkflowToolCallMode(value: unknown): value is WorkflowToolCallMode {
  return value === 'native-provider'
    || value === 'tagged-json-fallback'
    || value === 'mcp-runtime'
}

function isProcessTraceStatus(value: unknown): value is WorkflowToolCallTraceStatus {
  return value === 'pending'
    || value === 'running'
    || value === 'done'
    || value === 'error'
    || value === 'skipped'
    || value === 'cancelled'
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isBoundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= min
    && value <= max
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
