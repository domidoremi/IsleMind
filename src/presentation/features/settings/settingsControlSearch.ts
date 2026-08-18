export interface SettingsControlSearchDocument {
  title: string
  detail: string
  searchTerms?: readonly string[]
}

export function normalizeSettingsControlSearch(value: string): string {
  return value.trim().toLocaleLowerCase()
}

export function matchesSettingsControlSearch(
  entry: SettingsControlSearchDocument,
  normalizedSearch: string
): boolean {
  if (!normalizedSearch) return true
  return [entry.title, entry.detail, ...(entry.searchTerms ?? [])]
    .join(' ')
    .toLocaleLowerCase()
    .includes(normalizedSearch)
}
