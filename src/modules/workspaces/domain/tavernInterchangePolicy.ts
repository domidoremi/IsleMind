import {
  TAVERN_CHARACTER_CARD_V2_SPEC,
  TAVERN_CHARACTER_CARD_V2_VERSION,
  type TavernCharacterCard,
  type TavernCharacterCardV2Export,
  type TavernLorebookEntry,
  type TavernLorebookWorldInfoEntryExport,
  type TavernLorebookWorldInfoExport,
} from './tavernContracts'
import {
  TAVERN_SNAPSHOT_LIST_LIMIT,
  normalizeTavernCharacterCard,
  normalizeTavernLorebookEntry,
} from './tavernSnapshotPolicy'

const TEXT_LIMIT = 2400
const SHORT_TEXT_LIMIT = 180

export const TAVERN_CHARACTER_VOICE_SAMPLE_LABELS = [
  'example line',
  'sample line',
  'example sentence',
  'sample sentence',
  'example reply',
  'sample reply',
  'voice sample',
  'sample dialogue',
  'example dialogue',
  'example phrase',
  'sample phrase',
  'line example',
  'quote',
  '例句',
  '示例句',
  '示例回复',
  '示例回覆',
  '说话示例',
  '說話示例',
  '语气示例',
  '語氣示例',
  '代表台词',
  '代表台詞',
  '台词示例',
  '台詞示例',
  '一句示例',
  '一句話示例',
  'セリフ例',
  '台詞例',
  '例のセリフ',
  '話し方の例',
  '返答例',
  '一文例',
] as const

const TAVERN_CHARACTER_VOICE_SAMPLE_LABEL_PATTERN = TAVERN_CHARACTER_VOICE_SAMPLE_LABELS
  .map(escapeRegExp)
  .join('|')

/** Emits the canonical IsleMind Character Card v2 compatibility envelope. */
export function exportTavernCharacterCardV2(character: TavernCharacterCard): TavernCharacterCardV2Export {
  const constraints = normalizeTextList(character.constraints)
  const tags = normalizeTextList(character.tags)
  const voiceSamples = extractTavernCharacterVoiceSampleLines(character.speechStyle)
  return {
    spec: TAVERN_CHARACTER_CARD_V2_SPEC,
    spec_version: TAVERN_CHARACTER_CARD_V2_VERSION,
    data: {
      name: normalizeText(character.name, SHORT_TEXT_LIMIT) ?? '',
      description: normalizeText(character.persona, TEXT_LIMIT) ?? '',
      personality: normalizeText(character.speechStyle, TEXT_LIMIT) ?? '',
      scenario: normalizeText(character.background, TEXT_LIMIT) ?? '',
      first_mes: normalizeText(character.openingMessage, TEXT_LIMIT) ?? '',
      mes_example: normalizeMultilineText(voiceSamples.join('\n'), TEXT_LIMIT) ?? '',
      creator_notes: '',
      system_prompt: constraints.join('\n'),
      post_history_instructions: '',
      alternate_greetings: [],
      tags,
      creator: 'IsleMind',
      character_version: '1',
      extensions: {
        islemind: {
          tavern: {
            id: character.id,
            avatarUri: character.avatarUri,
            constraints,
            speechStyle: normalizeText(character.speechStyle, TEXT_LIMIT) ?? '',
            createdAt: character.createdAt,
            updatedAt: character.updatedAt,
          },
        },
      },
    },
  }
}

/**
 * Admits both wrapped Character Card v2 data and the legacy flat card shape.
 * Invalid cards are dropped instead of manufacturing a nameless character.
 */
export function importTavernCharacterCardV2(value: unknown, now = Date.now()): TavernCharacterCard | null {
  const root = asRecord(value)
  const data = asRecord(root?.data) ?? root
  if (!data) return null
  const extensions = asRecord(data.extensions)
  const islemindExtension = asRecord(asRecord(extensions?.islemind)?.tavern)
  const constraints = normalizeTextList(islemindExtension?.constraints)
  const fallbackConstraints = normalizeTextList([
    normalizeText(data.system_prompt, TEXT_LIMIT),
    normalizeText(data.post_history_instructions, TEXT_LIMIT),
  ].filter(Boolean))
  return normalizeTavernCharacterCard({
    id: normalizeId(islemindExtension?.id),
    name: normalizeText(data.name, SHORT_TEXT_LIMIT),
    avatarUri: normalizeText(islemindExtension?.avatarUri, TEXT_LIMIT),
    persona: normalizeText(data.description, TEXT_LIMIT),
    speechStyle: mergeTavernImportedCharacterSpeechStyle(
      normalizeText(islemindExtension?.speechStyle, TEXT_LIMIT) ?? normalizeText(data.personality, TEXT_LIMIT),
      data.mes_example,
      normalizeText(data.name, SHORT_TEXT_LIMIT),
    ),
    background: normalizeText(data.scenario, TEXT_LIMIT),
    openingMessage: normalizeText(data.first_mes, TEXT_LIMIT),
    constraints: constraints.length ? constraints : fallbackConstraints,
    tags: normalizeTextList(data.tags),
    createdAt: finiteTimestamp(islemindExtension?.createdAt),
    updatedAt: finiteTimestamp(islemindExtension?.updatedAt),
  }, now)
}

/** Emits World Info entries in caller order without mutating the lorebook. */
export function exportTavernLorebookWorldInfo(entries: readonly TavernLorebookEntry[]): TavernLorebookWorldInfoExport {
  const boundedEntries = entries.slice(0, TAVERN_SNAPSHOT_LIST_LIMIT)
  const exportedEntries: Record<string, TavernLorebookWorldInfoEntryExport> = {}
  boundedEntries.forEach((entry, index) => {
    const keywords = normalizeTextList(entry.keywords)
    exportedEntries[String(index)] = {
      uid: index,
      key: keywords,
      keysecondary: [],
      comment: normalizeText(entry.title, SHORT_TEXT_LIMIT) ?? '',
      content: normalizeText(entry.content, TEXT_LIMIT) ?? '',
      constant: keywords.length === 0,
      selective: false,
      order: clampNumber(entry.priority, 0, 100, 50),
      disable: entry.enabled === false,
      extensions: {
        islemind: {
          tavern: {
            id: entry.id,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
          },
        },
      },
    }
  })
  return {
    entries: exportedEntries,
    extensions: {
      islemind: {
        tavern: {
          entryCount: boundedEntries.length,
        },
      },
    },
  }
}

/**
 * Leniently admits wrapped, array, map, or single-entry World Info input.
 * Malformed entries are dropped and duplicate admitted ids keep their last value.
 */
export function importTavernLorebookWorldInfo(value: unknown, now = Date.now()): TavernLorebookEntry[] {
  const root = asRecord(value)
  const rawEntries = root && ('content' in root || 'key' in root || 'keys' in root)
    ? [root]
    : root
      ? root.entries ?? value
      : value
  const entryValues = Array.isArray(rawEntries)
    ? rawEntries.map((entry, index) => ({ entry, sourceKey: String(index) }))
    : Object.entries(asRecord(rawEntries) ?? {}).map(([sourceKey, entry]) => ({ entry, sourceKey }))
  const byId = new Map<string, TavernLorebookEntry>()
  for (const entryValue of entryValues.slice(0, TAVERN_SNAPSHOT_LIST_LIMIT)) {
    const entry = asRecord(entryValue.entry)
    if (!entry) continue
    const extensions = asRecord(entry.extensions)
    const islemindExtension = asRecord(asRecord(extensions?.islemind)?.tavern)
    const keywords = normalizeTextList(entry.key ?? entry.keys)
    const title = normalizeText(entry.comment, SHORT_TEXT_LIMIT) ??
      normalizeText(entry.title, SHORT_TEXT_LIMIT) ??
      keywords[0] ??
      (entry.uid !== undefined ? String(entry.uid) : undefined)
    const content = normalizeText(entry.content, TEXT_LIMIT)
    const normalized = normalizeTavernLorebookEntry({
      id: normalizeId(islemindExtension?.id) ?? createTavernWorldInfoImportId(
        entry.uid,
        entryValue.sourceKey,
        title,
        content,
      ),
      title,
      content,
      keywords,
      priority: typeof entry.order === 'number' ? entry.order : undefined,
      enabled: entry.disable === true ? false : undefined,
      createdAt: finiteTimestamp(islemindExtension?.createdAt),
      updatedAt: finiteTimestamp(islemindExtension?.updatedAt),
    }, now)
    if (normalized) byId.set(normalized.id, normalized)
  }
  return Array.from(byId.values())
}

function createTavernWorldInfoImportId(
  uid: unknown,
  sourceKey: string,
  title: string | undefined,
  content: string | undefined,
): string {
  const normalizedUid = typeof uid === 'number' && Number.isFinite(uid)
    ? String(Math.trunc(uid))
    : normalizeText(uid, 80)
  const sourceIdentity = normalizedUid
    ? `uid:${normalizedUid}`
    : `source:${normalizeText(sourceKey, 80) ?? 'entry'}:${title ?? ''}:${content ?? ''}`
  const hash = Math.abs(hashString(sourceIdentity)).toString(36)
  return `tavern-lore-world-info-${hash}`
}

export function extractTavernCharacterVoiceSampleLines(speechStyle: string | undefined): string[] {
  return extractTavernCharacterSpeechLabelValues(
    speechStyle,
    TAVERN_CHARACTER_VOICE_SAMPLE_LABEL_PATTERN,
    { preserveTerminalPunctuation: true },
  )
}

export function extractTavernCharacterSpeechLabelValues(
  source: string | undefined,
  labelPattern: string,
  options: { preserveTerminalPunctuation?: boolean } = {},
): string[] {
  if (!source) return []
  const nextLabelPattern = `(?:emotional tone|emotional range|affect|feeling tone|wording|phrasing|phrases|recurring wording|recurring phrases|signature phrases|preferred phrases|catchphrases|情绪基调|情緒基調|情绪语气|情緒語氣|情绪输出|情緒輸出|感情のトーン|感情表現|感情の幅|措辞|措辭|常用措辞|常用措辭|常用表达|常用表達|口头禅|口頭禪|言葉選び|言い回し|決まり文句|よく使う言葉|${TAVERN_CHARACTER_VOICE_SAMPLE_LABEL_PATTERN})`
  const regex = new RegExp(`(?:^|[\\s,;；。])(?:${labelPattern})\\s*[:：]\\s*([\\s\\S]*?)(?=\\s+${nextLabelPattern}\\s*[:：]|$)`, 'gi')
  return uniqueStrings(Array.from(source.matchAll(regex))
    .map((match) => normalizeText(
      options.preserveTerminalPunctuation ? match[1]?.trim() : match[1]?.replace(/[\s,;；。]+$/g, ''),
      240,
    ))
    .filter(isString))
}

function mergeTavernImportedCharacterSpeechStyle(
  primary: string | undefined,
  mesExample: unknown,
  characterName?: string,
): string | undefined {
  const normalizedPrimary = normalizeText(primary, TEXT_LIMIT)
  const exampleLines = splitTavernCharacterVoiceSampleInput(mesExample, characterName)
  if (!exampleLines.length) return normalizedPrimary
  const existingSamples = extractTavernCharacterVoiceSampleLines(normalizedPrimary)
  const existingKeys = new Set(existingSamples.map(normalizeComparableText).filter(isString))
  const newExamples = exampleLines.filter((exampleLine) => {
    const exampleKey = normalizeComparableText(exampleLine)
    if (!exampleKey || existingKeys.has(exampleKey)) return false
    existingKeys.add(exampleKey)
    return true
  })
  if (!newExamples.length) return normalizedPrimary
  return normalizeText([
    normalizedPrimary,
    ...newExamples.map((exampleLine) => `Example line: ${exampleLine}`),
  ].filter(Boolean).join(' '), TEXT_LIMIT)
}

function splitTavernCharacterVoiceSampleInput(value: unknown, characterName?: string): string[] {
  const multiline = normalizeMultilineText(value, TEXT_LIMIT)
  if (!multiline) return []
  const characterKey = characterName ? normalizeComparableText(characterName) : ''
  return uniqueStrings(multiline
    .split(/\r?\n/)
    .map((line) => normalizeTavernImportedVoiceSampleLine(line, characterKey))
    .filter(isString))
}

function normalizeTavernImportedVoiceSampleLine(line: string, characterKey?: string): string | undefined {
  const text = normalizeText(line, 360)
  if (!text || /^<?START>?$/i.test(text) || /^[-*_]{3,}$/.test(text)) return undefined
  const templateSpeaker = /^\{\{\s*(user|char)\s*\}\}\s*[:：]\s*(.+)$/i.exec(text)
  if (templateSpeaker) {
    return /user/i.test(templateSpeaker[1]) ? undefined : normalizeText(templateSpeaker[2], 360)
  }
  const speaker = /^([^:：]{1,80})\s*[:：]\s*(.+)$/.exec(text)
  if (!speaker) return text
  const speakerKey = normalizeComparableText(speaker[1])
  const content = normalizeText(speaker[2], 360)
  if (!content) return undefined
  if (speakerKey && /^(?:user|human|you|player|ユーザー|人間|用戶|用户|玩家)$/.test(speakerKey)) return undefined
  if (speakerKey && /^(?:char|character|assistant|bot|model|ai|角色|人物|キャラクター|キャラ|アシスタント)$/.test(speakerKey)) return content
  if (characterKey && speakerKey === characterKey) return content
  return text
}

function normalizeText(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, limit) : undefined
}

function normalizeMultilineText(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim()
  return text ? text.slice(0, limit) : undefined
}

function normalizeTextList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const items: string[] = []
  for (const item of value) {
    const text = normalizeText(item, SHORT_TEXT_LIMIT)
    const key = text?.toLowerCase()
    if (!text || !key || seen.has(key)) continue
    seen.add(key)
    items.push(text)
    if (items.length >= TAVERN_SNAPSHOT_LIST_LIMIT) break
  }
  return items
}

function normalizeId(value: unknown): string | undefined {
  const text = normalizeText(value, 120)
  if (!text || /[\u0000-\u001F]/.test(text)) return undefined
  return text
}

function normalizeComparableText(value: string): string {
  return value.toLowerCase().replace(/[_/\\|.,;:!?()[\]{}<>+=*&^%$#@~，。！？；：（）【】《》、]/g, ' ').replace(/\s+/g, ' ').trim()
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function finiteTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : undefined
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Number(Math.max(min, Math.min(max, value)).toFixed(3))
    : fallback
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function isString(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash | 0
}
