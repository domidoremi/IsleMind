import { validateToolInputSchema } from './toolInputSchema'
import { stableIdentityHash } from './toolchainIdentity'
import {
  MODEL_OPERATION_ADMITTED_CALL_SCHEMA,
  MODEL_OPERATION_CALL_SCHEMA,
  MODEL_OPERATION_CALL_TAG,
  MODEL_OPERATION_CATALOG_SCHEMA,
  isCanonicalCatalogRevision,
  isCanonicalModelOperationId,
  normalizeModelOperationArguments,
  normalizeModelOperationDescriptor,
  type ModelOperationCall,
  type ModelOperationCatalogSnapshot,
  type ModelOperationDescriptor,
  type ModelOperationProposal,
} from './modelOperationProtocol'

export const MODEL_OPERATION_CATALOG_LIMIT = 64
export const MODEL_OPERATION_FALLBACK_PROMPT_LIMIT = 262_144

export type ModelOperationCatalogCreationFailureCode =
  | 'operation_limit_exceeded'
  | 'duplicate_operation_id'
  | 'invalid_descriptor'

export type ModelOperationCatalogCreationResult =
  | Readonly<{ ok: true; snapshot: ModelOperationCatalogSnapshot }>
  | Readonly<{
    ok: false
    code: ModelOperationCatalogCreationFailureCode
    message: string
    limit: typeof MODEL_OPERATION_CATALOG_LIMIT
    receivedCount: number
    descriptorIndex?: number
    operationId?: string
  }>

export type ModelOperationCallAdmissionFailureCode =
  | 'invalid_proposal'
  | 'stale_catalog_revision'
  | 'unknown_operation'
  | 'operation_unavailable'
  | 'invalid_arguments'

export type ModelOperationCallAdmissionResult =
  | Readonly<{ ok: true; call: ModelOperationCall }>
  | Readonly<{
    ok: false
    code: ModelOperationCallAdmissionFailureCode
    message: string
    operationId?: string
    availabilityReason?: string
    argumentErrors?: readonly string[]
  }>

export type ModelOperationFallbackPromptFormatResult =
  | Readonly<{ ok: true; prompt: string }>
  | Readonly<{
    ok: false
    code: 'invalid_catalog_snapshot' | 'prompt_limit_exceeded'
    message: string
    limit: typeof MODEL_OPERATION_FALLBACK_PROMPT_LIMIT
    requiredChars?: number
  }>

/** Admits a complete descriptor set or returns one visible failure without a partial snapshot. */
export function createModelOperationCatalogSnapshot(
  input: unknown,
): ModelOperationCatalogCreationResult {
  if (!Array.isArray(input)) {
    return creationFailure(
      'invalid_descriptor',
      'Model operation catalog input must be an array.',
      0,
    )
  }
  if (input.length > MODEL_OPERATION_CATALOG_LIMIT) {
    return creationFailure(
      'operation_limit_exceeded',
      `Model operation catalog contains ${input.length} descriptors; the limit is ${MODEL_OPERATION_CATALOG_LIMIT}.`,
      input.length,
    )
  }

  const descriptors: ModelOperationDescriptor[] = []
  const operationIds = new Set<string>()
  for (let index = 0; index < input.length; index += 1) {
    const normalized = normalizeModelOperationDescriptor(input[index])
    if (!normalized.ok) {
      return creationFailure(
        'invalid_descriptor',
        `Model operation descriptor at index ${index} is invalid: ${normalized.message}`,
        input.length,
        { descriptorIndex: index },
      )
    }
    if (operationIds.has(normalized.descriptor.id)) {
      return creationFailure(
        'duplicate_operation_id',
        `Model operation ID "${normalized.descriptor.id}" is duplicated.`,
        input.length,
        { descriptorIndex: index, operationId: normalized.descriptor.id },
      )
    }
    operationIds.add(normalized.descriptor.id)
    descriptors.push(normalized.descriptor)
  }

  descriptors.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  const operations = Object.freeze(descriptors)
  const revision = `islemind.model.operation.catalog.v1:${stableIdentityHash({
    schema: MODEL_OPERATION_CATALOG_SCHEMA,
    operations,
  })}`
  const snapshot: ModelOperationCatalogSnapshot = Object.freeze({
    schema: MODEL_OPERATION_CATALOG_SCHEMA,
    revision,
    operations,
  })
  return Object.freeze({ ok: true, snapshot })
}

/** Resolves a proposal only against the exact immutable catalog revision it was authored from. */
export function admitModelOperationCall(
  snapshot: ModelOperationCatalogSnapshot,
  proposal: ModelOperationProposal,
): ModelOperationCallAdmissionResult {
  if (proposal.schema !== MODEL_OPERATION_CALL_SCHEMA
    || !isCanonicalCatalogRevision(proposal.catalogRevision)
    || !isCanonicalModelOperationId(proposal.operationId)) {
    return admissionFailure('invalid_proposal', 'Model operation proposal identity is invalid.')
  }
  if (proposal.catalogRevision !== snapshot.revision) {
    return admissionFailure(
      'stale_catalog_revision',
      'Model operation proposal does not match the current catalog revision.',
      { operationId: proposal.operationId },
    )
  }

  const descriptor = findModelOperationDescriptor(snapshot, proposal.operationId)
  if (!descriptor) {
    return admissionFailure(
      'unknown_operation',
      `Model operation "${proposal.operationId}" is not present in the current catalog.`,
      { operationId: proposal.operationId },
    )
  }
  if (descriptor.availability.status === 'unavailable') {
    return admissionFailure(
      'operation_unavailable',
      descriptor.availability.message,
      { operationId: proposal.operationId, availabilityReason: descriptor.availability.reason },
    )
  }

  const normalizedArguments = normalizeModelOperationArguments(proposal.arguments)
  if (!normalizedArguments.ok) {
    return admissionFailure(
      'invalid_arguments',
      normalizedArguments.message,
      { operationId: proposal.operationId },
    )
  }
  const validation = validateToolInputSchema(
    descriptor.inputSchema as Record<string, unknown>,
    normalizedArguments.arguments as Record<string, unknown>,
  )
  if (!validation.ok) {
    const argumentErrors = Object.freeze(validation.errors.slice(0, 16))
    return admissionFailure(
      'invalid_arguments',
      `Model operation arguments do not match the declared input schema: ${argumentErrors.join(' ')}`,
      { operationId: proposal.operationId, argumentErrors },
    )
  }

  return Object.freeze({
    ok: true,
    call: Object.freeze({
      schema: MODEL_OPERATION_ADMITTED_CALL_SCHEMA,
      catalogRevision: snapshot.revision,
      operationId: descriptor.id,
      arguments: normalizedArguments.arguments,
      permission: descriptor.permission,
      requiresConfirmation: descriptor.requiresConfirmation,
      capabilityScopes: descriptor.capabilityScopes,
      executor: descriptor.executor,
    }),
  })
}

export function findModelOperationDescriptor(
  snapshot: ModelOperationCatalogSnapshot,
  operationId: string,
): ModelOperationDescriptor | undefined {
  return snapshot.operations.find((descriptor) => descriptor.id === operationId)
}

/** Formats the provider fallback without interpreting user text as a local command. */
export function formatModelOperationFallbackPrompt(
  snapshot: ModelOperationCatalogSnapshot,
): ModelOperationFallbackPromptFormatResult {
  if (snapshot.schema !== MODEL_OPERATION_CATALOG_SCHEMA
    || !isCanonicalCatalogRevision(snapshot.revision)
    || !Object.isFrozen(snapshot)
    || !Object.isFrozen(snapshot.operations)) {
    return fallbackPromptFailure(
      'invalid_catalog_snapshot',
      'Model operation fallback requires an immutable canonical catalog snapshot.',
    )
  }

  const catalogJson = JSON.stringify(snapshot)
  const exampleOperation = snapshot.operations.find((operation) => operation.availability.status === 'available')
    ?? snapshot.operations[0]
  const envelopeExample = exampleOperation
    ? `<${MODEL_OPERATION_CALL_TAG}>${JSON.stringify({
      schema: MODEL_OPERATION_CALL_SCHEMA,
      catalogRevision: snapshot.revision,
      operationId: exampleOperation.id,
      arguments: {},
    })}</${MODEL_OPERATION_CALL_TAG}>`
    : '(No operation is present, so do not emit a tool-call envelope.)'
  const prompt = [
    'Interpret the user request with the model before proposing an application or system operation.',
    'Ordinary words, including command-like words, do not invoke local code by themselves.',
    `Use only an available canonical operation from this immutable catalog revision: ${snapshot.revision}`,
    `MODEL_OPERATION_CATALOG_JSON=${catalogJson}`,
    'When an operation is needed, the entire model output must be exactly one tool-call envelope with no surrounding prose and no second envelope.',
    `The JSON object must contain exactly schema, catalogRevision, operationId, and arguments; schema must be ${MODEL_OPERATION_CALL_SCHEMA}; catalogRevision must equal the revision above; operationId must exactly match one catalog ID; arguments must satisfy that operation's inputSchema.`,
    `Whole-output envelope example: ${envelopeExample}`,
  ].join('\n')

  if (prompt.length > MODEL_OPERATION_FALLBACK_PROMPT_LIMIT) {
    return fallbackPromptFailure(
      'prompt_limit_exceeded',
      'Model operation fallback prompt exceeds the protocol limit; no partial catalog was emitted.',
      prompt.length,
    )
  }
  return Object.freeze({ ok: true, prompt })
}

function creationFailure(
  code: ModelOperationCatalogCreationFailureCode,
  message: string,
  receivedCount: number,
  details: { descriptorIndex?: number; operationId?: string } = {},
): ModelOperationCatalogCreationResult {
  return Object.freeze({
    ok: false,
    code,
    message,
    limit: MODEL_OPERATION_CATALOG_LIMIT,
    receivedCount,
    ...(details.descriptorIndex !== undefined ? { descriptorIndex: details.descriptorIndex } : {}),
    ...(details.operationId ? { operationId: details.operationId } : {}),
  })
}

function admissionFailure(
  code: ModelOperationCallAdmissionFailureCode,
  message: string,
  details: {
    operationId?: string
    availabilityReason?: string
    argumentErrors?: readonly string[]
  } = {},
): ModelOperationCallAdmissionResult {
  return Object.freeze({
    ok: false,
    code,
    message,
    ...(details.operationId ? { operationId: details.operationId } : {}),
    ...(details.availabilityReason ? { availabilityReason: details.availabilityReason } : {}),
    ...(details.argumentErrors ? { argumentErrors: details.argumentErrors } : {}),
  })
}

function fallbackPromptFailure(
  code: 'invalid_catalog_snapshot' | 'prompt_limit_exceeded',
  message: string,
  requiredChars?: number,
): ModelOperationFallbackPromptFormatResult {
  return Object.freeze({
    ok: false,
    code,
    message,
    limit: MODEL_OPERATION_FALLBACK_PROMPT_LIMIT,
    ...(requiredChars !== undefined ? { requiredChars } : {}),
  })
}
