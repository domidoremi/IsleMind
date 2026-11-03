import type { MessageCitation } from '@/types/contextContracts'

// Captured-list position is not an inline citation label. Only an unambiguous
// exact identity can select a source; missing/duplicate IDs never select a peer.
export function resolveCapturedCitation(
  citations: readonly MessageCitation[],
  id: string | undefined,
): MessageCitation | undefined {
  if (typeof id !== 'string' || !id.trim()) return undefined
  let selected: MessageCitation | undefined
  for (const citation of citations) {
    if (citation.id !== id) continue
    if (selected) return undefined
    selected = citation
  }
  return selected
}

export function buildSourceCitationNavigation(citations: readonly MessageCitation[], id: string | undefined) {
  const counts = new Map<string, number>()
  citations.forEach(citation => counts.set(citation.id, (counts.get(citation.id) ?? 0) + 1))
  const selectable = new Set(citations.filter(citation => citation.id.trim() && counts.get(citation.id) === 1).map(citation => citation.id))
  const selected = resolveCapturedCitation(citations, id)
  const selectedIndex = selected ? citations.indexOf(selected) : -1
  const previous = selectedIndex < 0 ? undefined : citations.slice(0, selectedIndex).reverse().find(citation => selectable.has(citation.id))
  const next = selectedIndex < 0 ? undefined : citations.slice(selectedIndex + 1).find(citation => selectable.has(citation.id))
  return { selected, selectedIndex, selectable, previous, next }
}
