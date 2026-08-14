import * as v from 'valibot'

import type {
  LocalModelStateRecord,
  LocalModelStateRepository,
  LocalModelStateSnapshot,
} from './localModelStateRepository'

export const LOCAL_MODEL_CATALOG_SCHEMA = 'islemind.local-embedding-models.v1'
export const LOCAL_MODEL_CATALOG_MAX_MODELS = 128
export const LOCAL_MODEL_CATALOG_MAX_FILES_PER_MODEL = 64
export const LOCAL_RAG_MODEL_CAPABILITIES = [
  'embedding',
  'reranker',
  'colbert',
  'compressor',
] as const

const MAX_MODEL_ID_LENGTH = 128
const MAX_LABEL_LENGTH = 512
const MAX_DESCRIPTION_LENGTH = 2_048
const MAX_URL_LENGTH = 4_096
const MAX_FILE_PATH_LENGTH = 1_024
const MAX_FILE_BYTES = 16 * 1_024 * 1_024 * 1_024
const MAX_MODEL_BYTES = 64 * 1_024 * 1_024 * 1_024
const MAX_MODEL_DIMENSION = 1_048_576
const MAX_MODEL_TOKENS = 1_048_576
const MAX_BUNDLE_VARIANTS = 32
const MAX_CONTRIBUTORS = 64

export type LocalRagModelCapability = typeof LOCAL_RAG_MODEL_CAPABILITIES[number]
export type LocalEmbeddingModelSource = 'bundled' | 'downloaded'
export type LocalEmbeddingTokenizer = 'wordpiece' | 'unigram' | 'sentencepiece'
export type LocalEmbeddingModelStatus =
  | 'not-downloaded'
  | 'downloading'
  | 'downloaded'
  | 'bundled'
  | 'enabled'
  | 'verify-failed'
  | 'runtime-unavailable'
  | 'planned'

export interface LocalEmbeddingModelFile {
  path: string
  bytes: number
  sha256: string
}

export interface LocalEmbeddingModel {
  id: string
  version: string
  name: string
  capability?: LocalRagModelCapability
  language: string
  useCase: string
  dimension: number
  tokenizer: LocalEmbeddingTokenizer
  maxTokens: number
  sizeBytes: number
  downloadBaseUrl: string
  sourceUrl?: string
  publisher?: string
  upstreamModel?: string
  upstreamContributors?: readonly string[]
  license?: string
  attribution?: string
  bundledIn: readonly string[]
  files: readonly LocalEmbeddingModelFile[]
}

export interface LocalEmbeddingModelView {
  model: LocalEmbeddingModel
  status: LocalEmbeddingModelStatus
  source: LocalEmbeddingModelSource | 'none'
  active: boolean
  downloaded: boolean
  bundled: boolean
  bytes: number
}

export interface LocalEmbeddingModelPreference {
  localEmbeddingModelId?: string | null
  localEmbeddingModelSource?: LocalEmbeddingModelSource | 'none' | null
}

export interface LocalEmbeddingModelSelection {
  model: LocalEmbeddingModel
  source: LocalEmbeddingModelSource
  reason: 'requested' | 'downloaded-fallback' | 'bundled-fallback'
}

export interface LocalModelStateReconciliation {
  records: Readonly<Record<string, LocalModelStateRecord>>
  failed: Readonly<Record<string, string>>
  installedModelIds: readonly string[]
  orphanedModelIds: readonly string[]
}

export interface LocalEmbeddingModelAvailabilityPort {
  verify(
    model: LocalEmbeddingModel,
    source: LocalEmbeddingModelSource,
    signal?: AbortSignal,
  ): Promise<boolean>
}

export interface LocalEmbeddingModelCatalogPolicyOptions {
  signal?: AbortSignal
}

export interface LocalEmbeddingModelCatalogPolicy {
  readonly models: readonly LocalEmbeddingModel[]
  readonly capabilities: readonly LocalRagModelCapability[]
  readonly bundledModelIds: readonly string[]
  getModel(modelId: string | null | undefined): LocalEmbeddingModel | null
  requireModel(modelId: string): LocalEmbeddingModel
  reconcileInstalledState(state: LocalModelStateSnapshot): LocalModelStateReconciliation
  listModelViews(
    preference: LocalEmbeddingModelPreference,
    options?: LocalEmbeddingModelCatalogPolicyOptions,
  ): Promise<LocalEmbeddingModelView[]>
  resolveActiveModel(
    preference: LocalEmbeddingModelPreference,
    options?: LocalEmbeddingModelCatalogPolicyOptions,
  ): Promise<LocalEmbeddingModelSelection | null>
  cacheKey(preference: LocalEmbeddingModelPreference): string
}

export interface LocalEmbeddingModelCatalogPolicyDependencies {
  catalog: unknown
  bundledModelIds: unknown
  stateRepository: LocalModelStateRepository
  availability: LocalEmbeddingModelAvailabilityPort
}

const boundedLabelSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_LABEL_LENGTH))
const boundedDescriptionSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_DESCRIPTION_LENGTH))
const modelIdSchema = v.pipe(
  v.string(),
  v.minLength(1),
  v.maxLength(MAX_MODEL_ID_LENGTH),
  v.regex(/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/),
)
const urlSchema = v.pipe(
  v.string(),
  v.minLength(1),
  v.maxLength(MAX_URL_LENGTH),
  v.url(),
  v.check((value) => value.startsWith('https://'), 'Local-model URLs must use HTTPS.'),
)
const nonNegativeIntegerSchema = (maximum: number) => v.pipe(
  v.number(),
  v.finite(),
  v.integer(),
  v.minValue(0),
  v.maxValue(maximum),
)
const filePathSchema = v.pipe(
  v.string(),
  v.minLength(1),
  v.maxLength(MAX_FILE_PATH_LENGTH),
  v.check(isSafeRelativeFilePath, 'Local-model file paths must be safe relative paths.'),
)
const fileHashSchema = v.pipe(
  v.string(),
  v.maxLength(64),
  v.check(
    (value) => /^[a-f0-9]{64}$/i.test(value) || value === 'placeholder-to-be-verified',
    'Local-model file hashes must be SHA-256 values or the explicit unverified placeholder.',
  ),
)
const modelFileSchema = v.object({
  path: filePathSchema,
  bytes: nonNegativeIntegerSchema(MAX_FILE_BYTES),
  sha256: fileHashSchema,
})
const modelSchema = v.object({
  id: modelIdSchema,
  version: boundedLabelSchema,
  name: boundedLabelSchema,
  capability: v.optional(v.picklist(LOCAL_RAG_MODEL_CAPABILITIES)),
  language: boundedLabelSchema,
  useCase: boundedDescriptionSchema,
  dimension: nonNegativeIntegerSchema(MAX_MODEL_DIMENSION),
  tokenizer: v.picklist(['wordpiece', 'unigram', 'sentencepiece']),
  maxTokens: nonNegativeIntegerSchema(MAX_MODEL_TOKENS),
  sizeBytes: nonNegativeIntegerSchema(MAX_MODEL_BYTES),
  downloadBaseUrl: urlSchema,
  sourceUrl: v.optional(urlSchema),
  publisher: v.optional(boundedLabelSchema),
  upstreamModel: v.optional(boundedLabelSchema),
  upstreamContributors: v.optional(v.pipe(v.array(boundedLabelSchema), v.maxLength(MAX_CONTRIBUTORS))),
  license: v.optional(boundedLabelSchema),
  attribution: v.optional(boundedDescriptionSchema),
  bundledIn: v.pipe(v.array(boundedLabelSchema), v.maxLength(MAX_BUNDLE_VARIANTS)),
  files: v.pipe(v.array(modelFileSchema), v.maxLength(LOCAL_MODEL_CATALOG_MAX_FILES_PER_MODEL)),
})
const catalogSchema = v.object({
  schema: v.literal(LOCAL_MODEL_CATALOG_SCHEMA),
  models: v.pipe(v.array(modelSchema), v.maxLength(LOCAL_MODEL_CATALOG_MAX_MODELS)),
})
const bundledModelIdsSchema = v.pipe(
  v.array(modelIdSchema),
  v.maxLength(LOCAL_MODEL_CATALOG_MAX_MODELS),
)

export function createLocalEmbeddingModelCatalogPolicy(
  dependencies: LocalEmbeddingModelCatalogPolicyDependencies,
): LocalEmbeddingModelCatalogPolicy {
  const parsedCatalog = v.parse(catalogSchema, dependencies.catalog)
  const models = parsedCatalog.models.map(cloneModel)
  const modelsById = new Map<string, LocalEmbeddingModel>()
  for (const model of models) {
    if (modelsById.has(model.id)) {
      throw new Error(`The local-model catalog contains duplicate model id: ${model.id}`)
    }
    assertUniqueModelFiles(model)
    modelsById.set(model.id, model)
  }

  const bundledModelIds = v.parse(bundledModelIdsSchema, dependencies.bundledModelIds)
  const uniqueBundledModelIds = new Set(bundledModelIds)
  if (uniqueBundledModelIds.size !== bundledModelIds.length) {
    throw new Error('The local-model bundle contains duplicate model ids.')
  }
  for (const modelId of bundledModelIds) {
    if (!modelsById.has(modelId)) {
      throw new Error(`The local-model bundle references unknown model: ${modelId}`)
    }
  }
  const bundledIds = [...bundledModelIds]
  const bundledIdSet = new Set(bundledIds)

  function getModel(modelId: string | null | undefined): LocalEmbeddingModel | null {
    if (modelId === null || modelId === undefined || modelId === '') return null
    const parsedModelId = v.parse(modelIdSchema, modelId)
    return modelsById.get(parsedModelId) ?? null
  }

  function requireModel(modelId: string): LocalEmbeddingModel {
    const model = getModel(modelId)
    if (!model) throw new Error(`Unknown local embedding model: ${modelId}`)
    return model
  }

  function reconcileInstalledState(state: LocalModelStateSnapshot): LocalModelStateReconciliation {
    const records: Record<string, LocalModelStateRecord> = {}
    const failed: Record<string, string> = {}
    const orphanedModelIds: string[] = []

    for (const [modelId, record] of Object.entries(state.records)) {
      if (!modelsById.has(modelId)) {
        orphanedModelIds.push(modelId)
        continue
      }
      records[modelId] = cloneStateRecord(record)
    }
    for (const [modelId, failure] of Object.entries(state.failed)) {
      if (!modelsById.has(modelId)) {
        if (!orphanedModelIds.includes(modelId)) orphanedModelIds.push(modelId)
        continue
      }
      failed[modelId] = failure
    }

    return {
      records,
      failed,
      installedModelIds: models
        .filter((model) => records[model.id]?.source === 'downloaded')
        .map((model) => model.id),
      orphanedModelIds,
    }
  }

  async function listModelViews(
    preference: LocalEmbeddingModelPreference,
    options: LocalEmbeddingModelCatalogPolicyOptions = {},
  ): Promise<LocalEmbeddingModelView[]> {
    const normalizedPreference = parsePreference(preference)
    throwIfAborted(options.signal)
    const state = reconcileInstalledState(await dependencies.stateRepository.loadState({ signal: options.signal }))
    throwIfAborted(options.signal)

    return models.map((model) => projectModelView(
      model,
      normalizedPreference,
      state,
      bundledIdSet,
    ))
  }

  async function resolveActiveModel(
    preference: LocalEmbeddingModelPreference,
    options: LocalEmbeddingModelCatalogPolicyOptions = {},
  ): Promise<LocalEmbeddingModelSelection | null> {
    const normalizedPreference = parsePreference(preference)
    throwIfAborted(options.signal)

    const requested = getModel(normalizedPreference.localEmbeddingModelId)
    const requestedSource = normalizedPreference.localEmbeddingModelSource
    if (
      requested
      && isRunnableModel(requested)
      && (requestedSource === 'downloaded' || requestedSource === 'bundled')
      && await verifyAvailability(requested, requestedSource, options.signal)
    ) {
      return { model: requested, source: requestedSource, reason: 'requested' }
    }

    const state = reconcileInstalledState(await dependencies.stateRepository.loadState({ signal: options.signal }))
    throwIfAborted(options.signal)
    for (const model of models) {
      if (
        isRunnableModel(model)
        && state.records[model.id]?.source === 'downloaded'
        && await verifyAvailability(model, 'downloaded', options.signal)
      ) {
        return { model, source: 'downloaded', reason: 'downloaded-fallback' }
      }
    }
    for (const modelId of bundledIds) {
      const model = modelsById.get(modelId)
      if (
        model
        && isRunnableModel(model)
        && await verifyAvailability(model, 'bundled', options.signal)
      ) {
        return { model, source: 'bundled', reason: 'bundled-fallback' }
      }
    }
    return null
  }

  function cacheKey(preference: LocalEmbeddingModelPreference): string {
    const normalizedPreference = parsePreference(preference)
    const id = normalizedPreference.localEmbeddingModelId ?? 'auto'
    const source = normalizedPreference.localEmbeddingModelSource ?? 'none'
    return `local:${source}:${id}:bundled:${bundledIds.join(',')}`
  }

  async function verifyAvailability(
    model: LocalEmbeddingModel,
    source: LocalEmbeddingModelSource,
    signal?: AbortSignal,
  ): Promise<boolean> {
    throwIfAborted(signal)
    const available = await dependencies.availability.verify(model, source, signal)
    throwIfAborted(signal)
    return available
  }

  return {
    models,
    capabilities: LOCAL_RAG_MODEL_CAPABILITIES,
    bundledModelIds: bundledIds,
    getModel,
    requireModel,
    reconcileInstalledState,
    listModelViews,
    resolveActiveModel,
    cacheKey,
  }
}

export function formatLocalModelBytes(bytes: number): string {
  const normalizedBytes = v.parse(nonNegativeIntegerSchema(MAX_MODEL_BYTES), bytes)
  if (normalizedBytes < 1_024) return `${normalizedBytes} B`
  if (normalizedBytes < 1_024 * 1_024) return `${(normalizedBytes / 1_024).toFixed(1)} KB`
  return `${(normalizedBytes / 1_024 / 1_024).toFixed(1)} MB`
}

function projectModelView(
  model: LocalEmbeddingModel,
  preference: LocalEmbeddingModelPreference,
  state: LocalModelStateReconciliation,
  bundledIdSet: ReadonlySet<string>,
): LocalEmbeddingModelView {
  const planned = !isRunnableModel(model)
  const record = state.records[model.id]
  const bundled = bundledIdSet.has(model.id)
  const downloaded = record?.source === 'downloaded'
  const active = !planned
    && preference.localEmbeddingModelId === model.id
    && preference.localEmbeddingModelSource !== 'none'
  const failed = state.failed[model.id]
  const source = active
    ? preference.localEmbeddingModelSource === 'downloaded'
      || preference.localEmbeddingModelSource === 'bundled'
      ? preference.localEmbeddingModelSource
      : bundled
        ? 'bundled'
        : downloaded
          ? 'downloaded'
          : 'none'
    : downloaded
      ? 'downloaded'
      : bundled
        ? 'bundled'
        : 'none'
  const status: LocalEmbeddingModelStatus = planned
    ? 'planned'
    : active
      ? 'enabled'
      : failed
        ? 'verify-failed'
        : downloaded
          ? 'downloaded'
          : bundled
            ? 'bundled'
            : 'not-downloaded'

  return {
    model,
    status,
    source,
    active,
    downloaded,
    bundled,
    bytes: record?.bytes ?? model.sizeBytes,
  }
}

function parsePreference(preference: LocalEmbeddingModelPreference): LocalEmbeddingModelPreference {
  if (!preference || typeof preference !== 'object' || Array.isArray(preference)) {
    throw new Error('The local-model preference is invalid.')
  }
  const modelId = preference.localEmbeddingModelId
  const source = preference.localEmbeddingModelSource
  if (modelId !== undefined && modelId !== null) v.parse(modelIdSchema, modelId)
  if (
    source !== undefined
    && source !== null
    && source !== 'none'
    && source !== 'bundled'
    && source !== 'downloaded'
  ) {
    throw new Error('The local-model source preference is invalid.')
  }
  return {
    ...(modelId === undefined ? {} : { localEmbeddingModelId: modelId }),
    ...(source === undefined ? {} : { localEmbeddingModelSource: source }),
  }
}

function cloneModel(model: v.InferOutput<typeof modelSchema>): LocalEmbeddingModel {
  return {
    ...model,
    ...(model.upstreamContributors
      ? { upstreamContributors: [...model.upstreamContributors] }
      : {}),
    bundledIn: [...model.bundledIn],
    files: model.files.map((file) => ({ ...file })),
  }
}

function cloneStateRecord(record: LocalModelStateRecord): LocalModelStateRecord {
  return {
    ...record,
    ...(record.sha256 ? { sha256: { ...record.sha256 } } : {}),
  }
}

function assertUniqueModelFiles(model: LocalEmbeddingModel): void {
  const paths = new Set<string>()
  for (const file of model.files) {
    if (paths.has(file.path)) {
      throw new Error(`Local model ${model.id} contains duplicate file path: ${file.path}`)
    }
    paths.add(file.path)
  }
}

function isSafeRelativeFilePath(value: string): boolean {
  if (value.startsWith('/') || value.startsWith('\\') || value.includes('\\')) return false
  const segments = value.split('/')
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

function isRunnableModel(model: LocalEmbeddingModel): boolean {
  return model.files.length > 0 && model.sizeBytes > 0
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  throw error
}
