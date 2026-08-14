import type { WorkflowRuntimeFailureCode } from './workflowRuntimePolicy'

const TOOL_DETAIL_LIMIT = 900
const ANDROID_RAW_DETAIL_LIMIT = 700
const FAILURE_IDENTITY_LIMIT = 160
const FAILURE_NEXT_STEP_LIMIT = 240

export interface WorkflowFailureToolRequest {
  readonly toolId?: string
  readonly name?: string
  readonly source?: string
}

export interface WorkflowFailureDiagnostic {
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface WorkflowFailureObservation {
  readonly status?: string
  readonly output?: string
  readonly errorCode?: WorkflowRuntimeFailureCode
  readonly diagnostic?: WorkflowFailureDiagnostic
}

export interface WorkflowFailureStep {
  readonly status?: string
  readonly toolRequest?: WorkflowFailureToolRequest
  readonly observation?: WorkflowFailureObservation
}

export interface WorkflowFailurePolicyDependencies {
  redactText(value: string): string
  clampText(value: string, limit: number): string
}

export interface WorkflowFailurePolicy {
  formatFailureOutput(
    failureCode: WorkflowRuntimeFailureCode | undefined,
    finalOutput: string | undefined,
  ): string
  formatToolFailureDetails(step: WorkflowFailureStep | undefined): string
  resolveFailureNextStep(
    failureCode: WorkflowRuntimeFailureCode | undefined,
    finalOutput: string | undefined,
  ): string
  extractVisibleNextStep(value: string | undefined): string | undefined
  formatAndroidPartialFailureRecovery(detail: string): string[]
  buildFailureNextStep(failureCode: WorkflowRuntimeFailureCode | undefined): string
}

interface FailureStepSnapshot {
  readonly request?: WorkflowFailureToolRequest
  readonly output?: string
  readonly diagnosticMetadata?: {
    readonly toolId?: string
    readonly source?: string
  }
}

type DataPropertyResult =
  | { readonly ok: true; readonly present: false }
  | { readonly ok: true; readonly present: true; readonly value: unknown }
  | { readonly ok: false }

export function createWorkflowFailurePolicy(
  dependencies: WorkflowFailurePolicyDependencies,
): WorkflowFailurePolicy {
  const buildFailureNextStep = (
    failureCode: WorkflowRuntimeFailureCode | undefined,
  ): string => {
    switch (failureCode) {
      case 'provider_unavailable':
        return 'Configure an available provider, then retry the workflow.'
      case 'tool_unavailable':
        return 'Enable the tool or choose another available tool, then rerun the workflow.'
      case 'schema_invalid':
        return 'Fix the workflow definition or tool arguments, then rerun within the same permission limits.'
      case 'rag_unavailable':
        return 'Enable the RAG runtime or use a workflow that does not require retrieval.'
      case 'policy_denied':
        return 'Adjust the visible permission policy or choose a safer tool path.'
      case 'execution_failed':
      default:
        return 'Review the failed tool output, keep user state intact, and retry only the failed workflow path.'
    }
  }

  const extractVisibleNextStep = (value: string | undefined): string | undefined => {
    const match = value?.match(/^Next step:\s*(.+)$/im)
    return match?.[1]?.trim()
      ? dependencies.clampText(dependencies.redactText(match[1].trim()), FAILURE_NEXT_STEP_LIMIT)
      : undefined
  }

  const formatAndroidPartialFailureRecovery = (detail: string): string[] => {
    const parsed = parseJsonObject(detail)
    if (!parsed || readField(parsed, 'partialFailure') !== true) return []
    const failedOperationId = readString(readField(parsed, 'failedOperationId'))
    const applied = readNumber(readField(parsed, 'applied'))
    const skipped = readNumber(readField(parsed, 'skipped'))
    const failureCount = readNumber(readField(parsed, 'failureCount'))
    const undoCount = readArray(readField(parsed, 'undoOperations'))?.length ?? 0
    const nextStep = readString(readField(parsed, 'nextStep'))
    return [
      'Android partial file operation failure.',
      applied !== undefined ? `Applied before failure: ${applied}` : '',
      skipped !== undefined ? `Skipped operations: ${skipped}` : '',
      failureCount !== undefined ? `Failed operations: ${failureCount}` : '',
      failedOperationId
        ? `Failed operation: ${dependencies.clampText(dependencies.redactText(failedOperationId), FAILURE_IDENTITY_LIMIT)}`
        : '',
      undoCount ? `Undo operations available: ${undoCount}` : '',
      undoCount ? 'Undo requires visible confirmation through android.files.undo_operations.' : '',
      readField(parsed, 'deleteSupported') === false ? 'Delete-based rollback remains unsupported.' : '',
      `Next step: ${dependencies.clampText(
        dependencies.redactText(nextStep || buildFailureNextStep('execution_failed')),
        FAILURE_NEXT_STEP_LIMIT,
      )}`,
    ].filter(Boolean)
  }

  const formatFailureOutput = (
    failureCode: WorkflowRuntimeFailureCode | undefined,
    finalOutput: string | undefined,
  ): string => {
    const body = dependencies.redactText(finalOutput?.trim() || 'No failure details were returned.')
    if (/^Agentic workflow failed\./m.test(body) && /Next step:/i.test(body)) return body
    const reason = failureCode ?? 'execution_failed'
    const existingNextStep = extractVisibleNextStep(body)
    return [
      'Agentic workflow failed.',
      `Reason: ${reason}`,
      '',
      body,
      '',
      existingNextStep ? '' : `Next step: ${buildFailureNextStep(reason)}`,
    ].filter(Boolean).join('\n')
  }

  const formatToolFailureDetails = (step: WorkflowFailureStep | undefined): string => {
    const snapshot = snapshotFailureStep(step)
    const toolName = snapshot.request?.name
      ?? snapshot.request?.toolId
      ?? snapshot.diagnosticMetadata?.toolId
    const toolSource = snapshot.request?.source ?? snapshot.diagnosticMetadata?.source
    const detail = snapshot.output?.trim() || 'Tool execution returned no detail.'
    const androidRecovery = formatAndroidPartialFailureRecovery(detail)
    return [
      toolName ? `Tool: ${toolName}` : '',
      toolSource ? `Source: ${toolSource}` : '',
      ...androidRecovery,
      `${androidRecovery.length ? 'Raw detail' : 'Detail'}: ${dependencies.clampText(
        dependencies.redactText(detail),
        androidRecovery.length ? ANDROID_RAW_DETAIL_LIMIT : TOOL_DETAIL_LIMIT,
      )}`,
    ].filter(Boolean).join('\n')
  }

  const resolveFailureNextStep = (
    failureCode: WorkflowRuntimeFailureCode | undefined,
    finalOutput: string | undefined,
  ): string => extractVisibleNextStep(finalOutput) ?? buildFailureNextStep(failureCode)

  return {
    formatFailureOutput,
    formatToolFailureDetails,
    resolveFailureNextStep,
    extractVisibleNextStep,
    formatAndroidPartialFailureRecovery,
    buildFailureNextStep,
  }
}

function snapshotFailureStep(step: WorkflowFailureStep | undefined): FailureStepSnapshot {
  const requestProperty = readDataProperty(step, 'toolRequest')
  if (!requestProperty.ok) return {}
  const observationProperty = readDataProperty(step, 'observation')
  if (!observationProperty.ok) return {}
  const request = requestProperty.present ? snapshotRequest(requestProperty.value) : undefined
  const observation = observationProperty.present
    ? snapshotObservation(observationProperty.value)
    : undefined
  return {
    ...(request ? { request } : {}),
    ...(observation?.output !== undefined ? { output: observation.output } : {}),
    ...(observation?.diagnosticMetadata
      ? { diagnosticMetadata: observation.diagnosticMetadata }
      : {}),
  }
}

function snapshotRequest(value: unknown): WorkflowFailureToolRequest | undefined {
  if (!isObject(value)) return undefined
  const toolId = readOptionalDataString(value, 'toolId')
  const name = readOptionalDataString(value, 'name')
  const source = readOptionalDataString(value, 'source')
  if (!toolId.ok || !name.ok || !source.ok) return undefined
  return {
    ...(toolId.value !== undefined ? { toolId: toolId.value } : {}),
    ...(name.value !== undefined ? { name: name.value } : {}),
    ...(source.value !== undefined ? { source: source.value } : {}),
  }
}

function snapshotObservation(value: unknown): {
  readonly output?: string
  readonly diagnosticMetadata?: FailureStepSnapshot['diagnosticMetadata']
} | undefined {
  if (!isObject(value)) return undefined
  const output = readOptionalDataString(value, 'output')
  const diagnostic = readDataProperty(value, 'diagnostic')
  if (!output.ok || !diagnostic.ok) return undefined
  const diagnosticMetadata = diagnostic.present
    ? snapshotDiagnosticMetadata(diagnostic.value)
    : undefined
  return {
    ...(output.value !== undefined ? { output: output.value } : {}),
    ...(diagnosticMetadata ? { diagnosticMetadata } : {}),
  }
}

function snapshotDiagnosticMetadata(
  value: unknown,
): FailureStepSnapshot['diagnosticMetadata'] | undefined {
  if (!isObject(value)) return undefined
  const metadata = readDataProperty(value, 'metadata')
  if (!metadata.ok || !metadata.present || !isObject(metadata.value)) return undefined
  const toolId = readOptionalDataString(metadata.value, 'toolId')
  const source = readOptionalDataString(metadata.value, 'source')
  if (!toolId.ok || !source.ok) return undefined
  return {
    ...(toolId.value !== undefined ? { toolId: toolId.value } : {}),
    ...(source.value !== undefined ? { source: source.value } : {}),
  }
}

function readOptionalDataString(
  value: object,
  key: string,
): { readonly ok: true; readonly value?: string } | { readonly ok: false } {
  const property = readDataProperty(value, key)
  if (!property.ok) return { ok: false }
  if (!property.present || property.value === undefined) return { ok: true }
  return typeof property.value === 'string'
    ? { ok: true, value: property.value }
    : { ok: true }
}

function readDataProperty(value: unknown, key: string): DataPropertyResult {
  if (!isObject(value)) return { ok: true, present: false }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor) return { ok: true, present: false }
    if (!('value' in descriptor)) return { ok: false }
    return { ok: true, present: true, value: descriptor.value }
  } catch {
    return { ok: false }
  }
}

function parseJsonObject(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    return isPlainRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function readField(value: Record<string, unknown>, key: string): unknown {
  const property = readDataProperty(value, key)
  return property.ok && property.present ? property.value : undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isObject(value) || Array.isArray(value)) return false
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}
