export const STRUCTURED_OUTPUT_COMPATIBILITY_EVAL_SCHEMA = 'islemind.structured-output-compatibility-eval.v1'
export const STRUCTURED_OUTPUT_FIXTURE_IDS = [
  'openai-responses-text-format',
  'openai-chat-response-format',
  'anthropic-tool-schema',
  'google-response-schema',
  'openrouter-model-gated-schema',
  'localai-grammar-adapter-required',
  'generic-compatible-no-metadata',
  'malformed-schema-refusal',
  'tool-and-structured-output-coexistence',
  'json-object-fallback-repair',
] as const

export type StructuredOutputFixtureId = typeof STRUCTURED_OUTPUT_FIXTURE_IDS[number]
export type StructuredOutputProviderFamily =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'openrouter'
  | 'localai'
  | 'generic-openai-compatible'
  | 'cerebras'
export type StructuredOutputProtocol =
  | 'openai-responses'
  | 'openai-chat-completions'
  | 'anthropic-messages'
  | 'google-generate-content'
  | 'openai-compatible'
export type StructuredOutputRequestShape =
  | 'openai-responses-text-format'
  | 'openai-response-format'
  | 'anthropic-tool-schema'
  | 'google-response-schema'
  | 'openrouter-response-format'
  | 'localai-grammar'
  | 'json-object-fallback'
  | 'none'
export type StructuredOutputReadiness = 'ready' | 'fallback-only' | 'blocked'
export type StructuredOutputFailureCode =
  | 'missing-schema-name'
  | 'schema-not-object'
  | 'schema-missing-properties'
  | 'schema-missing-required'
  | 'unsupported-request-control'
  | 'adapter-required'
  | 'model-metadata-required'
  | 'tool-schema-invalid'
  | 'parse-failed'
  | 'required-field-missing'

export interface StructuredOutputJsonSchema {
  name?: string
  schema: Record<string, unknown>
  strict?: boolean
}

export interface StructuredOutputToolDeclaration {
  name?: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export interface StructuredOutputFixture {
  id: StructuredOutputFixtureId | string
  providerFamily: StructuredOutputProviderFamily
  protocol: StructuredOutputProtocol
  docs: string[]
  schema: StructuredOutputJsonSchema
  modelSupportedParameters?: string[]
  tools?: StructuredOutputToolDeclaration[]
  sampleOutput: string
  appRequestControl: boolean
  documentedShape: StructuredOutputRequestShape
  requiresAdapter?: boolean
  fallbackAllowed?: boolean
}

export interface StructuredOutputDiagnostic {
  fixtureId: string
  providerFamily: StructuredOutputProviderFamily
  protocol: StructuredOutputProtocol
  docs: string[]
  requested: boolean
  requestShape: StructuredOutputRequestShape
  documentedShape: StructuredOutputRequestShape
  readiness: StructuredOutputReadiness
  strictJsonSchema: boolean
  jsonObjectFallback: boolean
  appRequestControl: boolean
  modelMetadataSupportsSchema: boolean
  adapterRequired: boolean
  toolDeclarationCount: number
  toolSchemaValid: boolean
  parsed: boolean
  requiredFieldCoverage: number
  failureCodes: StructuredOutputFailureCode[]
}

export interface StructuredOutputCompatibilityQualityGate {
  passed: boolean
  failures: string[]
  requiredFixtureIds: string[]
  requiredRequestShapes: StructuredOutputRequestShape[]
}

export interface StructuredOutputCompatibilityEvaluationRun {
  schema: typeof STRUCTURED_OUTPUT_COMPATIBILITY_EVAL_SCHEMA
  id: string
  ranAt: number
  diagnostics: StructuredOutputDiagnostic[]
  qualityGate: StructuredOutputCompatibilityQualityGate
}

export interface StructuredOutputCompatibilityEvaluationOptions {
  now?: () => number
  fixtures?: StructuredOutputFixture[]
  requiredFixtureIds?: string[]
}

const TASK_SCHEMA: StructuredOutputJsonSchema = {
  name: 'islemind_task_answer',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      answer: { type: 'string' },
      confidence: { type: 'number' },
      citations: { type: 'array', items: { type: 'string' } },
    },
    required: ['answer', 'confidence', 'citations'],
    additionalProperties: false,
  },
}

export const STRUCTURED_OUTPUT_COMPATIBILITY_FIXTURES: StructuredOutputFixture[] = [
  {
    id: 'openai-responses-text-format',
    providerFamily: 'openai',
    protocol: 'openai-responses',
    docs: ['https://platform.openai.com/docs/guides/structured-outputs'],
    schema: TASK_SCHEMA,
    modelSupportedParameters: ['text.format'],
    sampleOutput: '{"answer":"Use the typed Responses text format.","confidence":0.91,"citations":["doc:1"]}',
    appRequestControl: true,
    documentedShape: 'openai-responses-text-format',
  },
  {
    id: 'openai-chat-response-format',
    providerFamily: 'openai',
    protocol: 'openai-chat-completions',
    docs: ['https://platform.openai.com/docs/guides/structured-outputs'],
    schema: TASK_SCHEMA,
    modelSupportedParameters: ['response_format', 'json_schema'],
    sampleOutput: '{"answer":"Use Chat Completions response_format.","confidence":0.89,"citations":["doc:2"]}',
    appRequestControl: true,
    documentedShape: 'openai-response-format',
  },
  {
    id: 'anthropic-tool-schema',
    providerFamily: 'anthropic',
    protocol: 'anthropic-messages',
    docs: ['https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview'],
    schema: TASK_SCHEMA,
    sampleOutput: '{"answer":"Use a single synthetic tool schema for typed output.","confidence":0.84,"citations":["doc:3"]}',
    appRequestControl: true,
    documentedShape: 'anthropic-tool-schema',
    tools: [{ name: 'emit_structured_answer', inputSchema: TASK_SCHEMA.schema }],
  },
  {
    id: 'google-response-schema',
    providerFamily: 'google',
    protocol: 'google-generate-content',
    docs: ['https://ai.google.dev/gemini-api/docs/structured-output'],
    schema: TASK_SCHEMA,
    sampleOutput: '{"answer":"Use Gemini responseSchema.","confidence":0.86,"citations":["doc:4"]}',
    appRequestControl: true,
    documentedShape: 'google-response-schema',
  },
  {
    id: 'openrouter-model-gated-schema',
    providerFamily: 'openrouter',
    protocol: 'openai-compatible',
    docs: ['https://openrouter.ai/docs/features/structured-outputs'],
    schema: TASK_SCHEMA,
    modelSupportedParameters: ['response_format', 'tools'],
    sampleOutput: '{"answer":"Only send schema controls when model metadata allows it.","confidence":0.8,"citations":["doc:5"]}',
    appRequestControl: true,
    documentedShape: 'openrouter-response-format',
  },
  {
    id: 'localai-grammar-adapter-required',
    providerFamily: 'localai',
    protocol: 'openai-compatible',
    docs: ['https://localai.io/features/constrained_grammars/'],
    schema: TASK_SCHEMA,
    modelSupportedParameters: ['grammar'],
    sampleOutput: '{"answer":"LocalAI uses grammar-backed structured output.","confidence":0.74,"citations":["doc:6"]}',
    appRequestControl: false,
    documentedShape: 'localai-grammar',
    requiresAdapter: true,
  },
  {
    id: 'generic-compatible-no-metadata',
    providerFamily: 'generic-openai-compatible',
    protocol: 'openai-compatible',
    docs: ['https://platform.openai.com/docs/api-reference/chat/create'],
    schema: TASK_SCHEMA,
    modelSupportedParameters: [],
    sampleOutput: '{"answer":"Do not assume response_format support without metadata.","confidence":0.44,"citations":[]}',
    appRequestControl: false,
    documentedShape: 'none',
  },
  {
    id: 'malformed-schema-refusal',
    providerFamily: 'cerebras',
    protocol: 'openai-compatible',
    docs: ['https://inference-docs.cerebras.ai/capabilities/structured-output'],
    schema: {
      strict: true,
      schema: {
        type: 'object',
        properties: {},
      },
    },
    modelSupportedParameters: ['response_format'],
    sampleOutput: '{"answer":"This should be blocked before request shaping."}',
    appRequestControl: true,
    documentedShape: 'openai-response-format',
  },
  {
    id: 'tool-and-structured-output-coexistence',
    providerFamily: 'openai',
    protocol: 'openai-responses',
    docs: ['https://platform.openai.com/docs/guides/tools', 'https://platform.openai.com/docs/guides/structured-outputs'],
    schema: TASK_SCHEMA,
    modelSupportedParameters: ['text.format', 'tools'],
    tools: [
      {
        name: 'read_context',
        description: 'Read bounded context before answering.',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      },
    ],
    sampleOutput: '{"answer":"Tools and typed output remain separate request surfaces.","confidence":0.88,"citations":["tool:read_context"]}',
    appRequestControl: true,
    documentedShape: 'openai-responses-text-format',
  },
  {
    id: 'json-object-fallback-repair',
    providerFamily: 'generic-openai-compatible',
    protocol: 'openai-compatible',
    docs: ['https://platform.openai.com/docs/guides/text-generation/json-mode'],
    schema: TASK_SCHEMA,
    modelSupportedParameters: ['json_object'],
    sampleOutput: 'Here is the JSON:\n{"answer":"Use JSON-object fallback with parser validation.","confidence":0.62,"citations":["doc:7"]}',
    appRequestControl: false,
    documentedShape: 'json-object-fallback',
    fallbackAllowed: true,
  },
]

export function runStructuredOutputCompatibilityEvaluation(options: StructuredOutputCompatibilityEvaluationOptions = {}): StructuredOutputCompatibilityEvaluationRun {
  const now = options.now ?? (() => Date.now())
  const ranAt = now()
  const fixtures = options.fixtures ?? STRUCTURED_OUTPUT_COMPATIBILITY_FIXTURES
  const diagnostics = fixtures.map(evaluateStructuredOutputFixture)
  return {
    schema: STRUCTURED_OUTPUT_COMPATIBILITY_EVAL_SCHEMA,
    id: `structured-output-compatibility-eval-${ranAt}`,
    ranAt,
    diagnostics,
    qualityGate: evaluateStructuredOutputCompatibilityQualityGate(diagnostics, options.requiredFixtureIds ?? [...STRUCTURED_OUTPUT_FIXTURE_IDS]),
  }
}

export function evaluateStructuredOutputFixture(fixture: StructuredOutputFixture): StructuredOutputDiagnostic {
  const schemaIssues = validateSchema(fixture.schema)
  const toolSchemaValid = (fixture.tools ?? []).every((tool) => Boolean(tool.name) && validateSchema({ name: tool.name, schema: tool.inputSchema ?? {} }).length === 0)
  const parsedValue = parseSampleOutput(fixture.sampleOutput)
  const parsed = Boolean(parsedValue)
  const requiredFieldCoverage = parsedValue ? requiredCoverage(fixture.schema, parsedValue) : 0
  const modelMetadataSupportsSchema = modelSupportsSchema(fixture)
  const adapterRequired = Boolean(fixture.requiresAdapter)
  const requestShape = resolveRequestShape(fixture, schemaIssues, modelMetadataSupportsSchema)
  const readiness = resolveReadiness(fixture, schemaIssues, parsed, requiredFieldCoverage, modelMetadataSupportsSchema, adapterRequired)
  const failureCodes: StructuredOutputFailureCode[] = [
    ...schemaIssues,
    ...(toolSchemaValid ? [] : ['tool-schema-invalid' as StructuredOutputFailureCode]),
  ]

  if (!modelMetadataSupportsSchema && fixture.providerFamily === 'generic-openai-compatible' && !fixture.fallbackAllowed) failureCodes.push('model-metadata-required')
  if (!fixture.appRequestControl && !fixture.fallbackAllowed && !adapterRequired) failureCodes.push('unsupported-request-control')
  if (adapterRequired) failureCodes.push('adapter-required')
  if (!parsed) failureCodes.push('parse-failed')
  if (parsed && requiredFieldCoverage < 1) failureCodes.push('required-field-missing')

  return {
    fixtureId: fixture.id,
    providerFamily: fixture.providerFamily,
    protocol: fixture.protocol,
    docs: fixture.docs,
    requested: true,
    requestShape,
    documentedShape: fixture.documentedShape,
    readiness,
    strictJsonSchema: Boolean(fixture.schema.strict && requestShape !== 'json-object-fallback' && requestShape !== 'none'),
    jsonObjectFallback: requestShape === 'json-object-fallback',
    appRequestControl: fixture.appRequestControl,
    modelMetadataSupportsSchema,
    adapterRequired,
    toolDeclarationCount: fixture.tools?.length ?? 0,
    toolSchemaValid,
    parsed,
    requiredFieldCoverage,
    failureCodes: unique(failureCodes),
  }
}

export function evaluateStructuredOutputCompatibilityQualityGate(
  diagnostics: StructuredOutputDiagnostic[],
  requiredFixtureIds: string[] = [...STRUCTURED_OUTPUT_FIXTURE_IDS]
): StructuredOutputCompatibilityQualityGate {
  const failures: string[] = []
  const byId = new Map(diagnostics.map((item) => [item.fixtureId, item]))
  const requiredRequestShapes: StructuredOutputRequestShape[] = [
    'openai-responses-text-format',
    'openai-response-format',
    'anthropic-tool-schema',
    'google-response-schema',
    'openrouter-response-format',
    'localai-grammar',
    'json-object-fallback',
    'none',
  ]

  for (const id of requiredFixtureIds) {
    if (!byId.has(id)) failures.push(`${id}:missing-fixture`)
  }
  for (const shape of requiredRequestShapes) {
    if (!diagnostics.some((item) => item.requestShape === shape || item.documentedShape === shape)) failures.push(`${shape}:missing-shape`)
  }
  for (const item of diagnostics) {
    if (!item.docs.length) failures.push(`${item.fixtureId}:missing-docs`)
    if (!item.parsed && item.fixtureId !== 'malformed-schema-refusal') failures.push(`${item.fixtureId}:sample-not-parseable`)
    if (item.requiredFieldCoverage < 1 && item.fixtureId !== 'malformed-schema-refusal') failures.push(`${item.fixtureId}:required-fields-not-covered`)
  }

  requireReady(byId.get('openai-responses-text-format'), failures, 'openai-responses-text-format')
  requireReady(byId.get('openai-chat-response-format'), failures, 'openai-chat-response-format')
  requireReady(byId.get('anthropic-tool-schema'), failures, 'anthropic-tool-schema')
  requireReady(byId.get('google-response-schema'), failures, 'google-response-schema')
  requireReady(byId.get('openrouter-model-gated-schema'), failures, 'openrouter-model-gated-schema')
  requireReady(byId.get('tool-and-structured-output-coexistence'), failures, 'tool-and-structured-output-coexistence')

  const localai = byId.get('localai-grammar-adapter-required')
  if (localai?.readiness !== 'blocked') failures.push('localai-grammar-adapter-required:not-blocked')
  if (!localai?.failureCodes.includes('adapter-required')) failures.push('localai-grammar-adapter-required:missing-adapter-code')

  const generic = byId.get('generic-compatible-no-metadata')
  if (generic?.readiness !== 'blocked') failures.push('generic-compatible-no-metadata:not-blocked')
  if (!generic?.failureCodes.includes('model-metadata-required')) failures.push('generic-compatible-no-metadata:missing-metadata-code')

  const malformed = byId.get('malformed-schema-refusal')
  if (malformed?.readiness !== 'blocked') failures.push('malformed-schema-refusal:not-blocked')
  if (!malformed?.failureCodes.includes('missing-schema-name')) failures.push('malformed-schema-refusal:missing-name-code')
  if (!malformed?.failureCodes.includes('schema-missing-required')) failures.push('malformed-schema-refusal:missing-required-code')

  const coexistence = byId.get('tool-and-structured-output-coexistence')
  if ((coexistence?.toolDeclarationCount ?? 0) < 1) failures.push('tool-and-structured-output-coexistence:missing-tool')
  if (coexistence?.toolSchemaValid !== true) failures.push('tool-and-structured-output-coexistence:invalid-tool-schema')
  if (coexistence?.requestShape !== 'openai-responses-text-format') failures.push('tool-and-structured-output-coexistence:wrong-output-shape')

  const fallback = byId.get('json-object-fallback-repair')
  if (fallback?.readiness !== 'fallback-only') failures.push('json-object-fallback-repair:not-fallback-only')
  if (fallback?.jsonObjectFallback !== true) failures.push('json-object-fallback-repair:missing-json-fallback')
  if (fallback?.strictJsonSchema !== false) failures.push('json-object-fallback-repair:claimed-strict-schema')

  return {
    passed: failures.length === 0,
    failures,
    requiredFixtureIds,
    requiredRequestShapes,
  }
}

function requireReady(item: StructuredOutputDiagnostic | undefined, failures: string[], id: string): void {
  if (!item) return
  if (item.readiness !== 'ready') failures.push(`${id}:not-ready`)
  if (!item.appRequestControl) failures.push(`${id}:missing-app-request-control`)
  if (item.requiredFieldCoverage < 1) failures.push(`${id}:required-fields-not-covered`)
}

function resolveRequestShape(
  fixture: StructuredOutputFixture,
  schemaIssues: StructuredOutputFailureCode[],
  modelMetadataSupportsSchema: boolean
): StructuredOutputRequestShape {
  if (schemaIssues.length) return 'none'
  if (fixture.fallbackAllowed) return 'json-object-fallback'
  if (fixture.requiresAdapter) return fixture.documentedShape
  if (!fixture.appRequestControl || !modelMetadataSupportsSchema) return 'none'
  return fixture.documentedShape
}

function resolveReadiness(
  fixture: StructuredOutputFixture,
  schemaIssues: StructuredOutputFailureCode[],
  parsed: boolean,
  requiredFieldCoverage: number,
  modelMetadataSupportsSchema: boolean,
  adapterRequired: boolean
): StructuredOutputReadiness {
  if (schemaIssues.length || adapterRequired || !parsed || requiredFieldCoverage < 1) return 'blocked'
  if (fixture.fallbackAllowed) return 'fallback-only'
  if (!fixture.appRequestControl || !modelMetadataSupportsSchema) return 'blocked'
  return 'ready'
}

function validateSchema(schema: StructuredOutputJsonSchema): StructuredOutputFailureCode[] {
  const failures: StructuredOutputFailureCode[] = []
  if (!schema.name?.trim()) failures.push('missing-schema-name')
  const body = schema.schema
  if (!body || body.type !== 'object') failures.push('schema-not-object')
  const properties = body.properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties) || !Object.keys(properties).length) failures.push('schema-missing-properties')
  if (!Array.isArray(body.required) || !body.required.length) failures.push('schema-missing-required')
  return failures
}

function modelSupportsSchema(fixture: StructuredOutputFixture): boolean {
  if (fixture.protocol === 'anthropic-messages' || fixture.protocol === 'google-generate-content') return true
  if (fixture.providerFamily === 'localai') return Boolean(fixture.modelSupportedParameters?.includes('grammar'))
  if (fixture.documentedShape === 'json-object-fallback') return Boolean(fixture.modelSupportedParameters?.includes('json_object'))
  const supported = (fixture.modelSupportedParameters ?? []).map((item) => item.toLowerCase())
  return supported.some((item) => ['response_format', 'json_schema', 'structured_outputs', 'text.format'].includes(item))
}

function parseSampleOutput(output: string): Record<string, unknown> | null {
  const direct = tryParseJson(output)
  if (direct) return direct
  const match = output.match(/\{[\s\S]*\}/)
  return match ? tryParseJson(match[0]) : null
}

function tryParseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function requiredCoverage(schema: StructuredOutputJsonSchema, value: Record<string, unknown>): number {
  const required = Array.isArray(schema.schema.required) ? schema.schema.required.filter((item): item is string => typeof item === 'string') : []
  if (!required.length) return 0
  const hits = required.filter((key) => value[key] !== undefined).length
  return round3(hits / required.length)
}

function round3(value: number): number {
  return Number(value.toFixed(3))
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}
