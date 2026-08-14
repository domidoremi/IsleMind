export function stableIdentityHash(input: unknown): string {
  const text = stableIdentityString(input)
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash.toString(36)
}

export function stableIdentityString(input: unknown): string {
  if (input === null || input === undefined) return 'null'
  if (Array.isArray(input)) return `[${input.map(stableIdentityString).join(',')}]`
  if (typeof input === 'object') {
    const record = input as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableIdentityString(record[key])}`)
      .join(',')}}`
  }
  if (typeof input === 'number') return Number.isFinite(input) ? input.toString() : '0'
  if (typeof input === 'boolean') return input ? 'true' : 'false'
  return JSON.stringify(String(input))
}
