import type { ChatToolDefinition, JsonRecord } from '@/core'
import { snapshotPlainData } from '@/core'
import {
  MODEL_OPERATION_CALL_SCHEMA,
  MODEL_OPERATION_CALL_TAG,
  type ModelOperationCatalogSnapshot,
  type ModelOperationDescriptor,
} from './modelOperationProtocol'
import { formatTaggedModelOperationPrompt } from './modelOperationCatalog'
import { validateToolInputSchema } from './toolInputSchema'

export const MODEL_OPERATION_DISCOVERY_ID = 'islemind:tools:discover'
export const MODEL_OPERATION_DISCOVERY_NAME = 'islemind_find_tools'
export const MODEL_OPERATION_DISCOVERY_RESULT_SCHEMA = 'islemind.tool-discovery-result.v1'
export const MODEL_OPERATION_DECLARATION_TARGET_CHARS = 12_000
export const MODEL_OPERATION_DIRECT_DECLARATION_COUNT = 10
export const MODEL_OPERATION_DISCOVERY_PAGE_SIZE = 8

/**
 * Explicit pure-metadata classification: transforms only the supplied frozen,
 * already-scoped catalog. No current user state, catalog port or executor is read.
 * The host still owns cancellation, step budgets and durable activity admission.
 */
export const MODEL_OPERATION_DISCOVERY_METADATA_CLASS = 'frozen-catalog-only' as const

export const MODEL_OPERATION_DISCOVERY_INPUT_SCHEMA: JsonRecord = snapshotPlainData({
  type: 'object',
  properties: {
    query: { type: 'string', maxLength: 256, description: 'Match an exact operation ID, name, or words in its description. Empty query browses the catalog.' },
    offset: { type: 'integer', minimum: 0, maximum: 64, description: 'Use nextOffset from the previous result for the same query.' },
    limit: { type: 'integer', minimum: 1, maximum: MODEL_OPERATION_DISCOVERY_PAGE_SIZE },
  },
  required: ['query'],
  additionalProperties: false,
})

export interface ModelOperationDeclarationPlan {
  readonly mode: 'full' | 'discovery'
  readonly catalogRevision: string
  readonly operations: readonly ModelOperationDescriptor[]
  readonly declarations: readonly ChatToolDefinition[]
  readonly prompt: string
  readonly declarationChars: number
  readonly fullDeclarationChars: number
  readonly summaryChars: number
  readonly totalCount: number
  readonly declaredCount: number
  readonly deferredCount: number
  readonly budgetChars: number
}

export interface ModelOperationDiscoveryResult {
  readonly schema: typeof MODEL_OPERATION_DISCOVERY_RESULT_SCHEMA
  readonly catalogRevision: string
  readonly matchedCount: number
  readonly offset: number
  readonly returnedCount: number
  readonly nextOffset: number | null
  readonly operationIds: readonly string[]
  readonly definitionChars: number
  readonly budgetChars: number
  readonly singleDefinitionOverBudget: boolean
}

export const MODEL_OPERATION_DISCOVERY_DEFINITION: ChatToolDefinition = snapshotPlainData({
  operationId: MODEL_OPERATION_DISCOVERY_ID,
  name: MODEL_OPERATION_DISCOVERY_NAME,
  description: 'Find permitted tools in this frozen catalog and publish their complete parameter schemas for the next model turn. This only describes tools; it does not execute them or grant permission. Query exact IDs/names or descriptive words, and use nextOffset to page. Call the published operation itself afterward.',
  inputSchema: MODEL_OPERATION_DISCOVERY_INPUT_SCHEMA,
  permission: 'read-only',
})

export function modelOperationDiscoveryDescriptor(): ModelOperationDescriptor {
  return snapshotPlainData({
    id: MODEL_OPERATION_DISCOVERY_ID,
    name: MODEL_OPERATION_DISCOVERY_NAME,
    description: MODEL_OPERATION_DISCOVERY_DEFINITION.description,
    inputSchema: MODEL_OPERATION_DISCOVERY_INPUT_SCHEMA,
    permission: 'read-only',
    requiresConfirmation: false,
    capabilityScopes: ['metadata:frozen-operation-catalog'],
    executor: { kind: 'builtin', id: MODEL_OPERATION_DISCOVERY_ID },
    availability: { status: 'available' },
  })
}

export function planModelOperationDeclarations(input: {
  readonly snapshot: ModelOperationCatalogSnapshot
  readonly mode?: 'full' | 'auto'
  readonly native: boolean
  readonly operationName: (id: string) => string
  readonly publishedIds?: readonly string[]
}): ModelOperationDeclarationPlan {
  const { snapshot } = input
  if (snapshot.operations.some(operation => operation.id === MODEL_OPERATION_DISCOVERY_ID)) {
    throw new Error('The frozen operation catalog contains a reserved discovery identity.')
  }
  const fullDeclarations = snapshot.operations.map(operation => declaration(operation, input.operationName))
  const tagged = formatTaggedModelOperationPrompt(snapshot)
  if (!tagged.ok) throw new Error(tagged.message)
  const fullDeclarationChars = input.native ? JSON.stringify(fullDeclarations).length : tagged.prompt.length
  const deferred = input.mode === 'auto' && (
    snapshot.operations.length > MODEL_OPERATION_DIRECT_DECLARATION_COUNT
    || fullDeclarationChars > MODEL_OPERATION_DECLARATION_TARGET_CHARS
  )
  if (!deferred) {
    return snapshotPlainData({
      mode: 'full', catalogRevision: snapshot.revision, operations: snapshot.operations,
      declarations: fullDeclarations, prompt: input.native ? '' : tagged.prompt,
      declarationChars: fullDeclarationChars, fullDeclarationChars, summaryChars: 0,
      totalCount: snapshot.operations.length, declaredCount: snapshot.operations.length,
      deferredCount: 0, budgetChars: MODEL_OPERATION_DECLARATION_TARGET_CHARS,
    })
  }
  const published = new Set(input.publishedIds ?? [])
  if (published.size > MODEL_OPERATION_DISCOVERY_PAGE_SIZE
    || published.size !== (input.publishedIds?.length ?? 0)
    || [...published].some(id => !snapshot.operations.some(operation =>
      operation.id === id && operation.availability.status === 'available'))) {
    throw new Error('Tool publication must be a bounded subset of the frozen catalog.')
  }
  const operations = snapshot.operations.filter(operation => published.has(operation.id))
  const declarations = [
    MODEL_OPERATION_DISCOVERY_DEFINITION,
    ...operations.map(operation => declaration(operation, input.operationName)),
  ]
  const summary = JSON.stringify(snapshot.operations.map(operation => ({
    id: operation.id, name: operation.name,
    description: operation.description.slice(0, 160),
    permission: operation.permission, availability: operation.availability.status,
  })))
  const prompt = [
    `This is a declaration projection of frozen catalog ${snapshot.revision}.`,
    `TOOL_DIRECTORY_JSON=${summary}`,
    'The directory contains descriptions, not callable parameter schemas. Discover the tools needed for this task; each discovery replaces the currently published page for the next model turn.',
    `Discovery operation: ${MODEL_OPERATION_DISCOVERY_ID}; native name: ${MODEL_OPERATION_DISCOVERY_NAME}.`,
    'Only operations with a complete schema in the current declaration page may be called. Discovery does not execute a tool, change permission or widen the frozen catalog.',
    !input.native ? [
      `MODEL_OPERATION_DECLARATIONS_JSON=${JSON.stringify([modelOperationDiscoveryDescriptor(), ...operations])}`,
      `For an operation, output exactly one <${MODEL_OPERATION_CALL_TAG}>JSON</${MODEL_OPERATION_CALL_TAG}> envelope, with no prose or second envelope.`,
      `The JSON must contain exactly schema, catalogRevision, operationId, arguments; schema is ${MODEL_OPERATION_CALL_SCHEMA}, catalogRevision is ${snapshot.revision}, and arguments must match the published inputSchema.`,
      `Discovery example: <${MODEL_OPERATION_CALL_TAG}>${JSON.stringify({
        schema: MODEL_OPERATION_CALL_SCHEMA, catalogRevision: snapshot.revision,
        operationId: MODEL_OPERATION_DISCOVERY_ID, arguments: { query: '' },
      })}</${MODEL_OPERATION_CALL_TAG}>`,
    ].join('\n') : '',
  ].filter(Boolean).join('\n')
  return snapshotPlainData({
    mode: 'discovery', catalogRevision: snapshot.revision, operations, declarations, prompt,
    declarationChars: input.native ? JSON.stringify(declarations).length + prompt.length : prompt.length,
    fullDeclarationChars, summaryChars: summary.length,
    totalCount: snapshot.operations.length, declaredCount: operations.length,
    deferredCount: snapshot.operations.length - operations.length,
    budgetChars: MODEL_OPERATION_DECLARATION_TARGET_CHARS,
  })
}

/** Deterministic metadata matching; no semantic classifier, lookup or tool call. */
export function discoverModelOperations(input: {
  readonly snapshot: ModelOperationCatalogSnapshot
  readonly arguments: Readonly<Record<string, unknown>>
  readonly operationName: (id: string) => string
  readonly native: boolean
}): ModelOperationDiscoveryResult {
  const checked = validateToolInputSchema(MODEL_OPERATION_DISCOVERY_INPUT_SCHEMA as Record<string, unknown>,
    input.arguments as Record<string, unknown>)
  if (!checked.ok) throw new Error(checked.errors.slice(0, 8).join(' '))
  // Keep bounds authoritative even when a schema validator ignores a keyword.
  const query = input.arguments.query
  const offset = input.arguments.offset ?? 0
  const limit = input.arguments.limit ?? MODEL_OPERATION_DISCOVERY_PAGE_SIZE
  if (typeof query !== 'string' || query.length > 256
    || typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset > 64
    || typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MODEL_OPERATION_DISCOVERY_PAGE_SIZE
    || Object.keys(input.arguments).some(key => !['query', 'offset', 'limit'].includes(key))) {
    throw new Error('Tool discovery arguments are invalid.')
  }
  const normalized = query.normalize('NFKC').trim().toLowerCase()
  const words = normalized.split(/\s+/u).filter(Boolean)
  const matches = input.snapshot.operations.map(operation => {
    const identities = [operation.id, operation.name, input.operationName(operation.id)]
      .map(value => value.normalize('NFKC').toLowerCase())
    const identity = identities.join(' ')
    const text = `${identity} ${operation.description}`.normalize('NFKC').toLowerCase()
    const exact = identities.includes(normalized)
    const score = !normalized ? 1 : exact ? 100 : words.every(word => text.includes(word))
      ? 1 + words.filter(word => identity.includes(word)).length : 0
    return { operation, score }
  }).filter(match => match.score > 0 && match.operation.availability.status === 'available')
    .sort((left, right) => right.score - left.score || compareId(left.operation.id, right.operation.id))
  const page: ModelOperationDescriptor[] = []
  let definitionChars = 2
  for (const candidate of matches.slice(offset, offset + limit)) {
    const cost = JSON.stringify(input.native
      ? declaration(candidate.operation, input.operationName)
      : candidate.operation).length + (page.length ? 1 : 0)
    if (page.length && definitionChars + cost > MODEL_OPERATION_DECLARATION_TARGET_CHARS) break
    page.push(candidate.operation)
    definitionChars += cost
  }
  return snapshotPlainData({
    schema: MODEL_OPERATION_DISCOVERY_RESULT_SCHEMA, catalogRevision: input.snapshot.revision,
    matchedCount: matches.length, offset, returnedCount: page.length,
    nextOffset: offset + page.length < matches.length ? offset + page.length : null,
    operationIds: page.map(operation => operation.id), definitionChars,
    budgetChars: MODEL_OPERATION_DECLARATION_TARGET_CHARS,
    singleDefinitionOverBudget: page.length === 1 && definitionChars > MODEL_OPERATION_DECLARATION_TARGET_CHARS,
  })
}

/** Decodes only the exact bounded publication receipt, never model-authored instructions. */
export function readModelOperationPublication(
  output: string,
  snapshot: ModelOperationCatalogSnapshot,
): readonly string[] | undefined {
  if (output.length > 4_800) return undefined
  let result: unknown
  try { result = JSON.parse(output) } catch { return undefined }
  if (!result || typeof result !== 'object' || Array.isArray(result)) return undefined
  const value = result as Record<string, unknown>
  const keys = ['schema', 'catalogRevision', 'matchedCount', 'offset', 'returnedCount',
    'nextOffset', 'operationIds', 'definitionChars', 'budgetChars', 'singleDefinitionOverBudget']
  const boundedCount = (count: unknown, max = 64): count is number =>
    typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 && count <= max
  const availableCount = snapshot.operations.filter(operation => operation.availability.status === 'available').length
  if (value.schema !== MODEL_OPERATION_DISCOVERY_RESULT_SCHEMA || value.catalogRevision !== snapshot.revision
    || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))
    || !boundedCount(value.matchedCount, availableCount) || !boundedCount(value.offset)
    || !boundedCount(value.returnedCount, MODEL_OPERATION_DISCOVERY_PAGE_SIZE)
    || value.returnedCount > value.matchedCount
    || (value.returnedCount > 0 && value.offset + value.returnedCount > value.matchedCount)
    || (value.offset < value.matchedCount && value.returnedCount === 0)
    || value.nextOffset !== (value.offset + value.returnedCount < value.matchedCount
      ? value.offset + value.returnedCount : null)
    || !boundedCount(value.definitionChars, 4_194_304) || value.definitionChars < 2
    || (value.returnedCount === 0 && value.definitionChars !== 2)
    || value.budgetChars !== MODEL_OPERATION_DECLARATION_TARGET_CHARS
    || value.singleDefinitionOverBudget !== (value.returnedCount === 1
      && value.definitionChars > MODEL_OPERATION_DECLARATION_TARGET_CHARS)
    || !Array.isArray(value.operationIds) || value.operationIds.length > MODEL_OPERATION_DISCOVERY_PAGE_SIZE
    || value.returnedCount !== value.operationIds.length
    || new Set(value.operationIds).size !== value.operationIds.length
    || !value.operationIds.every(id => typeof id === 'string' && snapshot.operations.some(operation =>
      operation.id === id && operation.availability.status === 'available'))) return undefined
  return snapshotPlainData(value.operationIds as string[])
}

function declaration(operation: ModelOperationDescriptor, name: (id: string) => string): ChatToolDefinition {
  return {
    operationId: operation.id, name: name(operation.id), description: operation.description,
    inputSchema: operation.inputSchema, permission: operation.permission,
  }
}

function compareId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
