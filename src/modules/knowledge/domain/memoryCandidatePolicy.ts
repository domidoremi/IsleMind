export type MemoryCandidateRejectionReason =
  | 'empty'
  | 'length'
  | 'format'
  | 'sensitive'
  | 'one_time'
  | 'uncertain'
  | 'none'

export interface MemoryCandidateMessage {
  role: string
  status?: string
  content: string
}

/** Extracts deterministic, non-sensitive memory candidates from completed user turns. */
export function extractDeterministicMemoryCandidates(
  messages: readonly MemoryCandidateMessage[],
): string[] {
  const items: string[] = []
  const recentUserTexts = messages
    .filter((message) => message.role === 'user' && message.status === 'done' && message.content.trim())
    .slice(-8)
    .map((message) => message.content)

  for (const text of recentUserTexts) {
    items.push(...extractStructuredPreferenceTokens(text))
    items.push(...extractNaturalLanguagePreferences(text))
  }

  return dedupeMemoryCandidates(items).slice(0, 5)
}

export function normalizeMemoryCandidateText(value: string): string {
  return value
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^(?:json|记忆|memory)\s*[:：]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

export function isUsefulMemoryCandidate(value: string): boolean {
  return classifyMemoryCandidate(value) === 'none'
}

export function classifyMemoryCandidate(value: string): MemoryCandidateRejectionReason {
  const text = normalizeMemoryCandidateText(value)
  if (!text || text === '[]') return 'empty'
  if (text.length < 4 || text.length > 120) return 'length'
  if (/^(?:sure|好的|可以|以下|here|json|\[|\{)/i.test(text)) return 'format'
  if (containsSensitiveMemoryText(text)) return 'sensitive'
  if (/(?:今天|明天|昨天|刚才|这次|本次|临时|一次性|稍后|tonight|today|tomorrow|yesterday|this time|one[- ]?off|temporary|temporarily|for now)/i.test(text)) return 'one_time'
  if (/(?:maybe|perhaps|not sure|不确定|可能|也许|大概|估计)/i.test(text)) return 'uncertain'
  return 'none'
}

export function normalizeMemoryCandidateKey(value: string): string {
  return normalizeMemoryCandidateText(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
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

function dedupeMemoryCandidates(items: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of items.map(normalizeMemoryCandidateText).filter(isUsefulMemoryCandidate)) {
    const key = normalizeMemoryCandidateKey(item)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}
