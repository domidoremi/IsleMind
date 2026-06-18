import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import type { AIProvider, Conversation, Message, RagEvaluationResult, RagQueryPlan, RagTechnique, RagTraceStep, RetrievalSource } from '@/types'
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
import { buildKnowledgeScope, filterKnowledgeSources, type KnowledgeScope } from '@/services/knowledgeScope'
import { useSettingsStore } from '@/store/settingsStore'
import { searchWeb as searchWebWithAdapters } from '@/services/searchAdapters'
import { buildCompressedContextPrompt, buildFlareContextPrompt, runAgenticRag } from '@/services/rag'
import { st } from '@/i18n/service'
import { MAX_IMPORT_TEXT_FILE_BYTES, assertImportFileSizeByUri, deleteTemporaryImportCopy, isFileTooLargeError, readUtf8ImportFile } from '@/services/fileImportGuards'
import { searchAgenticKnowledgeWithScope, searchKnowledgeWithFallback } from '@/services/knowledgeRetrievalRuntime'
import { logContextOperation } from '@/services/runtimeHealthLog'

const TEXT_MIME_HINTS = ['text/', 'application/json', 'application/javascript', 'application/xml', 'text/xml', 'text/csv']
const MAX_CONTEXT_ITEMS = 8

export type MemoryCandidateRejectionReason =
  | 'empty'
  | 'length'
  | 'format'
  | 'sensitive'
  | 'one_time'
  | 'uncertain'
  | 'none'

export interface RetrievedContext {
  sources: RetrievalSource[]
  prompt: string
  plan?: RagQueryPlan
  trace?: RagTraceStep[]
  quality?: RagEvaluationResult
}

export interface FlareRetrievalResult {
  sources: RetrievalSource[]
  prompt: string
  trace: RagTraceStep[]
  quality?: RagEvaluationResult
}

export interface KnowledgeHybridSearchOptions {
  limit?: number
  embeddingMode?: 'provider' | 'local' | 'hybrid'
  localEmbeddingModelId?: string
  localEmbeddingModelSource?: 'bundled' | 'downloaded' | 'none'
  provider?: AIProvider
}

export interface KnowledgeAgenticSearchOptions {
  limit?: number
  techniques?: RagTechnique[]
}

export async function retrieveContext(conversation: Conversation, draftMessage: Message): Promise<RetrievedContext> {
  try {
    await initializeContextStore()
  } catch (error) {
    await logContextOperation({
      phase: 'initialize',
      status: 'error',
      detail: 'retrieve_context',
      error,
    })
    return { sources: [], prompt: '' }
  }
  const settings = useSettingsStore.getState().settings
  const query = [draftMessage.content, conversation.title, conversation.systemPrompt].filter(Boolean).join('\n')
  const provider = await useSettingsStore.getState().hydrateProviderKey(conversation.providerId)
  const memorySources = settings.memoryEnabled ? await searchMemories(query, settings.memoryTopK ?? 4) : []
  const knowledgeScope = buildKnowledgeScope(conversation.knowledgeSources ?? conversation.skillSnapshot?.knowledgeSources)
  if (!settings.knowledgeEnabled || settings.ragMode === 'off') {
    const sources = memorySources.slice(0, MAX_CONTEXT_ITEMS)
    return {
      sources,
      prompt: formatContextPrompt(sources),
    }
  }
  const rag = await runAgenticRag({
    query,
    conversationTitle: conversation.title,
    systemPrompt: conversation.systemPrompt,
    settings,
    memorySources,
    maxContextItems: Math.max(settings.knowledgeTopK ?? 4, settings.memoryTopK ?? 4, MAX_CONTEXT_ITEMS),
    retrieveKnowledge: (variant, limit) => searchKnowledgeWithFallback({
      query: variant,
      limit,
      ragMode: settings.ragMode === 'fts' ? 'fts' : 'hybrid',
      embeddingMode: settings.embeddingMode ?? 'hybrid',
      localEmbeddingModelId: settings.localEmbeddingModelId,
      localEmbeddingModelSource: settings.localEmbeddingModelSource,
      provider: provider ?? undefined,
      knowledgeScope,
    }),
    retrieveAgentic: (variant, plan, limit) => searchAgenticKnowledgeWithScope({ query: variant, plan, limit, knowledgeScope }),
  })
  void localDataStore.logRagEvaluation({
    query,
    plan: rag.plan,
    quality: rag.quality,
    sourceCount: rag.sources.length,
    latencyMs: rag.quality.latencyMs,
    flareTriggered: rag.quality.flareTriggered,
    fallbackReasons: rag.quality.fallbackReasons,
  })
  const sources = rag.sources.slice(0, MAX_CONTEXT_ITEMS)
  return {
    sources,
    prompt: rag.contextPrompt || formatContextPrompt(sources),
    plan: rag.plan,
    trace: rag.trace,
    quality: rag.quality,
  }
}

export async function retrieveFlareContext(input: {
  conversation: Conversation
  query: string
  followupQuery: string
  excludeChunkIds?: string[]
  limit?: number
}): Promise<FlareRetrievalResult> {
  const settings = useSettingsStore.getState().settings
  if (!settings.knowledgeEnabled || settings.ragMode === 'off') {
    return { sources: [], prompt: '', trace: [] }
  }
  const provider = await useSettingsStore.getState().hydrateProviderKey(input.conversation.providerId)
  const startedAt = Date.now()
  const hits = await searchKnowledgeWithFallback({
    query: input.followupQuery || input.query,
    limit: input.limit ?? 4,
    ragMode: settings.ragMode === 'fts' ? 'fts' : 'hybrid',
    embeddingMode: settings.embeddingMode ?? 'hybrid',
    localEmbeddingModelId: settings.localEmbeddingModelId,
    localEmbeddingModelSource: settings.localEmbeddingModelSource,
    provider: provider ?? undefined,
    knowledgeScope: buildKnowledgeScope(input.conversation.knowledgeSources ?? input.conversation.skillSnapshot?.knowledgeSources),
  })
  const excluded = new Set(input.excludeChunkIds ?? [])
  const advanced = await localDataStore.searchAgenticIndexes(input.followupQuery || input.query, {
    limit: input.limit ?? 4,
    techniques: ['raptor', 'graphrag', 'colbert'],
  })
  const merged = dedupeSources([...hits, ...advanced]).filter((source) => !source.chunkId || !excluded.has(source.chunkId)).slice(0, input.limit ?? 4)
  const trace: RagTraceStep = {
    id: `flare-retrieve-${Date.now()}`,
    stage: 'flare',
    title: 'FLARE active retrieval',
    status: merged.length ? 'done' : 'skipped',
    startedAt,
    completedAt: Date.now(),
    durationMs: Date.now() - startedAt,
    content: merged.length ? `${merged.length} supplemental sources` : 'No supplemental evidence found.',
    metadata: {
      sourceCount: merged.length,
      followupQuery: input.followupQuery,
    },
  }
  return {
    sources: merged,
    prompt: buildFlareContextPrompt(input.query, merged),
    trace: [trace],
    quality: {
      sourceCount: merged.length,
      candidateCount: hits.length + advanced.length,
      citationCoverage: merged.length ? 1 : 0,
      contextPrecision: merged.length ? Math.min(1, merged.reduce((sum, source) => sum + (source.score ?? 0), 0) / merged.length) : 0,
      compressionRatio: 1,
      confidence: merged.length ? 0.62 : 0,
      activeRetrievals: 1,
      missingEvidence: merged.length === 0,
      warnings: merged.length ? [] : ['missing-evidence'],
      flareTriggered: true,
      latencyMs: trace.durationMs,
    },
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
    } catch (error) {
      await logContextOperation({
        phase: 'memory_extract',
        status: 'error',
        detail: 'model_extraction_failed',
        sourceType: 'memory_model',
        providerId: provider.id,
        model,
        error,
      })
      // Deterministic extraction keeps explicit user preferences usable even if
      // the provider declines the auxiliary memory request.
    }
  }

  const candidates = mergeMemoryCandidates([
    ...deterministicItems.map((content) => ({
      content,
      sourceKind: 'deterministic' as const,
      sourceDetail: st('contextMemory.source.deterministic'),
      confidence: 0.82,
    })),
    ...modelItems.map((content) => ({
      content,
      sourceKind: 'model' as const,
      sourceDetail: st('contextMemory.source.model'),
      confidence: 0.68,
    })),
  ])
  const existing = new Set(
    (await listMemories(['pending', 'active', 'disabled']))
      .map((item) => normalizeMemoryKey(item.content))
  )
  const added: string[] = []
  for (const candidate of candidates) {
    const key = normalizeMemoryKey(candidate.content)
    if (!key || existing.has(key)) continue
    const memory = await addMemory(candidate.content, conversationId, 'pending', {
      sourceKind: candidate.sourceKind,
      sourceDetail: candidate.sourceDetail,
      confidence: candidate.confidence,
    })
    if (memory) {
      existing.add(key)
      added.push(memory.content)
    }
  }
  return added
}

export async function importKnowledgeFile(provider?: AIProvider, model?: string): Promise<{ ok: boolean; message: string }> {
  let importUri: string | undefined
  let importTitle: string | undefined
  let sourceType: 'text' | 'pdf' | undefined
  try {
    const picked = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      type: ['text/*', 'application/json', 'application/javascript', 'application/xml', 'text/xml', 'text/csv', 'application/pdf'],
    })
    if (picked.canceled || !picked.assets[0]) return { ok: false, message: st('contextImport.noFileSelected') }
    const asset = picked.assets[0]
    importUri = asset.uri
    importTitle = asset.name
    await initializeContextStore()
    const mimeType = asset.mimeType || 'application/octet-stream'
    const resolvedSize = (await assertImportFileSizeByUri(importUri, {
      size: asset.size,
      limitBytes: MAX_IMPORT_TEXT_FILE_BYTES,
    })) ?? asset.size ?? 0

    if (isTextMime(mimeType) || asset.name.match(/\.(md|txt|json|csv|xml|js|ts|tsx|jsx)$/i)) {
      sourceType = 'text'
      const text = await readUtf8ImportFile(importUri, {
        size: resolvedSize,
        limitBytes: MAX_IMPORT_TEXT_FILE_BYTES,
      })
      const settings = useSettingsStore.getState().settings
      await importKnowledgeText({ title: asset.name, mimeType, size: resolvedSize, text, sourceUri: asset.name }, { provider, embeddingMode: settings.embeddingMode ?? 'hybrid', localEmbeddingModelId: settings.localEmbeddingModelId, localEmbeddingModelSource: settings.localEmbeddingModelSource })
      return { ok: true, message: st('contextImport.importedFile', { name: asset.name }) }
    }

    if (mimeType === 'application/pdf' || asset.name.toLowerCase().endsWith('.pdf')) {
      sourceType = 'pdf'
      if (!provider?.apiKey || !model) {
        return { ok: false, message: st('contextImport.pdfNeedsKey') }
      }
      const base64 = await FileSystem.readAsStringAsync(importUri, { encoding: FileSystem.EncodingType.Base64 })
      const text = await generateText({
        provider,
        model,
        systemPrompt: '请从用户提供的 PDF 中提取可检索的正文。只输出正文，不要总结，不要加解释。',
        messages: [{ role: 'user', content: '请提取这个 PDF 的正文，保留标题、小节和关键列表。' }],
        attachments: [{
          id: `${Date.now()}-pdf`,
          type: 'pdf',
          uri: importUri,
          name: asset.name,
          mimeType,
          size: resolvedSize,
          base64,
        }],
        temperature: 0.1,
        maxTokens: 12000,
      })
      if (!text.trim()) return { ok: false, message: st('contextImport.pdfExtractFailed') }
      const settings = useSettingsStore.getState().settings
      await importKnowledgeText({ title: asset.name, mimeType, size: resolvedSize, text, sourceUri: asset.name }, { provider, embeddingMode: settings.embeddingMode ?? 'hybrid', localEmbeddingModelId: settings.localEmbeddingModelId, localEmbeddingModelSource: settings.localEmbeddingModelSource })
      return { ok: true, message: st('contextImport.pdfImported', { name: asset.name }) }
    }

    return { ok: false, message: st('contextImport.unsupportedFileType') }
  } catch (error) {
    if (isFileTooLargeError(error)) return { ok: false, message: st('chat.fileTooLarge20') }
    await logContextOperation({
      phase: 'knowledge_import',
      status: 'error',
      detail: 'import_knowledge_file_failed',
      sourceType,
      title: importTitle,
      providerId: provider?.id,
      model,
      error,
    })
    throw error
  } finally {
    await deleteTemporaryImportCopy(importUri, { assumeTemporaryCopy: true })
  }
}

export async function importKnowledgePlainText(title: string, text: string, provider?: AIProvider): Promise<{ ok: boolean; message: string }> {
  const resolvedTitle = title.trim() || st('contextImport.pastedTextTitle', { time: new Date().toLocaleString() })
  try {
    await initializeContextStore()
    const content = text.trim()
    if (!content) return { ok: false, message: st('contextImport.emptyText') }
    await importKnowledgeText(
      {
        title: resolvedTitle,
        mimeType: 'text/plain',
        size: content.length,
        text: content,
      },
      { provider, embeddingMode: useSettingsStore.getState().settings.embeddingMode ?? 'hybrid', localEmbeddingModelId: useSettingsStore.getState().settings.localEmbeddingModelId, localEmbeddingModelSource: useSettingsStore.getState().settings.localEmbeddingModelSource }
    )
    return { ok: true, message: st('contextImport.pastedTextImported') }
  } catch (error) {
    await logContextOperation({
      phase: 'knowledge_import',
      status: 'error',
      detail: 'import_knowledge_plain_text_failed',
      sourceType: 'plain_text',
      title: resolvedTitle,
      providerId: provider?.id,
      error,
    })
    throw error
  }
}

export async function searchKnowledgeHybrid(query: string, options: KnowledgeHybridSearchOptions = {}): Promise<RetrievalSource[]> {
  return searchKnowledgeWithFallback({
    query,
    limit: options.limit ?? 4,
    ragMode: 'hybrid',
    embeddingMode: options.embeddingMode ?? 'hybrid',
    localEmbeddingModelId: options.localEmbeddingModelId,
    localEmbeddingModelSource: options.localEmbeddingModelSource,
    provider: options.provider,
  })
}

export async function searchKnowledgeAgenticIndexes(query: string, options: KnowledgeAgenticSearchOptions = {}): Promise<RetrievalSource[]> {
  return searchAgenticKnowledgeWithScope({
    query,
    limit: options.limit ?? 8,
    techniques: options.techniques ?? ['raptor', 'graphrag', 'colbert'],
  })
}

export async function searchWeb(query: string, limit = 5): Promise<RetrievalSource[]> {
  return searchWebWithAdapters(query, limit)
}

export function formatContextPrompt(sources: RetrievalSource[]): string {
  if (!sources.length) return ''
  return [
    '以下是本机上下文增强材料。请只在相关时使用；如果材料不足或不确定，请明确说明。',
    buildCompressedContextPrompt(sources),
  ].join('\n\n')
}

function dedupeSources(sources: RetrievalSource[]): RetrievalSource[] {
  const map = new Map<string, RetrievalSource>()
  for (const source of sources) {
    const key = source.chunkId ?? source.url ?? source.id
    const existing = map.get(key)
    if (!existing || (source.score ?? 0) > (existing.score ?? 0)) map.set(key, source)
  }
  return Array.from(map.values()).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
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
  return classifyMemoryCandidate(value) === 'none'
}

export function classifyMemoryCandidateForTest(value: string): MemoryCandidateRejectionReason {
  return classifyMemoryCandidate(value)
}

function classifyMemoryCandidate(value: string): MemoryCandidateRejectionReason {
  const text = normalizeMemoryText(value)
  if (!text || text === '[]') return 'empty'
  if (text.length < 4 || text.length > 120) return 'length'
  if (/^(?:sure|好的|可以|以下|here|json|\[|\{)/i.test(text)) return 'format'
  if (containsSensitiveMemoryText(text)) return 'sensitive'
  if (/(?:今天|明天|昨天|刚才|这次|本次|临时|一次性|稍后|tonight|today|tomorrow|yesterday|this time|one[- ]?off|temporary|temporarily|for now)/i.test(text)) return 'one_time'
  if (/(?:maybe|perhaps|not sure|不确定|可能|也许|大概|估计)/i.test(text)) return 'uncertain'
  return 'none'
}

function containsSensitiveMemoryText(text: string): boolean {
  if (/(api[_ -]?key|secret|token|password|密码|密钥|秘钥|凭证|验证码|verification code|one[- ]?time code|otp|2fa|mfa)/i.test(text)) return true
  return containsCredentialLikeToken(text)
}

function containsCredentialLikeToken(text: string): boolean {
  const tokens = text.match(/[A-Za-z0-9][A-Za-z0-9_+=/.-]{11,}/g) ?? []
  return tokens.some(isCredentialLikeToken)
}


function isCredentialLikeToken(token: string): boolean {
  const clean = token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
  if (/^(?:sk|tp|rk)-[A-Za-z0-9_-]{8,}$/i.test(clean)) return true
  if (/^gh[pousr]_[A-Za-z0-9_]{20,}$/i.test(clean)) return true
  if (/^AIza[A-Za-z0-9_-]{20,}$/.test(clean)) return true
  if (/^ya29\.[A-Za-z0-9_-]{20,}$/.test(clean)) return true
  return /^[A-Za-z0-9+/_=-]{40,}$/.test(clean) && /[a-z]/.test(clean) && /[A-Z]/.test(clean) && /\d/.test(clean)
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

function mergeMemoryCandidates(candidates: Array<{ content: string; sourceKind: 'deterministic' | 'model'; sourceDetail: string; confidence: number }>): Array<{ content: string; sourceKind: 'deterministic' | 'model'; sourceDetail: string; confidence: number }> {
  const byKey = new Map<string, { content: string; sourceKind: 'deterministic' | 'model'; sourceDetail: string; confidence: number }>()
  for (const candidate of candidates) {
    const content = normalizeMemoryText(candidate.content)
    if (!isUsefulMemoryItem(content)) continue
    const key = normalizeMemoryKey(content)
    if (!key) continue
    const existing = byKey.get(key)
    if (!existing || candidate.confidence > existing.confidence) {
      byKey.set(key, { ...candidate, content })
    }
  }
  return Array.from(byKey.values()).slice(0, 5)
}

function normalizeMemoryKey(value: string): string {
  return normalizeMemoryText(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function isTextMime(mimeType: string): boolean {
  return TEXT_MIME_HINTS.some((hint) => mimeType.startsWith(hint) || mimeType === hint)
}
