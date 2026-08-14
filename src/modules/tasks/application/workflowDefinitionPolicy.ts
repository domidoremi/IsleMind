export const LEGACY_WORKFLOW_DEFINITION_SCHEMA = 'islemind.agent.workflow.v1'
export const WORKFLOW_DEFINITION_SCHEMA = 'islemind.workflow.v2'

export type WorkflowDefinitionPermission = 'read-only' | 'read-write' | 'destructive'

export type WorkflowDefinitionToolSource =
  | 'mcp'
  | 'builtin'
  | 'app-action'
  | 'rag'
  | 'search'
  | 'work-artifact'
  | 'android'

export type WorkflowDefinitionExpectedOutput =
  | 'reply'
  | 'rag-evidence'
  | 'work-artifact'
  | 'handoff'
  | 'diagnostic'

export interface WorkflowDefinitionToolRequest {
  readonly toolId?: string
  readonly name?: string
  readonly source?: WorkflowDefinitionToolSource
  readonly serverId?: string
  readonly arguments?: Readonly<Record<string, unknown>>
}

export interface WorkflowDefinitionToolManifest {
  readonly id: string
  readonly source: WorkflowDefinitionToolSource
  readonly name: string
  readonly description: string
  readonly permission: WorkflowDefinitionPermission
  readonly enabled: boolean
  readonly serverId?: string
}

export interface WorkflowDefinitionStep {
  readonly id: string
  readonly title: string
  readonly toolRequest?: WorkflowDefinitionToolRequest
  readonly acceptance?: readonly string[]
}

export interface WorkflowDefinitionRecord {
  readonly schema: typeof WORKFLOW_DEFINITION_SCHEMA
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly enabled: boolean
  readonly triggerHints: readonly string[]
  readonly steps: readonly WorkflowDefinitionStep[]
  readonly permissionCeiling: WorkflowDefinitionPermission
  readonly expectedOutput?: WorkflowDefinitionExpectedOutput
  readonly acceptanceChecks: readonly string[]
  readonly createdAt: number
  readonly updatedAt: number
}

export interface WorkflowDefinitionDecodeSuccess {
  readonly ok: true
  readonly definition: WorkflowDefinitionRecord
  readonly sourceSchema:
    | typeof LEGACY_WORKFLOW_DEFINITION_SCHEMA
    | typeof WORKFLOW_DEFINITION_SCHEMA
  readonly requiresRewrite: boolean
}

export interface WorkflowDefinitionDecodeFailure {
  readonly ok: false
  readonly errors: readonly string[]
  readonly sourceSchema?: string
}

export type WorkflowDefinitionDecodeResult =
  | WorkflowDefinitionDecodeSuccess
  | WorkflowDefinitionDecodeFailure

export interface WorkflowDefinitionValidationResult {
  readonly ok: boolean
  readonly errors: readonly string[]
  readonly warnings: readonly string[]
  readonly definition?: WorkflowDefinitionRecord
  readonly sourceSchema?: WorkflowDefinitionDecodeSuccess['sourceSchema']
  readonly requiresRewrite?: boolean
}

export interface CreateWorkflowDefinitionInput {
  readonly id?: string
  readonly name: string
  readonly description?: string
  readonly enabled?: boolean
  readonly triggerHints?: readonly string[]
  readonly steps: readonly WorkflowDefinitionStep[]
  readonly permissionCeiling?: WorkflowDefinitionPermission
  readonly expectedOutput?: WorkflowDefinitionExpectedOutput
  readonly acceptanceChecks?: readonly string[]
  readonly now?: number
}

export interface WorkflowDefinitionDecoderDependencies {
  redactSensitiveText(input: string): string
}

export interface WorkflowDefinitionPolicyDependencies
  extends WorkflowDefinitionDecoderDependencies {
  readonly clock: {
    now(): number
  }
  generateIdSuffix(): string
  resolveUniqueManifest?(
    request: WorkflowDefinitionToolRequest,
    manifests: readonly WorkflowDefinitionToolManifest[],
  ): WorkflowDefinitionToolManifest | null | undefined
}

export interface WorkflowDefinitionPolicy {
  create(input: CreateWorkflowDefinitionInput): WorkflowDefinitionRecord
  decode(input: unknown): WorkflowDefinitionDecodeResult
  validate(
    definition: unknown,
    manifests: readonly WorkflowDefinitionToolManifest[],
  ): WorkflowDefinitionValidationResult
  serialize(definition: WorkflowDefinitionRecord): string
  permissionWithinCeiling(
    permission: WorkflowDefinitionPermission,
    ceiling: WorkflowDefinitionPermission,
  ): boolean
}

const WORK_ARTIFACT_QUALITY_AUDIT_ACCEPTANCE = 'quality audit passes'
const RAG_EVIDENCE_ACCEPTANCE = 'citation evidence present'
const ELEVATED_PERMISSION_GATE_ACCEPTANCE = 'visible permission gate required'
const WORKFLOW_DEFINITION_TEXT_LIMIT = 2000
const TOOL_IDENTITY_TEXT_LIMIT = 240
const WORKFLOW_DEFINITION_PAYLOAD_CHAR_LIMIT = 24000
const WORKFLOW_DEFINITION_NODE_LIMIT = 4096
const WORKFLOW_DEFINITION_ARRAY_ITEM_LIMIT = 1024
const ARGUMENT_MAX_DEPTH = 8
const BLOCKED_ARGUMENT_EXECUTION_RISK = '[blocked: arbitrary execution risk]'

const PERMISSION_RANK: Readonly<Record<WorkflowDefinitionPermission, number>> = Object.freeze({
  'read-only': 0,
  'read-write': 1,
  destructive: 2,
})

const TOOL_SOURCES = new Set<WorkflowDefinitionToolSource>([
  'mcp',
  'builtin',
  'app-action',
  'rag',
  'search',
  'work-artifact',
  'android',
])

const EXPECTED_OUTPUTS = new Set<WorkflowDefinitionExpectedOutput>([
  'reply',
  'rag-evidence',
  'work-artifact',
  'handoff',
  'diagnostic',
])

const ARBITRARY_EXECUTION_PATTERNS = [
  /\b(shell|terminal|powershell|cmd\.exe|bash|exec|spawn|eval|adb shell)\b/i,
  /\bdelete all\b/i,
  /彻底删除|永久删除|执行代码|运行命令|系统控制/,
]

const SENSITIVE_ARGUMENT_KEY_PATTERN = /(api[_-]?key|authorization|password|secret|token)/i
const DANGEROUS_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const ABSENT_PROPERTY = Symbol('absent-workflow-definition-property')

const DEFINITION_KEYS = new Set([
  'schema',
  'id',
  'name',
  'description',
  'enabled',
  'triggerHints',
  'steps',
  'permissionCeiling',
  'expectedOutput',
  'acceptanceChecks',
  'createdAt',
  'updatedAt',
])

const STEP_KEYS = new Set(['id', 'title', 'toolRequest', 'acceptance'])
const TOOL_REQUEST_KEYS = new Set(['toolId', 'name', 'source', 'serverId', 'arguments'])

interface DecodeContext {
  readonly dependencies: WorkflowDefinitionDecoderDependencies
  nodeCount: number
}

class DecodeFailure extends Error {}

export function decodeWorkflowDefinition(
  input: unknown,
  dependencies: WorkflowDefinitionDecoderDependencies,
): WorkflowDefinitionDecodeResult {
  let sourceSchema: string | undefined
  try {
    const context: DecodeContext = { dependencies, nodeCount: 0 }
    const record = inspectObject(input, 'workflow', DEFINITION_KEYS, context)
    const rawSchema = readRequired(record, 'schema', 'workflow.schema')
    if (typeof rawSchema === 'string') sourceSchema = rawSchema
    if (
      rawSchema !== LEGACY_WORKFLOW_DEFINITION_SCHEMA
      && rawSchema !== WORKFLOW_DEFINITION_SCHEMA
    ) {
      throw new DecodeFailure(
        `workflow.schema must be ${LEGACY_WORKFLOW_DEFINITION_SCHEMA} or ${WORKFLOW_DEFINITION_SCHEMA}.`,
      )
    }

    const id = decodeText(readRequired(record, 'id', 'workflow.id'), 'workflow.id', context)
    const name = decodeText(readRequired(record, 'name', 'workflow.name'), 'workflow.name', context)
    const rawDescription = readOptional(record, 'description')
    const description = rawDescription === ABSENT_PROPERTY
      ? undefined
      : decodeText(rawDescription, 'workflow.description', context) || undefined
    const enabled = decodeBoolean(
      readRequired(record, 'enabled', 'workflow.enabled'),
      'workflow.enabled',
      context,
    )
    const triggerHints = decodeTextList(
      readRequired(record, 'triggerHints', 'workflow.triggerHints'),
      'workflow.triggerHints',
      context,
    )
    const steps = decodeSteps(
      readRequired(record, 'steps', 'workflow.steps'),
      context,
    )
    const permissionCeiling = decodePermission(
      readRequired(record, 'permissionCeiling', 'workflow.permissionCeiling'),
      'workflow.permissionCeiling',
      context,
    )
    const rawExpectedOutput = readOptional(record, 'expectedOutput')
    const explicitExpectedOutput = rawExpectedOutput === ABSENT_PROPERTY
      ? undefined
      : decodeExpectedOutput(rawExpectedOutput, 'workflow.expectedOutput', context)
    const expectedOutput = explicitExpectedOutput ?? (
      usesRagContextPack(steps) ? 'rag-evidence' : undefined
    )
    const decodedAcceptanceChecks = decodeTextList(
      readRequired(record, 'acceptanceChecks', 'workflow.acceptanceChecks'),
      'workflow.acceptanceChecks',
      context,
    )
    const acceptanceChecks = normalizeWorkflowAcceptanceChecks(
      expectedOutput,
      decodedAcceptanceChecks,
      steps,
      permissionCeiling,
    )
    const createdAt = decodeTimestamp(
      readRequired(record, 'createdAt', 'workflow.createdAt'),
      'workflow.createdAt',
      context,
    )
    const updatedAt = decodeTimestamp(
      readRequired(record, 'updatedAt', 'workflow.updatedAt'),
      'workflow.updatedAt',
      context,
    )

    const definition: WorkflowDefinitionRecord = Object.freeze({
      schema: WORKFLOW_DEFINITION_SCHEMA,
      id,
      name,
      ...(description ? { description } : {}),
      enabled,
      triggerHints,
      steps,
      permissionCeiling,
      ...(expectedOutput ? { expectedOutput } : {}),
      acceptanceChecks,
      createdAt,
      updatedAt,
    })
    const serialized = JSON.stringify(definition)
    if (serialized.length > WORKFLOW_DEFINITION_PAYLOAD_CHAR_LIMIT) {
      throw new DecodeFailure('workflow definition exceeds the payload limit.')
    }

    return Object.freeze({
      ok: true,
      definition,
      sourceSchema: rawSchema,
      requiresRewrite: rawSchema === LEGACY_WORKFLOW_DEFINITION_SCHEMA,
    })
  } catch (error) {
    const message = error instanceof DecodeFailure
      ? error.message
      : 'workflow definition contains unreadable or hostile data.'
    return Object.freeze({
      ok: false,
      errors: Object.freeze([message]),
      ...(sourceSchema ? { sourceSchema } : {}),
    })
  }
}

export function createWorkflowDefinitionPolicy(
  dependencies: WorkflowDefinitionPolicyDependencies,
): WorkflowDefinitionPolicy {
  function decode(input: unknown): WorkflowDefinitionDecodeResult {
    return decodeWorkflowDefinition(input, dependencies)
  }

  function create(input: CreateWorkflowDefinitionInput): WorkflowDefinitionRecord {
    const now = input.now ?? dependencies.clock.now()
    const raw = {
      schema: WORKFLOW_DEFINITION_SCHEMA,
      id: input.id ?? `agent-workflow-${now}-${dependencies.generateIdSuffix()}`,
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      enabled: input.enabled ?? true,
      triggerHints: [...(input.triggerHints ?? [])],
      steps: input.steps.map((step, index) => ({
        id: step.id || `step-${index + 1}`,
        title: step.title,
        ...(step.toolRequest ? { toolRequest: copyToolRequestInput(step.toolRequest) } : {}),
        acceptance: [...(step.acceptance ?? [])],
      })),
      permissionCeiling: input.permissionCeiling ?? 'read-only',
      ...(input.expectedOutput !== undefined ? { expectedOutput: input.expectedOutput } : {}),
      acceptanceChecks: [...(input.acceptanceChecks ?? [])],
      createdAt: now,
      updatedAt: now,
    }
    const result = decode(raw)
    if (!result.ok) throw new TypeError('Workflow definition input is invalid.')
    return result.definition
  }

  function validate(
    input: unknown,
    manifests: readonly WorkflowDefinitionToolManifest[],
  ): WorkflowDefinitionValidationResult {
    const decoded = decode(input)
    if (!decoded.ok) {
      return Object.freeze({
        ok: false,
        errors: decoded.errors,
        warnings: Object.freeze([]),
      })
    }

    const definition = decoded.definition
    const errors: string[] = []
    const warnings: string[] = []
    if (!definition.id.trim()) errors.push('id is required.')
    if (!definition.name.trim()) errors.push('name is required.')
    if (!definition.steps.length) errors.push('at least one workflow step is required.')

    definition.steps.forEach((step, index) => {
      if (!step.id.trim()) errors.push(`steps[${index}].id is required.`)
      if (!step.title.trim()) errors.push(`steps[${index}].title is required.`)
      if (containsArbitraryExecutionRisk(step.title)) {
        errors.push(`steps[${index}].title contains arbitrary execution risk.`)
      }
      if (!step.toolRequest) {
        warnings.push(`steps[${index}] has no tool request.`)
        return
      }
      if (workflowToolIdentityNeedsReview(step.toolRequest)) {
        errors.push(`steps[${index}].toolRequest tool identity contains sensitive or truncated text.`)
      }
      const tool = dependencies.resolveUniqueManifest?.(step.toolRequest, manifests) ?? undefined
      if (!tool) {
        errors.push(`steps[${index}] references an unavailable tool.`)
        return
      }
      if (!tool.enabled) errors.push(`steps[${index}] references a disabled tool.`)
      if (!permissionWithinCeiling(tool.permission, definition.permissionCeiling)) {
        errors.push(`steps[${index}] exceeds permission ceiling ${definition.permissionCeiling}.`)
      }
      if (containsArbitraryExecutionRisk(`${tool.name} ${tool.description}`)) {
        errors.push(`steps[${index}] references a tool with arbitrary execution risk.`)
      }
      const argumentText = JSON.stringify(step.toolRequest.arguments ?? {})
      if (
        argumentText.includes(BLOCKED_ARGUMENT_EXECUTION_RISK)
        || containsArbitraryExecutionRisk(argumentText)
      ) {
        errors.push(`steps[${index}].toolRequest.arguments contain arbitrary execution risk.`)
      }
    })

    if (definition.expectedOutput === 'rag-evidence' && !usesRagContextPack(definition.steps)) {
      errors.push('rag-evidence workflows must include rag:context_pack evidence retrieval.')
    }
    const serialized = JSON.stringify(definition)
    if (serialized.includes('[redacted]')) warnings.push('sensitive text was redacted.')
    if (containsArbitraryExecutionRisk(
      `${definition.name} ${definition.description ?? ''} ${definition.triggerHints.join(' ')} ${definition.acceptanceChecks.join(' ')}`,
    )) {
      errors.push('workflow definition contains arbitrary execution risk.')
    }

    return Object.freeze({
      ok: errors.length === 0,
      errors: Object.freeze(errors),
      warnings: Object.freeze(warnings),
      definition,
      sourceSchema: decoded.sourceSchema,
      requiresRewrite: decoded.requiresRewrite,
    })
  }

  function serialize(definition: WorkflowDefinitionRecord): string {
    const decoded = decode(definition)
    if (!decoded.ok) throw new TypeError('Workflow definition cannot be serialized.')
    return `${JSON.stringify(decoded.definition, null, 2)}\n`
  }

  function permissionWithinCeiling(
    permission: WorkflowDefinitionPermission,
    ceiling: WorkflowDefinitionPermission,
  ): boolean {
    return PERMISSION_RANK[permission] <= PERMISSION_RANK[ceiling]
  }

  return Object.freeze({
    create,
    decode,
    validate,
    serialize,
    permissionWithinCeiling,
  })
}

function copyToolRequestInput(
  request: WorkflowDefinitionToolRequest,
): Record<string, unknown> {
  return {
    ...(request.toolId !== undefined ? { toolId: request.toolId } : {}),
    ...(request.name !== undefined ? { name: request.name } : {}),
    ...(request.source !== undefined ? { source: request.source } : {}),
    ...(request.serverId !== undefined ? { serverId: request.serverId } : {}),
    ...(request.arguments !== undefined ? { arguments: request.arguments } : {}),
  }
}

function inspectObject(
  value: unknown,
  path: string,
  allowedKeys: ReadonlySet<string> | undefined,
  context: DecodeContext,
): ReadonlyMap<string, unknown> {
  consumeNode(context)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DecodeFailure(`${path} must be an object.`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new DecodeFailure(`${path} must be a plain object.`)
  }
  const keys = Reflect.ownKeys(value)
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<
    string,
    PropertyDescriptor | undefined
  >
  const result = new Map<string, unknown>()
  for (const key of keys) {
    if (typeof key !== 'string') throw new DecodeFailure(`${path} contains a symbol key.`)
    if (DANGEROUS_OBJECT_KEYS.has(key)) {
      throw new DecodeFailure(`${path}.${key} is not allowed.`)
    }
    if (allowedKeys && !allowedKeys.has(key)) {
      throw new DecodeFailure(`${path}.${key} is not allowed.`)
    }
    const descriptor = descriptors[key]
    if (!descriptor || !('value' in descriptor)) {
      throw new DecodeFailure(`${path}.${key} must be a data property.`)
    }
    if (!descriptor.enumerable) {
      throw new DecodeFailure(`${path}.${key} must be enumerable.`)
    }
    result.set(key, descriptor.value)
  }
  return result
}

function inspectArray(
  value: unknown,
  path: string,
  context: DecodeContext,
): readonly unknown[] {
  consumeNode(context)
  if (!Array.isArray(value)) throw new DecodeFailure(`${path} must be an array.`)
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new DecodeFailure(`${path} must be a plain array.`)
  }
  const keys = Reflect.ownKeys(value)
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<
    string,
    PropertyDescriptor | undefined
  >
  const lengthDescriptor: PropertyDescriptor | undefined = descriptors.length
  if (!lengthDescriptor || !('value' in lengthDescriptor)) {
    throw new DecodeFailure(`${path}.length must be a data property.`)
  }
  const lengthValue: unknown = lengthDescriptor.value
  if (
    typeof lengthValue !== 'number'
    || !Number.isSafeInteger(lengthValue)
    || lengthValue < 0
    || lengthValue > WORKFLOW_DEFINITION_ARRAY_ITEM_LIMIT
  ) {
    throw new DecodeFailure(`${path} exceeds the array item limit.`)
  }
  const length = lengthValue
  for (const key of keys) {
    if (typeof key !== 'string') throw new DecodeFailure(`${path} contains a symbol key.`)
    if (key === 'length') continue
    const index = Number(key)
    if (!Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== key) {
      throw new DecodeFailure(`${path}.${key} is not an array index.`)
    }
    const descriptor = descriptors[key]
    if (!descriptor || !('value' in descriptor)) {
      throw new DecodeFailure(`${path}[${key}] must be a data property.`)
    }
    if (!descriptor.enumerable) {
      throw new DecodeFailure(`${path}[${key}] must be enumerable.`)
    }
  }
  const result: unknown[] = []
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)]
    if (!descriptor || !('value' in descriptor)) {
      throw new DecodeFailure(`${path} must not be sparse.`)
    }
    result.push(descriptor.value)
  }
  return result
}

function decodeSteps(value: unknown, context: DecodeContext): readonly WorkflowDefinitionStep[] {
  const rawSteps = inspectArray(value, 'workflow.steps', context)
  const steps = rawSteps.map((rawStep, index) => {
    const path = `workflow.steps[${index}]`
    const step = inspectObject(rawStep, path, STEP_KEYS, context)
    const id = decodeText(readRequired(step, 'id', `${path}.id`), `${path}.id`, context)
    const title = decodeText(readRequired(step, 'title', `${path}.title`), `${path}.title`, context)
    const rawToolRequest = readOptional(step, 'toolRequest')
    const toolRequest = rawToolRequest === ABSENT_PROPERTY
      ? undefined
      : decodeToolRequest(rawToolRequest, `${path}.toolRequest`, context)
    const rawAcceptance = readOptional(step, 'acceptance')
    const acceptance = rawAcceptance === ABSENT_PROPERTY
      ? Object.freeze([] as string[])
      : decodeTextList(rawAcceptance, `${path}.acceptance`, context)
    return Object.freeze({
      id,
      title,
      ...(toolRequest ? { toolRequest } : {}),
      acceptance,
    })
  })
  return Object.freeze(steps)
}

function decodeToolRequest(
  value: unknown,
  path: string,
  context: DecodeContext,
): WorkflowDefinitionToolRequest {
  const request = inspectObject(value, path, TOOL_REQUEST_KEYS, context)
  const rawToolId = readOptional(request, 'toolId')
  const rawName = readOptional(request, 'name')
  const rawSource = readOptional(request, 'source')
  const rawServerId = readOptional(request, 'serverId')
  const rawArguments = readOptional(request, 'arguments')
  const toolId = rawToolId === ABSENT_PROPERTY ? undefined : decodeToolIdentity(rawToolId, `${path}.toolId`, context)
  const name = rawName === ABSENT_PROPERTY ? undefined : decodeToolIdentity(rawName, `${path}.name`, context)
  const source = rawSource === ABSENT_PROPERTY ? undefined : decodeToolSource(rawSource, `${path}.source`, context)
  const serverId = rawServerId === ABSENT_PROPERTY
    ? undefined
    : decodeToolIdentity(rawServerId, `${path}.serverId`, context)
  const args = rawArguments === ABSENT_PROPERTY
    ? undefined
    : decodeArgumentObject(rawArguments, `${path}.arguments`, context, 0)
  return Object.freeze({
    ...(toolId !== undefined ? { toolId } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(source !== undefined ? { source } : {}),
    ...(serverId !== undefined ? { serverId } : {}),
    ...(args !== undefined ? { arguments: args } : {}),
  })
}

function decodeArgumentObject(
  value: unknown,
  path: string,
  context: DecodeContext,
  depth: number,
): Readonly<Record<string, unknown>> {
  if (depth > ARGUMENT_MAX_DEPTH) throw new DecodeFailure(`${path} exceeds the argument depth limit.`)
  const record = inspectObject(value, path, undefined, context)
  const result: Record<string, unknown> = {}
  for (const [key, nestedValue] of record) {
    const decoded = decodeArgumentValue(nestedValue, `${path}.${key}`, context, depth + 1)
    result[key] = SENSITIVE_ARGUMENT_KEY_PATTERN.test(key) ? '[redacted]' : decoded
  }
  return Object.freeze(result)
}

function decodeArgumentValue(
  value: unknown,
  path: string,
  context: DecodeContext,
  depth: number,
): unknown {
  if (depth > ARGUMENT_MAX_DEPTH) throw new DecodeFailure(`${path} exceeds the argument depth limit.`)
  if (value === null) {
    consumeNode(context)
    return null
  }
  if (typeof value === 'string') {
    const cleaned = decodeText(value, path, context)
    return containsArbitraryExecutionRisk(cleaned) ? BLOCKED_ARGUMENT_EXECUTION_RISK : cleaned
  }
  if (typeof value === 'boolean') {
    consumeNode(context)
    return value
  }
  if (typeof value === 'number') {
    consumeNode(context)
    if (!Number.isFinite(value)) throw new DecodeFailure(`${path} must be finite.`)
    return value
  }
  if (Array.isArray(value)) {
    const values = inspectArray(value, path, context)
    return Object.freeze(values.map((item, index) => (
      decodeArgumentValue(item, `${path}[${index}]`, context, depth + 1)
    )))
  }
  if (value && typeof value === 'object') {
    return decodeArgumentObject(value, path, context, depth)
  }
  throw new DecodeFailure(`${path} contains an unsupported JSON value.`)
}

function decodeTextList(
  value: unknown,
  path: string,
  context: DecodeContext,
): readonly string[] {
  const values = inspectArray(value, path, context)
  const decoded = values
    .map((item, index) => decodeText(item, `${path}[${index}]`, context))
    .filter(Boolean)
  return Object.freeze(decoded)
}

function decodeText(value: unknown, path: string, context: DecodeContext): string {
  consumeNode(context)
  if (typeof value !== 'string') throw new DecodeFailure(`${path} must be a string.`)
  const redacted = context.dependencies.redactSensitiveText(value.trim())
  if (typeof redacted !== 'string') throw new DecodeFailure(`${path} could not be redacted safely.`)
  return redacted.slice(0, WORKFLOW_DEFINITION_TEXT_LIMIT)
}

function decodeToolIdentity(value: unknown, path: string, context: DecodeContext): string {
  const cleaned = decodeText(value, path, context).replace(/\s+/g, ' ')
  if (cleaned.length <= TOOL_IDENTITY_TEXT_LIMIT) return cleaned
  const marker = '[output truncated]'
  return `${cleaned.slice(0, Math.max(0, TOOL_IDENTITY_TEXT_LIMIT - marker.length - 1))} ${marker}`.trim()
}

function decodeBoolean(value: unknown, path: string, context: DecodeContext): boolean {
  consumeNode(context)
  if (typeof value !== 'boolean') throw new DecodeFailure(`${path} must be a boolean.`)
  return value
}

function decodeTimestamp(value: unknown, path: string, context: DecodeContext): number {
  consumeNode(context)
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new DecodeFailure(`${path} must be a finite nonnegative number.`)
  }
  return value
}

function decodePermission(
  value: unknown,
  path: string,
  context: DecodeContext,
): WorkflowDefinitionPermission {
  consumeNode(context)
  if (value !== 'read-only' && value !== 'read-write' && value !== 'destructive') {
    throw new DecodeFailure(`${path} is invalid.`)
  }
  return value
}

function decodeToolSource(
  value: unknown,
  path: string,
  context: DecodeContext,
): WorkflowDefinitionToolSource {
  consumeNode(context)
  if (typeof value !== 'string' || !TOOL_SOURCES.has(value as WorkflowDefinitionToolSource)) {
    throw new DecodeFailure(`${path} is invalid.`)
  }
  return value as WorkflowDefinitionToolSource
}

function decodeExpectedOutput(
  value: unknown,
  path: string,
  context: DecodeContext,
): WorkflowDefinitionExpectedOutput {
  consumeNode(context)
  if (typeof value !== 'string' || !EXPECTED_OUTPUTS.has(value as WorkflowDefinitionExpectedOutput)) {
    throw new DecodeFailure(`${path} is invalid.`)
  }
  return value as WorkflowDefinitionExpectedOutput
}

function readRequired(
  record: ReadonlyMap<string, unknown>,
  key: string,
  path: string,
): unknown {
  if (!record.has(key)) throw new DecodeFailure(`${path} is required.`)
  return record.get(key)
}

function readOptional(
  record: ReadonlyMap<string, unknown>,
  key: string,
): unknown | typeof ABSENT_PROPERTY {
  return record.has(key) ? record.get(key) : ABSENT_PROPERTY
}

function consumeNode(context: DecodeContext): void {
  context.nodeCount += 1
  if (context.nodeCount > WORKFLOW_DEFINITION_NODE_LIMIT) {
    throw new DecodeFailure('workflow definition exceeds the node limit.')
  }
}

function normalizeWorkflowAcceptanceChecks(
  expectedOutput: WorkflowDefinitionExpectedOutput | undefined,
  checks: readonly string[],
  steps: readonly WorkflowDefinitionStep[],
  permissionCeiling: WorkflowDefinitionPermission,
): readonly string[] {
  const values = [...checks]
  if (expectedOutput === 'work-artifact' && !values.includes(WORK_ARTIFACT_QUALITY_AUDIT_ACCEPTANCE)) {
    values.push(WORK_ARTIFACT_QUALITY_AUDIT_ACCEPTANCE)
  }
  if (
    (expectedOutput === 'rag-evidence' || usesRagContextPack(steps))
    && !values.includes(RAG_EVIDENCE_ACCEPTANCE)
  ) {
    values.push(RAG_EVIDENCE_ACCEPTANCE)
  }
  if (
    permissionCeiling !== 'read-only'
    && !values.includes(ELEVATED_PERMISSION_GATE_ACCEPTANCE)
  ) {
    values.push(ELEVATED_PERMISSION_GATE_ACCEPTANCE)
  }
  return Object.freeze(values)
}

function usesRagContextPack(steps: readonly WorkflowDefinitionStep[]): boolean {
  return steps.some((step) => (
    step.toolRequest?.toolId === 'rag:context_pack'
    || step.toolRequest?.name === 'rag.context_pack'
  ))
}

function workflowToolIdentityNeedsReview(request: WorkflowDefinitionToolRequest): boolean {
  return [request.toolId, request.name, request.serverId].some((value) => (
    typeof value === 'string'
    && (value.includes('[redacted]') || value.includes('[output truncated]'))
  ))
}

function containsArbitraryExecutionRisk(value: string): boolean {
  return ARBITRARY_EXECUTION_PATTERNS.some((pattern) => pattern.test(value))
}
