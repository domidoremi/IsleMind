import * as v from 'valibot'
import { DEFAULT_RUN_BUDGET } from './application/runBudget'

export const AGENT_DEFINITION_SCHEMA = 'islemind.agent-definition' as const
export const AGENT_DEFINITION_VERSION = 1 as const
export const MAX_AGENT_DEFINITION_BYTES = 64 * 1024
export const AGENT_ACTION_CAPABILITIES = ['native_tool_calling', 'validated_structured_actions', 'text_only'] as const

const integer = (min: number, max: number) => v.pipe(v.number(), v.integer(), v.minValue(min), v.maxValue(max))
const idSchema = v.pipe(v.string(), v.maxLength(128), v.regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/))
const referenceList = (max: number) => v.pipe(v.array(idSchema), v.maxLength(max), v.check((ids) => new Set(ids).size === ids.length))
const modelIdSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(512),
  v.check((id) => id.trim() === id && !/[\s\x00-\x1f\x7f]/.test(id) && !id.includes('://')))

/** References and instructions only. Capability claims are not execution permission or evidence. */
export const agentDefinitionSchema = v.pipe(v.strictObject({
  schema: v.literal(AGENT_DEFINITION_SCHEMA),
  version: v.literal(AGENT_DEFINITION_VERSION),
  id: idSchema,
  revision: integer(1, Number.MAX_SAFE_INTEGER),
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(120), v.check((name) => !!name.trim())),
  instructions: v.pipe(v.string(), v.maxLength(24_000)),
  modelBinding: v.strictObject({
    providerId: idSchema,
    modelId: modelIdSchema,
    actionCapability: v.picklist(AGENT_ACTION_CAPABILITIES),
    capabilityRevision: v.pipe(v.string(), v.minLength(1), v.maxLength(128), v.check((revision) => !!revision.trim())),
  }),
  allowedToolIds: referenceList(128),
  knowledgeIds: referenceList(128),
  skillIds: referenceList(128),
  delegateAgentIds: referenceList(6),
  reviewerPolicy: v.strictObject({
    mode: v.picklist(['off', 'read_only']),
    agentId: v.optional(idSchema),
    maxReviews: integer(0, 2),
  }),
  budget: v.strictObject({
    modelRequests: integer(1, 256),
    tools: integer(1, 512),
    tokens: integer(1, 10_000_000),
    activeMs: integer(1, 24 * 60 * 60_000),
    amountUsd: v.optional(v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(1_000_000))),
  }),
  children: v.strictObject({ maxConcurrent: integer(0, 2), maxTotal: integer(0, 6), maxDepth: integer(0, 1) }),
}), v.check((definition) => !definition.delegateAgentIds.includes(definition.id)
  && definition.reviewerPolicy.agentId !== definition.id
  && (definition.reviewerPolicy.mode === 'off'
    ? definition.reviewerPolicy.maxReviews === 0 && definition.reviewerPolicy.agentId === undefined
    : definition.reviewerPolicy.maxReviews > 0 && definition.reviewerPolicy.agentId !== undefined)
  && definition.children.maxConcurrent <= definition.children.maxTotal
  && (definition.children.maxDepth > 0 || definition.children.maxTotal === 0)))

export type AgentDefinition = v.InferOutput<typeof agentDefinitionSchema>
export type AgentActionCapability = AgentDefinition['modelBinding']['actionCapability']
type DeepReadonly<T> = T extends readonly (infer Item)[] ? readonly DeepReadonly<Item>[]
  : T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> } : T
export type FrozenAgentDefinition = DeepReadonly<AgentDefinition>

export function parseAgentDefinition(value: unknown): AgentDefinition {
  assertPlainDefinitionData(value)
  const definition = v.parse(agentDefinitionSchema, value)
  assertDefinitionSize(JSON.stringify(definition))
  return definition
}

export function decodeAgentDefinition(json: string): AgentDefinition {
  assertDefinitionSize(json)
  return parseAgentDefinition(JSON.parse(json))
}

export function encodeAgentDefinition(definition: AgentDefinition): string {
  // Compact encoding ensures every valid stored definition also fits the import boundary.
  const json = JSON.stringify(parseAgentDefinition(definition))
  assertDefinitionSize(json)
  return json
}

/** Bounded data-only backup. Strict definition parsing excludes execution/approval state. */
export function parseAgentDefinitions(value: unknown): AgentDefinition[] {
  if (!Array.isArray(value) || value.length > 256) throw new Error('Agent definition collection exceeds limit')
  const definitions = value.map(parseAgentDefinition).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  if (new Set(definitions.map((definition) => definition.id)).size !== definitions.length) throw new Error('Duplicate agent identity')
  let bytes = 0
  for (const definition of definitions) {
    bytes += new TextEncoder().encode(JSON.stringify(definition)).byteLength
    if (bytes > 8 * 1024 * 1024) throw new Error('Agent backup exceeds limit')
  }
  return definitions
}

export function createAgentDefinition(input: Pick<AgentDefinition, 'id' | 'name'> & Pick<AgentDefinition['modelBinding'], 'providerId' | 'modelId'>): AgentDefinition {
  return parseAgentDefinition({ schema: AGENT_DEFINITION_SCHEMA, version: AGENT_DEFINITION_VERSION,
    id: input.id, revision: 1, name: input.name, instructions: '',
    modelBinding: { providerId: input.providerId, modelId: input.modelId, actionCapability: 'text_only', capabilityRevision: 'unverified' },
    allowedToolIds: [], knowledgeIds: [], skillIds: [], delegateAgentIds: [],
    reviewerPolicy: { mode: 'off', maxReviews: 0 }, budget: { ...DEFAULT_RUN_BUDGET },
    children: { maxConcurrent: 2, maxTotal: 6, maxDepth: 1 },
  })
}

/** Clone before freezing; a later settings edit must never mutate an existing run binding. */
export function freezeAgentDefinition(definition: AgentDefinition): FrozenAgentDefinition {
  return deepFreeze(parseAgentDefinition(definition))
}

/** A requested allowlist, never a grant. Runtime must intersect it with current capability evidence and policy. */
export function getAgentDefinitionToolIds(definition: FrozenAgentDefinition): readonly string[] {
  return definition.modelBinding.actionCapability === 'text_only' ? [] : [...definition.allowedToolIds]
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value as DeepReadonly<T>
}

function assertDefinitionSize(json: string): void {
  if (json.length > MAX_AGENT_DEFINITION_BYTES || new TextEncoder().encode(json).byteLength > MAX_AGENT_DEFINITION_BYTES) {
    throw new Error('Agent definition exceeds size limit')
  }
}

function assertPlainDefinitionData(value: unknown): void {
  let visited = 0
  const visit = (item: unknown, depth: number): void => {
    if (++visited > 2_048 || depth > 6) throw new Error('Agent definition nesting exceeds limit')
    if (!item || typeof item !== 'object') return
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new Error('Agent definition must be plain data')
    for (const key of Object.keys(item)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error('Unsafe agent definition key')
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!
      if (!('value' in descriptor)) throw new Error('Agent definition must not contain accessors')
      visit(descriptor.value, depth + 1)
    }
  }
  visit(value, 0)
}
