import {
  extractTavernCharacterSpeechLabelValues,
  extractTavernCharacterVoiceSampleLines,
} from './tavernInterchangePolicy'
import { buildTavernCharacterStabilityDiagnostic } from './tavernReviewPolicy'
import { normalizeTavernSnapshot } from './tavernSnapshotPolicy'
import {
  type TavernCharacterCard,
  type TavernContextOptions,
  type TavernContextPack,
  type TavernLorebookEntry,
  type TavernNarrativeSummary,
  type TavernRelationshipMemory,
  type TavernScene,
  type TavernSnapshot,
} from './tavernContracts'

const TEXT_LIMIT = 2400
const CONTEXT_LORE_LIMIT = 6
const CONTEXT_MEMORY_LIMIT = 8
const CONTEXT_SUMMARY_LIMIT = 4

export function buildTavernContextPack(
  snapshot: TavernSnapshot,
  options: TavernContextOptions = {},
): TavernContextPack {
  const normalized = normalizeTavernSnapshot(snapshot)
  const scene = resolveActiveScene(normalized, options.sceneId)
  const characterIds = new Set([...(scene?.activeCharacterIds ?? []), ...(options.characterIds ?? [])].filter(Boolean))
  const characters = normalized.characters.filter((character) => !characterIds.size || characterIds.has(character.id))
  const sceneTokens = tokenizeTavernQuery(
    [scene?.title, scene?.location, scene?.timeOfDay, scene?.mood, scene?.narrativeGoal, scene?.narratorStyle]
      .filter(Boolean)
      .join('\n'),
  )
  const characterTokens = tokenizeTavernQuery(
    characters
      .flatMap((character) => [
        character.name,
        character.persona,
        character.speechStyle,
        character.background,
        character.tags.join(' '),
      ])
      .filter(Boolean)
      .join('\n'),
  )
  const queryTokens = tokenizeTavernQuery(
    [options.query, ...Array.from(sceneTokens), ...Array.from(characterTokens)].filter(Boolean).join('\n'),
  )
  const lorebook = selectLorebookEntries(
    normalized.lorebook,
    queryTokens,
    options.loreLimit ?? CONTEXT_LORE_LIMIT,
    sceneTokens,
    characterTokens,
  )
  const relationshipMemories = selectRelationshipMemories(normalized.relationshipMemories, {
    characterIds,
    includeHiddenMemory: options.includeHiddenMemory,
    queryTokens,
    sceneTokens,
    limit: options.memoryLimit ?? CONTEXT_MEMORY_LIMIT,
  })
  const narrativeSummaries = selectNarrativeSummaries(
    normalized.narrativeSummaries,
    scene?.id,
    options.summaryLimit ?? CONTEXT_SUMMARY_LIMIT,
  )
  return {
    mode: 'companion',
    isolated: true,
    shareWithChat: false,
    shareWithAgent: false,
    scopeId: normalizeOptionalTavernScopeId(options.scopeId),
    scene,
    characters,
    lorebook,
    relationshipMemories,
    narrativeSummaries,
    promptSections: buildPromptSections({
      scene,
      characters,
      lorebook,
      relationshipMemories,
      narrativeSummaries,
    }),
    evidence: buildContextEvidence({
      scene,
      characters,
      lorebook,
      relationshipMemories,
      narrativeSummaries,
    }),
  }
}

function resolveActiveScene(snapshot: TavernSnapshot, sceneId: string | undefined): TavernScene | undefined {
  if (sceneId) return snapshot.scenes.find((scene) => scene.id === sceneId)
  return snapshot.scenes.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0]
}

function selectLorebookEntries(
  entries: TavernLorebookEntry[],
  queryTokens: Set<string>,
  limit: number,
  sceneTokens: Set<string> = new Set(),
  characterTokens: Set<string> = new Set(),
): TavernLorebookEntry[] {
  return entries
    .filter((entry) => entry.enabled)
    .map((entry) => ({
      entry,
      score: scoreLorebookEntry(entry, queryTokens, sceneTokens, characterTokens),
    }))
    .filter((item) => item.score > 0 || !queryTokens.size)
    .sort((a, b) => b.score - a.score || b.entry.priority - a.entry.priority || b.entry.updatedAt - a.entry.updatedAt)
    .slice(0, Math.max(0, limit))
    .map((item) => item.entry)
}

function scoreLorebookEntry(
  entry: TavernLorebookEntry,
  queryTokens: Set<string>,
  sceneTokens: Set<string>,
  characterTokens: Set<string>,
): number {
  if (!queryTokens.size) return entry.priority / 100
  const tokens = tokenizeTavernQuery([entry.title, entry.content, entry.keywords.join(' ')].join('\n'))
  const hits = countTokenHits(tokens, queryTokens)
  const sceneHits = countTokenHits(tokens, sceneTokens)
  const characterHits = countTokenHits(tokens, characterTokens)
  const keywordHits = entry.keywords.filter((keyword) => queryTokens.has(keyword.toLowerCase())).length
  return hits + sceneHits * 2 + characterHits * 1.5 + keywordHits * 2 + entry.priority / 100
}

function selectRelationshipMemories(
  memories: TavernRelationshipMemory[],
  options: {
    characterIds: Set<string>
    includeHiddenMemory?: boolean
    queryTokens: Set<string>
    sceneTokens: Set<string>
    limit: number
  },
): TavernRelationshipMemory[] {
  return memories
    .filter((memory) => !options.characterIds.size || options.characterIds.has(memory.characterId))
    .filter((memory) => options.includeHiddenMemory || memory.userVisible)
    .map((memory) => ({
      memory,
      score: scoreRelationshipMemory(memory, options.queryTokens, options.sceneTokens, options.characterIds),
    }))
    .sort((a, b) => b.score - a.score || b.memory.updatedAt - a.memory.updatedAt)
    .slice(0, Math.max(0, options.limit))
    .map((item) => item.memory)
}

function scoreRelationshipMemory(
  memory: TavernRelationshipMemory,
  queryTokens: Set<string>,
  sceneTokens: Set<string>,
  characterIds: Set<string>,
): number {
  const tokens = tokenizeTavernQuery([memory.kind, memory.content].join('\n'))
  const activeCharacterBoost = characterIds.has(memory.characterId) ? 6 : 0
  const queryHits = countTokenHits(tokens, queryTokens)
  const sceneHits = countTokenHits(tokens, sceneTokens)
  const kindBoost =
    memory.kind === 'boundary' ? 2 : memory.kind === 'trust' ? 1.5 : memory.kind === 'preference' ? 1 : 0
  return activeCharacterBoost + memory.weight * 4 + queryHits * 4 + sceneHits * 1.5 + kindBoost
}

function selectNarrativeSummaries(
  summaries: TavernNarrativeSummary[],
  sceneId: string | undefined,
  limit: number,
): TavernNarrativeSummary[] {
  const resolvedLimit = Math.max(0, limit)
  if (!resolvedLimit) return []
  const scoped = summaries.filter((summary) => !sceneId || !summary.sceneId || summary.sceneId === sceneId)
  if (scoped.length <= resolvedLimit) return scoped
  if (resolvedLimit === 1) return [compressNarrativeSummaries(scoped, sceneId)]
  const recent = scoped.slice(0, resolvedLimit - 1)
  return [...recent, compressNarrativeSummaries(scoped.slice(resolvedLimit - 1), sceneId)]
}

function compressNarrativeSummaries(
  summaries: TavernNarrativeSummary[],
  sceneId: string | undefined,
): TavernNarrativeSummary {
  const createdAt = summaries.reduce((min, summary) => Math.min(min, summary.createdAt), summaries[0]?.createdAt ?? 0)
  const updatedAt = summaries.reduce((max, summary) => Math.max(max, summary.updatedAt), summaries[0]?.updatedAt ?? 0)
  return {
    id: `summary-compressed-prior-${sceneId ?? 'global'}`,
    sceneId,
    chapterTitle: 'Prior continuity',
    summary:
      normalizeText(`Prior continuity: ${summaries.map((summary) => summary.summary).join(' ')}`, TEXT_LIMIT) ??
      'Prior continuity exists.',
    unresolvedThreads: uniqueStrings(summaries.flatMap((summary) => summary.unresolvedThreads)).slice(
      0,
      CONTEXT_SUMMARY_LIMIT,
    ),
    promises: uniqueStrings(summaries.flatMap((summary) => summary.promises)).slice(0, CONTEXT_SUMMARY_LIMIT),
    importantChanges: uniqueStrings(summaries.flatMap((summary) => summary.importantChanges)).slice(
      0,
      CONTEXT_SUMMARY_LIMIT,
    ),
    createdAt,
    updatedAt,
  }
}

function buildPromptSections(input: {
  scene?: TavernScene
  characters: TavernCharacterCard[]
  lorebook: TavernLorebookEntry[]
  relationshipMemories: TavernRelationshipMemory[]
  narrativeSummaries: TavernNarrativeSummary[]
}): string[] {
  const sections: string[] = []
  if (input.scene) {
    const activeCharacterRefs = formatTavernCharacterRefs(input.scene.activeCharacterIds, input.characters)
    const speakingOrderRefs = formatTavernCharacterRefs(input.scene.speakingOrder, input.characters)
    sections.push(
      [
        `Scene: ${input.scene.title}`,
        `Location: ${input.scene.location}`,
        input.scene.branchFromSceneId ? `Branch from: ${input.scene.branchFromSceneId}` : '',
        input.scene.timeOfDay ? `Time: ${input.scene.timeOfDay}` : '',
        input.scene.mood ? `Mood: ${input.scene.mood}` : '',
        input.scene.narrativeGoal ? `Goal: ${input.scene.narrativeGoal}` : '',
        activeCharacterRefs.length ? `Active characters: ${activeCharacterRefs.join(', ')}` : '',
        speakingOrderRefs.length ? `Speaking order: ${speakingOrderRefs.join(' -> ')}` : '',
        input.scene.narratorStyle ? `Narrator style: ${input.scene.narratorStyle}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }
  for (const character of input.characters) sections.push(formatTavernCharacterSection(character))
  if (input.lorebook.length) {
    sections.push(`Lorebook: ${input.lorebook.map((entry) => `${entry.title}: ${entry.content}`).join('\n')}`)
  }
  if (input.relationshipMemories.length) {
    sections.push(...formatTavernRelationshipMemorySections(input.relationshipMemories, input.characters))
  }
  if (input.narrativeSummaries.length) {
    sections.push(
      `Narrative continuity: ${input.narrativeSummaries.map(formatTavernNarrativeSummarySection).join('\n')}`,
    )
  }
  return sections.filter((section) => section.trim())
}

function formatTavernCharacterSection(character: TavernCharacterCard): string {
  return [
    `Character: ${character.name}`,
    character.persona ? `Persona: ${character.persona}` : '',
    character.speechStyle ? `Speech: ${character.speechStyle}` : '',
    formatTavernCharacterVoiceAnchorSection(character),
    formatTavernCharacterStabilitySection(character),
    character.background ? `Background: ${character.background}` : '',
    character.openingMessage ? `Opening: ${character.openingMessage}` : '',
    character.constraints.length ? `Constraints: ${character.constraints.join('; ')}` : '',
    character.tags.length ? `Tags: ${character.tags.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function formatTavernCharacterVoiceAnchorSection(character: TavernCharacterCard): string {
  const emotionalToneAnchors = extractTavernCharacterSpeechLabelValues(
    character.speechStyle,
    'emotional tone|emotional range|affect|feeling tone|情绪基调|情緒基調|情绪语气|情緒語氣|情绪输出|情緒輸出|感情のトーン|感情表現|感情の幅',
  )
  const wordingAnchors = extractTavernCharacterSpeechLabelValues(
    character.speechStyle,
    'wording|phrasing|phrases|recurring wording|recurring phrases|signature phrases|preferred phrases|catchphrases|措辞|措辭|常用措辞|常用措辭|常用表达|常用表達|口头禅|口頭禪|言葉選び|言い回し|決まり文句|よく使う言葉',
  )
  const voiceSampleAnchors = extractTavernCharacterVoiceSampleLines(character.speechStyle)
  const avoidedWording = character.constraints
    .map(
      (constraint) =>
        constraint.match(
          /^\s*(?:avoid phrase|avoid wording|forbidden phrase|forbidden wording|避免措辞|避免措辭|禁用措辞|禁用措辭|避けたい表現|避ける言い方|使わない言葉)\s*[:：]\s*(.+)$/i,
        )?.[1],
    )
    .filter(isString)
    .map((value) => normalizeText(value, 240))
    .filter(isString)
  const lines = [
    emotionalToneAnchors.length ? `Emotional tone anchor: ${emotionalToneAnchors.join('; ')}` : '',
    wordingAnchors.length ? `Recurring wording anchor: ${wordingAnchors.join('; ')}` : '',
    voiceSampleAnchors.length ? `Voice sample anchor: ${voiceSampleAnchors.join('; ')}` : '',
    voiceSampleAnchors.length
      ? 'Voice sample policy: Treat samples as style references for cadence, warmth, and wording; do not repeat them verbatim unless the user asks or the line naturally fits.'
      : '',
    avoidedWording.length ? `Avoid wording: ${uniqueStrings(avoidedWording).join('; ')}` : '',
  ].filter(Boolean)
  return lines.length ? `Voice anchors:\n${lines.join('\n')}` : ''
}

function formatTavernCharacterStabilitySection(character: TavernCharacterCard): string {
  const diagnostic = buildTavernCharacterStabilityDiagnostic(character)
  return [
    'Stability: Preserve persona, speech style, boundaries, recurring wording, and emotional tone unless the user explicitly revises them.',
    diagnostic.presentAnchors.length
      ? `Confirmed stability anchors: ${diagnostic.presentAnchors.join(', ')}. Do not rewrite confirmed anchors without explicit user revision.`
      : 'Confirmed stability anchors: none yet.',
    diagnostic.missingAnchors.length
      ? `Missing stability anchors: ${diagnostic.missingAnchors.join(', ')}. Ask a small clarifying question before inventing missing anchors.`
      : 'Missing stability anchors: none.',
  ].join('\n')
}

function formatTavernRelationshipMemorySections(
  memories: readonly TavernRelationshipMemory[],
  characters: readonly TavernCharacterCard[] = [],
  options: {
    includeHidden?: boolean
    markVisibility?: boolean
    headingPrefix?: string
  } = {},
): string[] {
  const includedMemories = options.includeHidden ? memories : memories.filter((memory) => memory.userVisible)
  if (!includedMemories.length) return []
  const grouped = new Map<string, TavernRelationshipMemory[]>()
  for (const memory of includedMemories) {
    const existing = grouped.get(memory.characterId) ?? []
    existing.push(memory)
    grouped.set(memory.characterId, existing)
  }
  return Array.from(grouped.entries()).map(([characterId, characterMemories]) => {
    const characterRef = formatTavernCharacterRefs([characterId], [...characters])[0] ?? characterId
    const headingPrefix = options.headingPrefix ?? 'Relationship memory for'
    return [
      `${headingPrefix} ${characterRef}:`,
      ...characterMemories.map((memory) => {
        const visibility = options.markVisibility && !memory.userVisible ? '; private' : ''
        return `[${memory.kind}${visibility}] ${memory.content}`
      }),
    ].join('\n')
  })
}

function formatTavernNarrativeSummarySection(summary: TavernNarrativeSummary): string {
  return [
    summary.chapterTitle ? `Chapter: ${summary.chapterTitle}` : '',
    summary.summary,
    summary.unresolvedThreads.length ? `Unresolved: ${summary.unresolvedThreads.join('; ')}` : '',
    summary.promises.length ? `Promises: ${summary.promises.join('; ')}` : '',
    summary.importantChanges.length ? `Changes: ${summary.importantChanges.join('; ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function formatTavernCharacterRefs(ids: string[], characters: TavernCharacterCard[]): string[] {
  const characterNames = new Map(characters.map((character) => [character.id, character.name]))
  return uniqueStrings(
    ids.map((id) => {
      const name = characterNames.get(id)
      return name ? `${name} (${id})` : id
    }),
  )
}

function buildContextEvidence(input: {
  scene?: TavernScene
  characters: TavernCharacterCard[]
  lorebook: TavernLorebookEntry[]
  relationshipMemories: TavernRelationshipMemory[]
  narrativeSummaries: TavernNarrativeSummary[]
}): string[] {
  return [
    input.scene ? `scene:${input.scene.id}` : '',
    ...input.characters.map((character) => `character:${character.id}`),
    ...input.lorebook.map((entry) => `lore:${entry.id}`),
    ...input.relationshipMemories.map((memory) => `memory:${memory.id}`),
    ...input.narrativeSummaries.map((summary) => `summary:${summary.id}`),
  ].filter(Boolean)
}

function normalizeOptionalTavernScopeId(value: unknown): string | undefined {
  const normalized = normalizeText(value, 160)
  if (!normalized) return undefined
  return (
    normalized
      .replace(/[^\w.-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'default'
  )
}

function tokenizeTavernQuery(value: string): Set<string> {
  const normalized = value.toLowerCase().replace(/[_/\\|.,;:!?()[\]{}<>+=*&^%$#@~，。！？；：（）【】《》、]/g, ' ')
  const tokens = normalized.match(/[a-z0-9]{2,}|[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]{2,}/g) ?? []
  return new Set(tokens.slice(0, 64))
}

function countTokenHits(tokens: Set<string>, queryTokens: Set<string>): number {
  let hits = 0
  for (const token of queryTokens) {
    if (tokens.has(token)) hits += 1
  }
  return hits
}

function normalizeText(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, limit) : undefined
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function isString(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0
}
