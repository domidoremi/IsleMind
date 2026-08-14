import type { KnowledgeChunkRecord } from '../contracts'

export type KnowledgeChunkMetadata = Pick<
  KnowledgeChunkRecord,
  'semanticBoundary' | 'headingPath' | 'entities' | 'relations' | 'qualityScore' | 'rerankSignals'
>

/** Restores the metadata historically synthesized for portable snapshot chunks. */
export function buildKnowledgeChunkMetadata(content: string, title: string): KnowledgeChunkMetadata {
  const headingPath = inferHeadingPath(content, title)
  const entities = extractEntities(content)
  const semanticBoundary = inferSemanticBoundary(content)
  const qualityScore = estimateQuality(content)
  return {
    semanticBoundary,
    headingPath,
    entities,
    relations: buildEntityRelations(entities),
    qualityScore,
    rerankSignals: {
      length: Math.min(1, content.length / 1200),
      structure: semanticBoundary === 'heading' || semanticBoundary === 'list' ? 1 : 0,
      entityDensity: Math.min(1, entities.length / 8),
      quality: qualityScore,
    },
  }
}

function inferHeadingPath(content: string, title: string): string[] {
  const headings = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^#{1,6}\s+/.test(line))
    .map((line) => line.replace(/^#{1,6}\s+/, '').trim())
    .slice(0, 4)
  return [title, ...headings].filter(Boolean)
}

function inferSemanticBoundary(content: string): string {
  const firstLine = content.split('\n').map((line) => line.trim()).find(Boolean)
  if (!firstLine) return 'body'
  if (/^#{1,6}\s+/.test(firstLine)) return 'heading'
  if (/^[-*]\s+|\d+[.)]\s+/.test(firstLine)) return 'list'
  return 'sentence'
}

function extractEntities(content: string): string[] {
  const entities = new Set<string>()
  for (const match of content.match(/\b[A-Z][A-Za-z0-9_-]{2,}\b/g) ?? []) entities.add(match)
  for (const match of content.match(/[\u3400-\u9fff]{2,10}/g) ?? []) {
    if (!/^(这个|那个|我们|你们|他们|以及|或者|但是|因为|所以)$/.test(match)) entities.add(match)
  }
  return Array.from(entities).slice(0, 16)
}

function buildEntityRelations(entities: readonly string[]): string[] {
  const relations: string[] = []
  for (let index = 0; index < Math.min(entities.length - 1, 8); index += 1) {
    relations.push(`${entities[index]}->${entities[index + 1]}`)
  }
  return relations
}

function estimateQuality(content: string): number {
  const trimmed = content.trim()
  if (!trimmed) return 0
  const lengthScore = trimmed.length < 120
    ? trimmed.length / 120
    : trimmed.length <= 1600
      ? 1
      : Math.max(0.4, 1 - (trimmed.length - 1600) / 3200)
  const structure = /(^|\n)#{1,6}\s|\n[-*]\s|\n\d+[.)]/.test(trimmed) ? 0.1 : 0
  const sentenceCount = (trimmed.match(/[。！？.!?]/g) ?? []).length
  return Number(Math.min(1, 0.78 * lengthScore + structure + Math.min(0.12, sentenceCount / 24)).toFixed(3))
}
