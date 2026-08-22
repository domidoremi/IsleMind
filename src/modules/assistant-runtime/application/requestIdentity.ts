/**
 * Stable, bounded identities for diagnostic request evidence.
 * These values detect planning drift; they are not authorization or replay
 * tokens and deliberately use a versioned non-cryptographic format.
 */
export function buildAssistantRequestHash(value: unknown): string {
  return `stable-v1:${hashStableValue(value)}`
}

export function buildAssistantCapabilityRevision(value: unknown): string {
  const record = asRecord(value)
  const provider = asRecord(record?.provider)
  return `capabilities-v1:${hashStableValue({
    providerId: stringValue(record?.providerId) ?? stringValue(provider?.id),
    model: stringValue(record?.model) ?? stringValue(record?.requestedModel),
    requestedCapabilities: stringList(record?.requestedCapabilities),
    toolDefinitions: capabilityDefinitions(record?.toolDefinitions),
    providerToolDeclarations: capabilityDefinitions(record?.providerToolDeclarations),
    webSearchMode: stringValue(record?.webSearchMode),
    remoteCompactEligible: record?.remoteCompactEligible === true,
    remoteCompactFallback: record?.remoteCompactFallback !== undefined,
    structuredOutput: record?.structuredOutput !== undefined,
    attachments: attachmentCapabilities(record?.attachments),
  })}`
}

export function isAssistantRequestHash(value: unknown): value is string {
  return typeof value === 'string' && /^stable-v1:[0-9a-f]{16}$/.test(value)
}

export function isAssistantCapabilityRevision(value: unknown): value is string {
  return typeof value === 'string' && /^capabilities-v1:[0-9a-f]{16}$/.test(value)
}

function hashStableValue(value: unknown): string {
  const text = stableString(value)
  let first = 2_166_136_261
  let second = 2_246_822_519
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    first = Math.imul(first ^ code, 16_777_619) >>> 0
    second = Math.imul(second ^ code, 3_266_489_917) >>> 0
  }
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`
}

function stableString(value: unknown, seen = new WeakSet<object>(), depth = 0): string {
  if (depth > 64) return '"[depth-limit]"'
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') return Number.isFinite(value) ? value.toString() : '0'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'bigint') return JSON.stringify(`${value.toString()}n`)
  if (typeof value !== 'object') return JSON.stringify(String(value))
  if (seen.has(value)) return '"[cycle]"'
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => stableString(item, seen, depth + 1)).join(',')}]`
    }
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => (
      `${JSON.stringify(key)}:${stableString(record[key], seen, depth + 1)}`
    )).join(',')}}`
  } finally {
    seen.delete(value)
  }
}

function capabilityDefinitions(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 64).map((candidate) => {
    const record = asRecord(candidate)
    if (!record) return typeof candidate === 'string' ? candidate.slice(0, 160) : null
    return {
      id: stringValue(record.id) ?? stringValue(record.operationId),
      name: stringValue(record.name),
      permission: stringValue(record.permission),
      type: stringValue(record.type),
      inputSchema: record.inputSchema,
    }
  })
}

function attachmentCapabilities(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 64).map((candidate) => {
    const record = asRecord(candidate)
    if (!record) return null
    return {
      type: stringValue(record.type),
      mimeType: stringValue(record.mimeType),
      size: typeof record.size === 'number' && Number.isFinite(record.size) ? record.size : undefined,
    }
  })
}

function stringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value
    .filter((candidate): candidate is string => typeof candidate === 'string')
    .map((candidate) => candidate.trim().slice(0, 128))
    .filter(Boolean)))
    .sort()
    .slice(0, 64)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 320) : undefined
}
