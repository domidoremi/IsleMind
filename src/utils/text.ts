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

export interface ParsedModelEntries {
  models: string[]
  aliases: Array<{ alias: string; model: string }>
}

export function parseModelEntries(text: string | undefined): ParsedModelEntries {
  const models = new Set<string>()
  const aliasByName = new Map<string, { alias: string; model: string }>()
  for (const rawLine of (text ?? '').split(/[\n,，|]+/)) {
    const line = rawLine.trim()
    if (!line) continue
    const aliasMatch = line.match(/^(.+?)\s*(?:=>|->|=|:)\s*(.+)$/)
    if (aliasMatch) {
      const alias = aliasMatch[1]?.trim()
      const model = aliasMatch[2]?.trim()
      if (!alias || !model || alias === model) {
        if (model) models.add(model)
        continue
      }
      aliasByName.set(alias.toLowerCase(), { alias, model })
      models.add(model)
      continue
    }
    models.add(line)
  }
  return {
    models: Array.from(models),
    aliases: Array.from(aliasByName.values()),
  }
}
