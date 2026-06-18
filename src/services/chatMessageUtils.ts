import type { Message, RetrievalSource } from '@/types'

export type ChatMessageCitation = NonNullable<Message['citations']>[number]

export function normalizeUserContent(content: string): string {
  return content.replace(/%20/g, ' ').trim()
}

export function dedupeMessageCitations(citations: RetrievalSource[] | ChatMessageCitation[]): ChatMessageCitation[] {
  const map = new Map<string, ChatMessageCitation>()
  for (const citation of citations) {
    const key = citation.chunkId ?? citation.url ?? citation.id
    if (!map.has(key)) map.set(key, citation)
  }
  return Array.from(map.values())
}

export function formatWebPrompt(sources: { title: string; content: string; url?: string }[]): string {
  return [
    '以下是联网搜索结果。请优先引用来源 URL，并避免编造未出现的信息。',
    ...sources.map((source, index) => `[W${index + 1}] ${source.title}${source.url ? `\n${source.url}` : ''}\n${source.content}`),
  ].join('\n\n')
}
