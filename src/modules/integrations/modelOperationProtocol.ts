import type { JsonRecord, JsonValue } from '@/core'

export const MODEL_OPERATION_CALL_TAG = 'islemind_tool_call'
export const MODEL_OPERATION_CALL_SCHEMA = 'islemind.model-tool-call.v1'
export const MODEL_OPERATION_ADMITTED_CALL_SCHEMA = 'islemind.model-admitted-tool-call.v1'
export const MODEL_OPERATION_RESULT_SCHEMA = 'islemind.model-tool-result.v1'
export const MODEL_OPERATION_CATALOG_SCHEMA = 'islemind.model-operation-catalog.v1'

export const MODEL_OPERATION_PROTOCOL_LIMITS = Object.freeze({
  outputChars: 131_072,
  payloadChars: 65_536,
  operationIdChars: 128,
  catalogRevisionChars: 128,
  descriptorNameChars: 128,
  descriptorDescriptionChars: 2_048,
  resultMessageChars: 8_192,
  capabilityScopes: 32,
  jsonDepth: 16,
  jsonNodes: 2_048,
  jsonCollectionItems: 256,
  jsonStringChars: 16_384,
  jsonTotalStringChars: 32_768,
  jsonKeyChars: 128,
  jsonTotalKeyChars: 16_384,
})

const CANONICAL_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{1,127}$/
const UNSAFE_JSON_KEY_PATTERN = /^(?:__proto__|constructor|prototype)$/
const UNSAFE_TEXT_CHARACTER_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

export type ModelOperationPermission = 'read-only' | 'read-write' | 'destructive'
export type ModelOperationExecutorKind =
  | 'mcp'
  | 'builtin'
  | 'android'
  | 'app-action'
  | 'registered'
  | 'rag'
  | 'work-artifact'

export interface ModelOperationExecutorMetadata {
  readonly kind: ModelOperationExecutorKind
  readonly id: string
}

export type ModelOperationAvailability =
  | Readonly<{ status: 'available' }>
  | Readonly<{
    status: 'unavailable'
    reason: string
    message: string
  }>

export interface ModelOperationDescriptor {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly inputSchema: JsonRecord
  readonly permission: ModelOperationPermission
  readonly requiresConfirmation: boolean
  readonly capabilityScopes: readonly string[]
  readonly executor: ModelOperationExecutorMetadata
  readonly availability: ModelOperationAvailability
}

export interface ModelOperationCatalogSnapshot {
  readonly schema: typeof MODEL_OPERATION_CATALOG_SCHEMA
  readonly revision: string
  readonly operations: readonly ModelOperationDescriptor[]
}

export interface ModelOperationProposal {
  readonly schema: typeof MODEL_OPERATION_CALL_SCHEMA
  readonly catalogRevision: string
  readonly operationId: string
  readonly arguments: JsonRecord
}

export interface ModelOperationCall {
  readonly schema: typeof MODEL_OPERATION_ADMITTED_CALL_SCHEMA
  readonly catalogRevision: string
  readonly operationId: string
  readonly arguments: JsonRecord
  readonly permission: ModelOperationPermission
  readonly requiresConfirmation: boolean
  readonly capabilityScopes: readonly string[]
  readonly executor: ModelOperationExecutorMetadata
}

export type ModelOperationAdmittedCall = ModelOperationCall

export type ModelOperationResult =
  | Readonly<{
    schema: typeof MODEL_OPERATION_RESULT_SCHEMA
    operationId: string
    status: 'succeeded'
    output: JsonValue
    metadata: JsonRecord
  }>
  | Readonly<{
    schema: typeof MODEL_OPERATION_RESULT_SCHEMA
    operationId: string
    status: 'failed' | 'cancelled'
    error: Readonly<{ code: string; message: string }>
    metadata: JsonRecord
  }>

export type ModelOperationProposalParseErrorCode =
  | 'invalid_output'
  | 'output_limit_exceeded'
  | 'invalid_envelope'
  | 'multiple_envelopes'
  | 'payload_limit_exceeded'
  | 'malformed_json'
  | 'invalid_proposal'
  | 'unknown_proposal_key'
  | 'schema_mismatch'
  | 'invalid_catalog_revision'
  | 'invalid_operation_id'
  | 'invalid_arguments'
  | 'argument_limit_exceeded'

export type ModelOperationProposalParseResult =
  | Readonly<{ ok: true; proposal: ModelOperationProposal }>
  | Readonly<{
    ok: false
    code: ModelOperationProposalParseErrorCode
    message: string
  }>

export type ModelOperationDescriptorNormalizationResult =
  | Readonly<{ ok: true; descriptor: ModelOperationDescriptor }>
  | Readonly<{ ok: false; message: string }>

export type ModelOperationResultNormalizationResult =
  | Readonly<{ ok: true; result: ModelOperationResult }>
  | Readonly<{
    ok: false
    code: 'invalid_result' | 'result_limit_exceeded'
    message: string
  }>

type JsonNormalizationResult<T extends JsonValue = JsonValue> =
  | { ok: true; value: T }
  | { ok: false; limitExceeded: boolean; message: string }

interface JsonBudget {
  nodes: number
  stringChars: number
  keyChars: number
}

const PROPOSAL_KEYS = Object.freeze(['arguments', 'catalogRevision', 'operationId', 'schema'])
const DESCRIPTOR_KEYS = Object.freeze([
  'availability',
  'capabilityScopes',
  'description',
  'executor',
  'id',
  'inputSchema',
  'name',
  'permission',
  'requiresConfirmation',
])
const EXECUTOR_KEYS = Object.freeze(['id', 'kind'])

/** Parses only a complete, versioned model-operation envelope and performs no side effects. */
export function parseModelOperationProposal(output: unknown): ModelOperationProposalParseResult {
  if (typeof output !== 'string') {
    return parseFailure('invalid_output', 'Model operation output must be a string.')
  }
  if (output.length > MODEL_OPERATION_PROTOCOL_LIMITS.outputChars) {
    return parseFailure('output_limit_exceeded', 'Model operation output exceeds the protocol limit.')
  }

  const text = output.trim()
  const openingTag = `<${MODEL_OPERATION_CALL_TAG}>`
  const closingTag = `</${MODEL_OPERATION_CALL_TAG}>`
  if (!text.startsWith(openingTag) || !text.endsWith(closingTag)) {
    return parseFailure('invalid_envelope', 'Model operation output must contain exactly one complete tool-call envelope.')
  }

  const payload = text.slice(openingTag.length, -closingTag.length)
  if (payload.includes(openingTag) || payload.includes(closingTag)) {
    return parseFailure('multiple_envelopes', 'Model operation output must not contain multiple tool-call envelopes.')
  }
  if (!payload.trim() || payload.length > MODEL_OPERATION_PROTOCOL_LIMITS.payloadChars) {
    return parseFailure(
      payload.length > MODEL_OPERATION_PROTOCOL_LIMITS.payloadChars ? 'payload_limit_exceeded' : 'invalid_proposal',
      payload.length > MODEL_OPERATION_PROTOCOL_LIMITS.payloadChars
        ? 'Model operation payload exceeds the protocol limit.'
        : 'Model operation payload must not be empty.',
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return parseFailure('malformed_json', 'Model operation payload is not valid JSON.')
  }
  if (!isPlainRecord(parsed)) {
    return parseFailure('invalid_proposal', 'Model operation payload must be a JSON object.')
  }
  const unexpectedKey = findUnexpectedKey(parsed, PROPOSAL_KEYS)
  if (unexpectedKey) {
    return parseFailure('unknown_proposal_key', `Model operation payload contains unknown key "${unexpectedKey}".`)
  }
  if (!hasExactKeys(parsed, PROPOSAL_KEYS)) {
    return parseFailure('invalid_proposal', 'Model operation payload is missing a required key.')
  }
  if (parsed.schema !== MODEL_OPERATION_CALL_SCHEMA) {
    return parseFailure('schema_mismatch', `Model operation schema must be ${MODEL_OPERATION_CALL_SCHEMA}.`)
  }
  if (!isCanonicalCatalogRevision(parsed.catalogRevision)) {
    return parseFailure('invalid_catalog_revision', 'Model operation catalog revision is invalid.')
  }
  if (!isCanonicalModelOperationId(parsed.operationId)) {
    return parseFailure('invalid_operation_id', 'Model operation ID is invalid.')
  }

  const normalizedArguments = normalizeJsonRecord(parsed.arguments)
  if (!normalizedArguments.ok) {
    return parseFailure(
      normalizedArguments.limitExceeded ? 'argument_limit_exceeded' : 'invalid_arguments',
      normalizedArguments.message,
    )
  }
  return Object.freeze({
    ok: true,
    proposal: Object.freeze({
      schema: MODEL_OPERATION_CALL_SCHEMA,
      catalogRevision: parsed.catalogRevision,
      operationId: parsed.operationId,
      arguments: normalizedArguments.value,
    }),
  })
}

/** Validates, canonicalizes, clones, and freezes a descriptor before catalog admission. */
export function normalizeModelOperationDescriptor(
  input: unknown,
): ModelOperationDescriptorNormalizationResult {
  if (!isPlainRecord(input) || !hasExactKeys(input, DESCRIPTOR_KEYS)) {
    const unexpectedKey = isPlainRecord(input) ? findUnexpectedKey(input, DESCRIPTOR_KEYS) : undefined
    return descriptorFailure(unexpectedKey
      ? `Operation descriptor contains unknown key "${unexpectedKey}".`
      : 'Operation descriptor must contain every required canonical field.')
  }
  if (!isCanonicalModelOperationId(input.id)) return descriptorFailure('Operation descriptor ID is invalid.')
  if (!isCanonicalText(input.name, MODEL_OPERATION_PROTOCOL_LIMITS.descriptorNameChars)) {
    return descriptorFailure('Operation descriptor name is invalid.')
  }
  if (!isCanonicalText(input.description, MODEL_OPERATION_PROTOCOL_LIMITS.descriptorDescriptionChars)) {
    return descriptorFailure('Operation descriptor description is invalid.')
  }
  if (!isModelOperationPermission(input.permission)) return descriptorFailure('Operation descriptor permission is invalid.')
  if (typeof input.requiresConfirmation !== 'boolean') {
    return descriptorFailure('Operation descriptor confirmation requirement must be explicit.')
  }

  const capabilityScopes = normalizeCapabilityScopes(input.capabilityScopes)
  if (!capabilityScopes) return descriptorFailure('Operation descriptor capability scopes are invalid.')
  const executor = normalizeExecutor(input.executor)
  if (!executor) return descriptorFailure('Operation descriptor executor metadata is invalid.')
  const availability = normalizeAvailability(input.availability)
  if (!availability) return descriptorFailure('Operation descriptor availability metadata is invalid.')
  const inputSchema = normalizeJsonRecord(input.inputSchema)
  if (!inputSchema.ok) return descriptorFailure(`Operation descriptor input schema is invalid: ${inputSchema.message}`)
  if (inputSchema.value.type !== 'object') {
    return descriptorFailure('Operation descriptor input schema must declare an object root.')
  }
  if (inputSchema.value.properties !== undefined && !isPlainRecord(inputSchema.value.properties)) {
    return descriptorFailure('Operation descriptor input schema properties must be an object.')
  }
  if (inputSchema.value.required !== undefined && !isStringArray(inputSchema.value.required)) {
    return descriptorFailure('Operation descriptor input schema required field must be a string array.')
  }

  return Object.freeze({
    ok: true,
    descriptor: Object.freeze({
      id: input.id,
      name: input.name,
      description: input.description,
      inputSchema: inputSchema.value,
      permission: input.permission,
      requiresConfirmation: input.requiresConfirmation,
      capabilityScopes,
      executor,
      availability,
    }),
  })
}

/** Copies executor/native output into a bounded immutable result for model consumption. */
export function normalizeModelOperationResult(input: unknown): ModelOperationResultNormalizationResult {
  if (!isPlainRecord(input) || !isCanonicalModelOperationId(input.operationId)) {
    return resultFailure('invalid_result', 'Model operation result requires a canonical operation ID.')
  }
  if (input.status !== 'succeeded' && input.status !== 'failed' && input.status !== 'cancelled') {
    return resultFailure('invalid_result', 'Model operation result status is invalid.')
  }

  const expectedKeys = input.status === 'succeeded'
    ? ['metadata', 'operationId', 'output', 'status']
    : ['error', 'metadata', 'operationId', 'status']
  if (!hasExactKeys(input, expectedKeys)) {
    return resultFailure('invalid_result', 'Model operation result fields do not match its status.')
  }

  const metadata = normalizeJsonRecord(input.metadata)
  if (!metadata.ok) {
    return resultFailure(metadata.limitExceeded ? 'result_limit_exceeded' : 'invalid_result', metadata.message)
  }
  if (input.status === 'succeeded') {
    const output = normalizeJsonValue(input.output)
    if (!output.ok) {
      return resultFailure(output.limitExceeded ? 'result_limit_exceeded' : 'invalid_result', output.message)
    }
    return Object.freeze({
      ok: true,
      result: Object.freeze({
        schema: MODEL_OPERATION_RESULT_SCHEMA,
        operationId: input.operationId,
        status: 'succeeded',
        output: output.value,
        metadata: metadata.value,
      }),
    })
  }

  if (!isPlainRecord(input.error) || !hasExactKeys(input.error, ['code', 'message'])
    || !isCanonicalModelOperationId(input.error.code)
    || !isCanonicalText(input.error.message, MODEL_OPERATION_PROTOCOL_LIMITS.resultMessageChars)) {
    return resultFailure('invalid_result', 'Model operation failure requires a canonical code and bounded message.')
  }
  return Object.freeze({
    ok: true,
    result: Object.freeze({
      schema: MODEL_OPERATION_RESULT_SCHEMA,
      operationId: input.operationId,
      status: input.status,
      error: Object.freeze({ code: input.error.code, message: input.error.message }),
      metadata: metadata.value,
    }),
  })
}

/** Revalidates and freezes manually constructed arguments before task/runtime handoff. */
export function normalizeModelOperationArguments(
  input: unknown,
): Readonly<{ ok: true; arguments: JsonRecord }> | Readonly<{
  ok: false
  code: 'invalid_arguments' | 'argument_limit_exceeded'
  message: string
}> {
  const normalized = normalizeJsonRecord(input)
  return normalized.ok
    ? Object.freeze({ ok: true, arguments: normalized.value })
    : Object.freeze({
      ok: false,
      code: normalized.limitExceeded ? 'argument_limit_exceeded' : 'invalid_arguments',
      message: normalized.message,
    })
}

export function isCanonicalModelOperationId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= MODEL_OPERATION_PROTOCOL_LIMITS.operationIdChars
    && CANONICAL_ID_PATTERN.test(value)
}

export function isCanonicalCatalogRevision(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= MODEL_OPERATION_PROTOCOL_LIMITS.catalogRevisionChars
    && CANONICAL_ID_PATTERN.test(value)
}

function normalizeCapabilityScopes(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || !value.length || value.length > MODEL_OPERATION_PROTOCOL_LIMITS.capabilityScopes) return null
  if (!value.every(isCanonicalModelOperationId)) return null
  const unique = new Set(value)
  if (unique.size !== value.length) return null
  return Object.freeze([...value].sort())
}

function normalizeExecutor(value: unknown): ModelOperationExecutorMetadata | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, EXECUTOR_KEYS)
    || !isModelOperationExecutorKind(value.kind) || !isCanonicalModelOperationId(value.id)) return null
  return Object.freeze({ kind: value.kind, id: value.id })
}

function normalizeAvailability(value: unknown): ModelOperationAvailability | null {
  if (!isPlainRecord(value)) return null
  if (value.status === 'available' && hasExactKeys(value, ['status'])) {
    return Object.freeze({ status: 'available' })
  }
  if (value.status === 'unavailable' && hasExactKeys(value, ['message', 'reason', 'status'])
    && isCanonicalModelOperationId(value.reason)
    && isCanonicalText(value.message, MODEL_OPERATION_PROTOCOL_LIMITS.resultMessageChars)) {
    return Object.freeze({ status: 'unavailable', reason: value.reason, message: value.message })
  }
  return null
}

function normalizeJsonRecord(value: unknown): JsonNormalizationResult<JsonRecord> {
  if (!isPlainRecord(value)) return jsonFailure(false, 'Model operation JSON value must be an object.')
  const normalized = normalizeJsonValueWithBudget(value)
  if (!normalized.ok) return normalized as JsonNormalizationResult<JsonRecord>
  return isPlainRecord(normalized.value)
    ? { ok: true, value: normalized.value as JsonRecord }
    : jsonFailure(false, 'Model operation JSON value must be an object.')
}

function normalizeJsonValue(value: unknown): JsonNormalizationResult {
  return normalizeJsonValueWithBudget(value)
}

function normalizeJsonValueWithBudget(value: unknown): JsonNormalizationResult {
  const budget: JsonBudget = {
    nodes: MODEL_OPERATION_PROTOCOL_LIMITS.jsonNodes,
    stringChars: MODEL_OPERATION_PROTOCOL_LIMITS.jsonTotalStringChars,
    keyChars: MODEL_OPERATION_PROTOCOL_LIMITS.jsonTotalKeyChars,
  }
  return copyJsonValue(value, 0, new WeakSet<object>(), budget)
}

function copyJsonValue(
  value: unknown,
  depth: number,
  ancestors: WeakSet<object>,
  budget: JsonBudget,
): JsonNormalizationResult {
  if (budget.nodes <= 0) return jsonFailure(true, 'Model operation JSON exceeds the node limit.')
  budget.nodes -= 1
  if (depth > MODEL_OPERATION_PROTOCOL_LIMITS.jsonDepth) {
    return jsonFailure(true, 'Model operation JSON exceeds the depth limit.')
  }
  if (value === null || typeof value === 'boolean') return { ok: true, value }
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? { ok: true, value }
      : jsonFailure(false, 'Model operation JSON contains a non-finite number.')
  }
  if (typeof value === 'string') {
    if (value.length > MODEL_OPERATION_PROTOCOL_LIMITS.jsonStringChars || value.length > budget.stringChars) {
      return jsonFailure(true, 'Model operation JSON exceeds the string limit.')
    }
    budget.stringChars -= value.length
    return { ok: true, value }
  }
  if (!value || typeof value !== 'object') {
    return jsonFailure(false, 'Model operation JSON contains a non-JSON value.')
  }
  if (ancestors.has(value)) return jsonFailure(false, 'Model operation JSON contains a circular reference.')

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      if (value.length > MODEL_OPERATION_PROTOCOL_LIMITS.jsonCollectionItems) {
        return jsonFailure(true, 'Model operation JSON array exceeds the item limit.')
      }
      const output: JsonValue[] = []
      for (const entry of value) {
        const normalized = copyJsonValue(entry, depth + 1, ancestors, budget)
        if (!normalized.ok) return normalized
        output.push(normalized.value)
      }
      return { ok: true, value: Object.freeze(output) }
    }
    if (!isPlainRecord(value)) return jsonFailure(false, 'Model operation JSON contains a non-plain object.')

    const keys = Object.keys(value).sort()
    if (keys.length > MODEL_OPERATION_PROTOCOL_LIMITS.jsonCollectionItems) {
      return jsonFailure(true, 'Model operation JSON object exceeds the property limit.')
    }
    const output: Record<string, JsonValue> = {}
    for (const key of keys) {
      if (!isSafeJsonKey(key)) return jsonFailure(false, 'Model operation JSON contains an unsafe key.')
      if (key.length > budget.keyChars) return jsonFailure(true, 'Model operation JSON exceeds the key limit.')
      budget.keyChars -= key.length
      const property = Object.getOwnPropertyDescriptor(value, key)
      if (!property || !('value' in property)) {
        return jsonFailure(false, 'Model operation JSON must not contain accessor properties.')
      }
      const normalized = copyJsonValue(property.value, depth + 1, ancestors, budget)
      if (!normalized.ok) return normalized
      output[key] = normalized.value
    }
    return { ok: true, value: Object.freeze(output) }
  } finally {
    ancestors.delete(value)
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isSafeJsonKey(value: string): boolean {
  return value.length > 0
    && value.length <= MODEL_OPERATION_PROTOCOL_LIMITS.jsonKeyChars
    && !UNSAFE_JSON_KEY_PATTERN.test(value)
    && !UNSAFE_TEXT_CHARACTER_PATTERN.test(value)
}

function isCanonicalText(value: unknown, limit: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= limit
    && value === value.trim()
    && !UNSAFE_TEXT_CHARACTER_PATTERN.test(value)
}

function isModelOperationPermission(value: unknown): value is ModelOperationPermission {
  return value === 'read-only' || value === 'read-write' || value === 'destructive'
}

function isModelOperationExecutorKind(value: unknown): value is ModelOperationExecutorKind {
  return value === 'mcp' || value === 'builtin' || value === 'android'
    || value === 'app-action' || value === 'registered' || value === 'rag'
    || value === 'work-artifact'
}

function isStringArray(value: JsonValue): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const actualKeys = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  return actualKeys.length === expected.length && actualKeys.every((key, index) => key === expected[index])
}

function findUnexpectedKey(value: Record<string, unknown>, expectedKeys: readonly string[]): string | undefined {
  const expected = new Set(expectedKeys)
  return Object.keys(value).find((key) => !expected.has(key))
}

function parseFailure(
  code: ModelOperationProposalParseErrorCode,
  message: string,
): ModelOperationProposalParseResult {
  return Object.freeze({ ok: false, code, message })
}

function descriptorFailure(message: string): ModelOperationDescriptorNormalizationResult {
  return Object.freeze({ ok: false, message })
}

function resultFailure(
  code: 'invalid_result' | 'result_limit_exceeded',
  message: string,
): ModelOperationResultNormalizationResult {
  return Object.freeze({ ok: false, code, message })
}

function jsonFailure(limitExceeded: boolean, message: string): JsonNormalizationResult<never> {
  return { ok: false, limitExceeded, message }
}
