export interface ToolInputSchemaValidationResult {
  ok: boolean
  errors: string[]
}

export function validateToolInputSchema(
  schema: Record<string, unknown> | undefined,
  argumentsValue: Record<string, unknown> = {},
): ToolInputSchemaValidationResult {
  if (!schema) return { ok: true, errors: [] }
  const errors: string[] = []
  if (schema.type && schema.type !== 'object') return { ok: false, errors: ['Only object input schemas are supported.'] }
  validateObject('', argumentsValue, schema, errors)
  return { ok: errors.length === 0, errors }
}

function validateObject(path: string, value: Record<string, unknown>, rules: Record<string, unknown>, errors: string[]): void {
  const properties = isRecord(rules.properties) ? rules.properties as Record<string, Record<string, unknown>> : {}
  const required = Array.isArray(rules.required) ? rules.required.filter((item): item is string => typeof item === 'string') : []
  for (const key of required) if (value[key] === undefined || value[key] === null) errors.push(`${joinPath(path, key)} is required.`)
  if (rules.additionalProperties === false) {
    const knownKeys = new Set(Object.keys(properties))
    for (const key of Object.keys(value)) if (!knownKeys.has(key)) errors.push(`${joinPath(path, key)} is not allowed.`)
  }
  for (const [key, childRules] of Object.entries(properties)) {
    const child = value[key]
    if (child !== undefined && child !== null) validateValue(joinPath(path, key), child, childRules, errors)
  }
}

function validateValue(path: string, value: unknown, rules: Record<string, unknown>, errors: string[]): void {
  const allowedTypes = Array.isArray(rules.type)
    ? rules.type.filter((item): item is string => typeof item === 'string')
    : typeof rules.type === 'string' ? [rules.type] : []
  if (allowedTypes.length && !allowedTypes.some((type) => matchesJsonType(value, type))) {
    errors.push(`${path} must be ${allowedTypes.join(' or ')}.`)
  }
  if (Array.isArray(rules.enum) && !rules.enum.includes(value)) errors.push(`${path} must be one of ${rules.enum.map(String).join(', ')}.`)
  if (typeof value === 'number') {
    if (typeof rules.minimum === 'number' && value < rules.minimum) errors.push(`${path} must be >= ${rules.minimum}.`)
    if (typeof rules.maximum === 'number' && value > rules.maximum) errors.push(`${path} must be <= ${rules.maximum}.`)
  }
  if (typeof value === 'string') {
    if (typeof rules.minLength === 'number' && value.length < rules.minLength) errors.push(`${path} must be at least ${rules.minLength} characters.`)
    if (typeof rules.maxLength === 'number' && value.length > rules.maxLength) errors.push(`${path} must be at most ${rules.maxLength} characters.`)
    if (typeof rules.pattern === 'string') {
      try { if (!new RegExp(rules.pattern).test(value)) errors.push(`${path} must match pattern ${rules.pattern}.`) }
      catch { errors.push(`${path} has an invalid schema pattern.`) }
    }
  }
  if (Array.isArray(value)) {
    if (typeof rules.minItems === 'number' && value.length < rules.minItems) errors.push(`${path} must include at least ${rules.minItems} item(s).`)
    if (typeof rules.maxItems === 'number' && value.length > rules.maxItems) errors.push(`${path} must include at most ${rules.maxItems} item(s).`)
    if (isRecord(rules.items)) value.forEach((item, index) => validateValue(`${path}[${index}]`, item, rules.items as Record<string, unknown>, errors))
  }
  if (isRecord(value)) validateObject(path, value, rules, errors)
}

function matchesJsonType(value: unknown, type: string): boolean {
  if (type === 'array') return Array.isArray(value)
  if (type === 'integer') return Number.isInteger(value)
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'object') return isRecord(value)
  if (type === 'boolean') return typeof value === 'boolean'
  if (type === 'string') return typeof value === 'string'
  if (type === 'null') return value === null
  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function joinPath(parent: string, key: string): string {
  return parent ? `${parent}.${key}` : key
}
