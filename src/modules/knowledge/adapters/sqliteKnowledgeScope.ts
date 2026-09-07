import type { KnowledgeScope } from '../domain/knowledgeScope'

/** Apply the existing document/title selection before candidate limits, not after ranking. */
export function sqliteKnowledgeScope(scope?: KnowledgeScope): { sql: string; parameters: string[] } {
  if (!scope) return { sql: '1 = 1', parameters: [] }
  const ids = [...scope.ids]
  const terms = [...scope.terms]
  const predicates: string[] = []
  if (ids.length) predicates.push(`LOWER(TRIM(c.documentId)) IN (${ids.map(() => '?').join(', ')})`)
  for (const _term of terms) predicates.push('INSTR(LOWER(TRIM(c.title)), ?) > 0')
  return { sql: predicates.length ? `(${predicates.join(' OR ')})` : '0 = 1', parameters: [...ids, ...terms] }
}
