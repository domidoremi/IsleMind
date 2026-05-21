export function normalizeSearchText(value: string | undefined): string {
  return (value ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
}

export function parseModels(text: string | undefined): string[] {
  const seen = new Set<string>()
  return (text ?? '')
    .split(/[\n,，|]+/)
    .map((item) => item.trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false
      seen.add(item)
      return true
    })
}
