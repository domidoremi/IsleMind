import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import type { AIProvider, Conversation, Message, RetrievalSource } from '@/types'
import { generateText } from '@/services/ai/base'
import {
  addMemory,
  importKnowledgeText,
  initializeContextStore,
  listMemories,
  searchKnowledge,
  searchMemories,
} from '@/services/contextStore'
import { localDataStore } from '@/services/localDataStore'
import { useSettingsStore } from '@/store/settingsStore'

const TEXT_MIME_HINTS = ['text/', 'application/json', 'application/javascript', 'application/xml', 'text/xml', 'text/csv']
const MAX_CONTEXT_ITEMS = 8

export interface RetrievedContext {
  sources: RetrievalSource[]
  prompt: string
}

export async function retrieveContext(conversation: Conversation, draftMessage: Message): Promise<RetrievedContext> {
  try {
    await initializeContextStore()
  } catch {
    return { sources: [], prompt: '' }
  }
  const settings = useSettingsStore.getState().settings
  const query = [draftMessage.content, conversation.title, conversation.systemPrompt].filter(Boolean).join('\n')
  const provider = await useSettingsStore.getState().hydrateProviderKey(conversation.providerId)
  const groups = await Promise.all([
    settings.memoryEnabled ? searchMemories(query, settings.memoryTopK ?? 4) : Promise.resolve([]),
    settings.knowledgeEnabled && settings.ragMode !== 'off'
      ? searchKnowledgeSafely(query, settings.knowledgeTopK ?? 4, settings.ragMode ?? 'hybrid', settings.embeddingMode ?? 'hybrid', provider ?? undefined)
      : Promise.resolve([]),
  ])
  const sources = groups.flat().slice(0, MAX_CONTEXT_ITEMS)
  return {
    sources,
    prompt: formatContextPrompt(sources),
  }
}

export async function extractMemories(conversationId: string, messages: Message[], provider?: AIProvider, model?: string): Promise<string[]> {
  const settings = useSettingsStore.getState().settings
  if (!settings.memoryEnabled) return []
  const recent = messages
    .filter((message) => message.status === 'done' && message.content.trim())
    .slice(-6)
    .map((message) => `${message.role}: ${message.content}`)
    .join('\n')
  if (!recent) return []

  const deterministicItems = extractDeterministicMemoryItems(messages)
  let modelItems: string[] = []
  if (provider?.apiKey && model) {
    try {
      const result = await generateText({
        provider,
        model,
        systemPrompt: [
          '你只抽取长期有用、可复用、非敏感的用户偏好或事实。',
          '必须只返回 JSON 字符串数组，例如 ["用户偏好：使用中文回答"]。',
          '不要返回解释、Markdown、编号列表或额外文字；没有可用记忆就返回 []。',
          '不要抽取临时问题、一次性任务、验证码、API Key、Token、密码或隐私敏感内容。',
          '每项不超过 80 字。',
        ].join('\n'),
        messages: [{ role: 'user', content: recent }],
        temperature: 0.1,
        maxTokens: 512,
      })
      modelItems = parseMemoryItems(result)
    } catch {
      // Deterministic extraction keeps explicit user preferences usable even if
      // the provider declines the auxiliary memory request.
    }
  }

  const items = dedupeMemoryItems([...deterministicItems, ...modelItems])
  const existing = new Set(
    (await listMemories(['pending', 'active', 'disabled']))
      .map((item) => normalizeMemoryKey(item.content))
  )
  const added: string[] = []
  for (const item of items) {
    const key = normalizeMemoryKey(item)
    if (!key || existing.has(key)) continue
    const memory = await addMemory(item, conversationId, 'pending')
    if (memory) {
      existing.add(key)
      added.push(memory.content)
    }
  }
  return added
}

export async function importKnowledgeFile(provider?: AIProvider, model?: string): Promise<{ ok: boolean; message: string }> {
  await initializeContextStore()
  const picked = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    type: ['text/*', 'application/json', 'application/javascript', 'application/xml', 'text/xml', 'text/csv', 'application/pdf'],
  })
  if (picked.canceled || !picked.assets[0]) return { ok: false, message: '未选择文件。' }
  const asset = picked.assets[0]
  const mimeType = asset.mimeType || 'application/octet-stream'
  const size = asset.size ?? 0

  if (isTextMime(mimeType) || asset.name.match(/\.(md|txt|json|csv|xml|js|ts|tsx|jsx)$/i)) {
    const text = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.UTF8 })
    await importKnowledgeText({ title: asset.name, mimeType, size, text, sourceUri: asset.uri }, { provider, embeddingMode: useSettingsStore.getState().settings.embeddingMode ?? 'hybrid' })
    return { ok: true, message: `已导入 ${asset.name}` }
  }

  if (mimeType === 'application/pdf' || asset.name.toLowerCase().endsWith('.pdf')) {
    if (!provider?.apiKey || !model) {
      return { ok: false, message: '导入 PDF 需要先配置当前默认服务商的 API Key。' }
    }
    const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 })
    const text = await generateText({
      provider,
      model,
      systemPrompt: '请从用户提供的 PDF 中提取可检索的正文。只输出正文，不要总结，不要加解释。',
      messages: [{ role: 'user', content: '请提取这个 PDF 的正文，保留标题、小节和关键列表。' }],
      attachments: [{
        id: `${Date.now()}-pdf`,
        type: 'pdf',
        uri: asset.uri,
        name: asset.name,
        mimeType,
        size,
        base64,
      }],
      temperature: 0.1,
      maxTokens: 12000,
    })
    if (!text.trim()) return { ok: false, message: 'PDF 文本抽取失败，未写入知识库。' }
    await importKnowledgeText({ title: asset.name, mimeType, size, text, sourceUri: asset.uri }, { provider, embeddingMode: useSettingsStore.getState().settings.embeddingMode ?? 'hybrid' })
    return { ok: true, message: `已抽取并导入 ${asset.name}` }
  }

  return { ok: false, message: '暂不支持这个文件类型。' }
}

export async function importKnowledgePlainText(title: string, text: string, provider?: AIProvider): Promise<{ ok: boolean; message: string }> {
  await initializeContextStore()
  const content = text.trim()
  if (!content) return { ok: false, message: '文本为空，未导入。' }
  await importKnowledgeText(
    {
      title: title.trim() || `粘贴文本 ${new Date().toLocaleString()}`,
      mimeType: 'text/plain',
      size: content.length,
      text: content,
    },
    { provider, embeddingMode: useSettingsStore.getState().settings.embeddingMode ?? 'hybrid' }
  )
  return { ok: true, message: '已导入粘贴文本。' }
}

async function searchKnowledgeSafely(
  query: string,
  limit: number,
  ragMode: 'fts' | 'hybrid',
  embeddingMode: 'provider' | 'local' | 'hybrid',
  provider?: AIProvider
): Promise<RetrievalSource[]> {
  try {
    if (ragMode === 'hybrid') {
      return await localDataStore.searchHybrid(query, { limit, mode: 'hybrid', embeddingMode, provider })
    }
    return await searchKnowledge(query, limit)
  } catch {
    try {
      return await searchKnowledge(query, limit)
    } catch {
      return []
    }
  }
}

export async function searchWeb(query: string, limit = 5): Promise<RetrievalSource[]> {
  const apiKey = await useSettingsStore.getState().getTavilyApiKey()
  if (!apiKey || !query.trim()) return []
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      max_results: limit,
      search_depth: 'basic',
      include_answer: true,
      include_raw_content: false,
    }),
  })
  if (!response.ok) {
    throw new Error(`Tavily 搜索失败：${response.status}`)
  }
  const data = await response.json()
  const results = Array.isArray(data.results) ? data.results : []
  return results.slice(0, limit).map((item: { title?: string; url?: string; content?: string; score?: number }, index: number) => ({
    id: item.url || `tavily-${Date.now()}-${index}`,
    type: 'web',
    title: item.title || item.url || '网页来源',
    content: item.content || '',
    excerpt: item.content,
    url: item.url,
    score: item.score,
  }))
}

export function formatContextPrompt(sources: RetrievalSource[]): string {
  if (!sources.length) return ''
  return [
    '以下是本机上下文增强材料。请只在相关时使用；如果材料不足或不确定，请明确说明。',
    ...sources.map((source, index) => {
      const label = source.type === 'memory' ? '记忆' : source.type === 'knowledge' ? '知识库' : '联网搜索'
      return `[${index + 1}] ${label} - ${source.title}\n${source.content}`
    }),
  ].join('\n\n')
}

function parseMemoryItems(raw: string): string[] {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const jsonCandidates = [
    cleaned,
    cleaned.match(/\[[\s\S]*\]/)?.[0] ?? '',
  ].filter(Boolean)

  for (const candidate of jsonCandidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => {
            if (typeof item === 'string') return item
            if (item && typeof item === 'object') {
              const value = item as Record<string, unknown>
              return [value.memory, value.content, value.text, value.preference, value.fact]
                .find((field): field is string => typeof field === 'string')
            }
            return ''
          })
          .filter((item): item is string => typeof item === 'string')
          .map(normalizeMemoryText)
          .filter(isUsefulMemoryItem)
          .slice(0, 5)
      }
    } catch {}
  }

  return cleaned
    .split('\n')
    .map((line) => line.replace(/^[-*\d.\s]+/, '').trim())
    .map(normalizeMemoryText)
    .filter(isUsefulMemoryItem)
    .slice(0, 5)
}

function extractDeterministicMemoryItems(messages: Message[]): string[] {
  const items: string[] = []
  const recentUserTexts = messages
    .filter((message) => message.role === 'user' && message.status === 'done' && message.content.trim())
    .slice(-8)
    .map((message) => message.content)

  for (const text of recentUserTexts) {
    items.push(...extractStructuredPreferenceTokens(text))
    items.push(...extractNaturalLanguagePreferences(text))
  }

  return dedupeMemoryItems(items).slice(0, 5)
}

function extractStructuredPreferenceTokens(text: string): string[] {
  const items: string[] = []
  const tokens = text.match(/\b[A-Za-z][A-Za-z0-9_]{12,}\b/g) ?? []
  for (const token of tokens) {
    const parts = token.split('_').filter(Boolean)
    const markerIndex = parts.findIndex((part) => /^(preferred|preference|prefer|likes|like)$/i.test(part))
    if (markerIndex < 0) continue

    const memoryMarker = formatMemoryMarker(parts.slice(0, markerIndex))
    const preferenceParts = parts.slice(markerIndex + 1)
    const isIndex = preferenceParts.findIndex((part) => /^(is|are|equals|as)$/i.test(part))
    const subjectParts = isIndex > 0 ? preferenceParts.slice(0, isIndex) : preferenceParts.slice(0, -1)
    const valueParts = isIndex > 0 ? preferenceParts.slice(isIndex + 1) : preferenceParts.slice(-1)
    const subject = subjectParts.join(' ').trim()
    const value = valueParts.join(' ').trim()
    if (!subject || !value) continue
    items.push(`${memoryMarker ? `${memoryMarker}: ` : ''}用户偏好：${subject} = ${value}`)
  }
  return items
}

function extractNaturalLanguagePreferences(text: string): string[] {
  const items: string[] = []
  const normalized = text.replace(/\s+/g, ' ').trim()
  const englishFact = /\b(?:my|our)\s+([a-z0-9 _-]{2,48})\s+(?:is|are|=|:)\s+([^.!?\n。！？]{2,80})/gi
  const englishPreference = /\b(?:i|we)\s+(?:prefer|like|usually use|want)\s+([^.!?\n。！？]{3,100})/gi
  const chinesePreference = /(?:我|用户)(?:更)?(?:喜欢|偏好|习惯使用|希望使用|希望)([^。！？\n]{2,80})/g
  const chineseFact = /(?:我的|用户的)([^，。！？\n]{2,64})(?:是|为|=)([^，。！？\n]{2,100})/g

  for (const match of normalized.matchAll(englishFact)) {
    items.push(`用户事实：${match[1].trim()} = ${match[2].trim()}`)
  }
  for (const match of normalized.matchAll(englishPreference)) {
    items.push(`用户偏好：${match[1].trim()}`)
  }
  for (const match of normalized.matchAll(chinesePreference)) {
    items.push(`用户偏好：${match[1].trim()}`)
  }
  for (const match of normalized.matchAll(chineseFact)) {
    items.push(`用户事实：${match[1].trim()} = ${match[2].trim()}`)
  }

  return items
}

function formatMemoryMarker(parts: string[]): string {
  const memoryIndex = parts.findIndex((part) => /^memory$/i.test(part))
  if (memoryIndex < 0) return ''
  const suffix = parts[memoryIndex + 1]
  return suffix ? `MEMORY_${suffix}` : 'MEMORY'
}

function normalizeMemoryText(value: string): string {
  return value
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^(?:json|记忆|memory)\s*[:：]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

function isUsefulMemoryItem(value: string): boolean {
  const text = value.trim()
  if (!text || text === '[]') return false
  if (text.length < 4 || text.length > 120) return false
  if (/^(?:sure|好的|可以|以下|here|json|\[|\{)/i.test(text)) return false
  if (/(api[_ -]?key|secret|token|password|密码|密钥|秘钥)/i.test(text)) return false
  return true
}

function dedupeMemoryItems(items: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of items.map(normalizeMemoryText).filter(isUsefulMemoryItem)) {
    const key = normalizeMemoryKey(item)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

function normalizeMemoryKey(value: string): string {
  return normalizeMemoryText(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function isTextMime(mimeType: string): boolean {
  return TEXT_MIME_HINTS.some((hint) => mimeType.startsWith(hint) || mimeType === hint)
}
