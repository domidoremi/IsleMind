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
