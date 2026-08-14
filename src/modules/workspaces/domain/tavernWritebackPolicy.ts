import { TAVERN_CHARACTER_VOICE_SAMPLE_LABELS } from './tavernInterchangePolicy'
import {
  applyTavernCharacterDraftProposal,
  applyTavernLorebookDraftProposal,
  applyTavernSceneChangeProposal,
  buildTavernLorebookDraftReviewEvidence,
  hasUnresolvedTavernSceneRefs,
  resolveTavernExistingLorebookForDraft,
  resolveTavernRelationshipMemoryCandidateForApproval,
  resolveTavernSceneChangeProposalForApproval,
  resolveTavernSceneRefResolution,
  tavernSceneChangeProposalEvidenceId,
} from './tavernReviewPolicy'
import {
  normalizeTavernSnapshot,
  upsertTavernNarrativeSummary,
  upsertTavernPendingWriteback,
  upsertTavernRelationshipMemory,
} from './tavernSnapshotPolicy'
import {
  TAVERN_TURN_WRITEBACK_SCHEMA,
  type TavernCharacterCard,
  type TavernCharacterDraftProposal,
  type TavernLorebookDraftProposal,
  type TavernLorebookEntry,
  type TavernRelationshipMemory,
  type TavernRelationshipMemoryCandidate,
  type TavernRelationshipMemoryKind,
  type TavernRelationshipMemoryRetentionClass,
  type TavernRelationshipMemoryReviewStatus,
  type TavernScene,
  type TavernSceneChangeProposal,
  type TavernSnapshot,
  type TavernTurnWritebackApplyOptions,
  type TavernTurnWritebackApplyResult,
  type TavernTurnWritebackOptions,
  type TavernTurnWritebackProposal,
} from './tavernContracts'

const TEXT_LIMIT = 2400
const SHORT_TEXT_LIMIT = 180
const LIST_LIMIT = 48

export function buildTavernTurnWritebackProposal(
  snapshot: TavernSnapshot,
  options: TavernTurnWritebackOptions = {},
  now = Date.now()
): TavernTurnWritebackProposal {
  const normalized = normalizeTavernSnapshot(snapshot, now)
  const scene = resolveActiveScene(normalized, options.sceneId)
  const characterIds = new Set([
    ...(scene?.activeCharacterIds ?? []),
    ...(options.characterIds ?? []),
  ].filter(Boolean))
  const characters = normalized.characters.filter((character) => !characterIds.size || characterIds.has(character.id))
  const primaryCharacter = characters[0] ?? normalized.characters[0]
  const userInput = normalizeText(options.userInput, TEXT_LIMIT)
  const assistantOutput = normalizeText(options.assistantOutput, TEXT_LIMIT)
  const summary = normalizeText([
    userInput ? `User: ${userInput}` : '',
    assistantOutput ? `Tavern: ${assistantOutput}` : '',
  ].filter(Boolean).join(' '), TEXT_LIMIT)
  const summaryDraft = summary
    ? {
        id: normalizeId(options.assistantMessageId) ?? generateTavernId('turn-summary', summary, now),
        sceneId: scene?.id,
        chapterTitle: scene?.title,
        summary,
        unresolvedThreads: extractTavernUnresolvedThreads(userInput, assistantOutput),
        promises: extractTavernPromises(userInput, assistantOutput),
        importantChanges: extractTavernImportantChanges(userInput, assistantOutput),
      }
    : undefined
  const characterDraftProposals = buildCharacterDraftProposals({
    userInput: options.userInput,
    assistantOutput: options.assistantOutput,
    characters,
    allCharacters: normalized.characters,
    scene,
    now,
  })
  const characterDraftProposal = characterDraftProposals[0]
  const additionalCharacterDraftProposals = characterDraftProposals.slice(1)
  const relationshipMemoryCandidates = buildRelationshipMemoryCandidates({
    userInput: options.userInput,
    assistantOutput: options.assistantOutput,
    characterId: primaryCharacter?.id,
    characters: normalized.characters,
    existingMemories: normalized.relationshipMemories,
    now,
  })
  const lorebookDraftProposals = buildLorebookDraftProposals({
    userInput: options.userInput,
    assistantOutput: options.assistantOutput,
    lorebook: normalized.lorebook,
    now,
  })
  const lorebookDraftProposal = lorebookDraftProposals[0]
  const additionalLorebookDraftProposals = lorebookDraftProposals.slice(1)
  const sceneChangeProposals = buildSceneChangeProposals({
    scene,
    scenes: normalized.scenes,
    characters: normalized.characters,
    userInput: options.userInput,
    assistantOutput: options.assistantOutput,
  })
  const sceneChangeProposal = sceneChangeProposals[0]
  const additionalSceneChangeProposals = sceneChangeProposals.slice(1)
  return {
    schema: TAVERN_TURN_WRITEBACK_SCHEMA,
    mode: 'companion',
    isolated: true,
    summaryDraft,
    characterDraftProposal,
    additionalCharacterDraftProposals: additionalCharacterDraftProposals.length ? additionalCharacterDraftProposals : undefined,
    lorebookDraftProposal,
    additionalLorebookDraftProposals: additionalLorebookDraftProposals.length ? additionalLorebookDraftProposals : undefined,
    relationshipMemoryCandidates,
    sceneChangeProposal,
    additionalSceneChangeProposals: additionalSceneChangeProposals.length ? additionalSceneChangeProposals : undefined,
    characterDraftRequiresUserConfirmation: true,
    lorebookDraftRequiresUserConfirmation: true,
    relationshipMemoryRequiresUserConfirmation: true,
    sceneChangeRequiresUserConfirmation: true,
    evidence: uniqueStrings([
      scene?.id ? `scene:${scene.id}` : '',
      sceneChangeProposal?.sceneId ? `scene:${sceneChangeProposal.sceneId}` : '',
      sceneChangeProposal?.branchFromSceneId ? `scene:${sceneChangeProposal.branchFromSceneId}` : '',
      ...characters.map((character) => `character:${character.id}`),
      ...characterDraftProposals.map((proposal) => proposal.characterId ? `character:${proposal.characterId}` : ''),
      ...sceneChangeProposals.map((proposal) => proposal.sceneId ? `scene:${proposal.sceneId}` : ''),
      ...sceneChangeProposals.map((proposal) => proposal.branchFromSceneId ? `scene:${proposal.branchFromSceneId}` : ''),
      summaryDraft ? `summary-draft:${summaryDraft.id}` : '',
      ...characterDraftProposals.map((proposal) => `character-draft-candidate:${proposal.id}`),
      ...lorebookDraftProposals.flatMap(buildTavernLorebookDraftReviewEvidence),
      ...relationshipMemoryCandidates.map((candidate) => `memory-candidate:${candidate.id}`),
      ...sceneChangeProposals.map((proposal) => tavernSceneChangeProposalEvidenceId(proposal)),
    ]),
  }
}

export function applyTavernTurnWritebackProposal(
  snapshot: TavernSnapshot,
  proposal: TavernTurnWritebackProposal,
  options: TavernTurnWritebackApplyOptions = {},
  now = Date.now()
): TavernTurnWritebackApplyResult {
  let next = normalizeTavernSnapshot(snapshot, now)
  let committedSummary = false
  let committedCharacterDraft = false
  let committedLorebookDraft = false
  let committedSceneChange = false
  let pendingWritebackStored = false
  const committedRelationshipMemoryIds: string[] = []
  const characterDraftProposals = [
    proposal.characterDraftProposal,
    ...(proposal.additionalCharacterDraftProposals ?? []),
  ].filter((item): item is TavernCharacterDraftProposal => Boolean(item))
  const lorebookDraftProposals = [
    proposal.lorebookDraftProposal,
    ...(proposal.additionalLorebookDraftProposals ?? []),
  ].filter((item): item is TavernLorebookDraftProposal => Boolean(item))
  const sceneChangeProposals = [
    proposal.sceneChangeProposal,
    ...(proposal.additionalSceneChangeProposals ?? []),
  ].filter((item): item is TavernSceneChangeProposal => Boolean(item))
  const pendingCharacterDraftProposals: TavernCharacterDraftProposal[] = []
  const commitSummary = options.commitSummary !== false
  if (commitSummary && proposal.summaryDraft?.summary) {
    const summarySceneId = resolveTavernExistingSceneId(next, proposal.summaryDraft.sceneId)
    next = upsertTavernNarrativeSummary(next, {
      id: proposal.summaryDraft.id,
      sceneId: summarySceneId,
      chapterTitle: proposal.summaryDraft.chapterTitle,
      summary: proposal.summaryDraft.summary,
      unresolvedThreads: proposal.summaryDraft.unresolvedThreads,
      promises: proposal.summaryDraft.promises,
      importantChanges: proposal.summaryDraft.importantChanges,
    }, now)
    committedSummary = true
  }
  if (options.commitCharacterDraft) {
    for (const characterDraftProposal of characterDraftProposals) {
      const application = applyTavernCharacterDraftProposal(next, characterDraftProposal, now)
      next = application.snapshot
      if (!application.applied) {
        pendingCharacterDraftProposals.push(characterDraftProposal)
        continue
      }
      committedCharacterDraft = true
    }
  }
  let pendingLorebookDraftProposals = lorebookDraftProposals
  if (options.commitLorebookDraft) {
    pendingLorebookDraftProposals = []
    for (const lorebookDraftProposal of lorebookDraftProposals) {
      const application = applyTavernLorebookDraftProposal(next, lorebookDraftProposal, now)
      next = application.snapshot
      if (!application.applied) {
        pendingLorebookDraftProposals.push(lorebookDraftProposal)
        continue
      }
      committedLorebookDraft = true
    }
  }
  const allowedMemoryIds = new Set(options.commitRelationshipMemoryCandidateIds ?? [])
  const resolvedPendingRelationshipMemoryCandidates = new Map<string, TavernRelationshipMemoryCandidate>()
  for (const candidate of proposal.relationshipMemoryCandidates) {
    if (!allowedMemoryIds.has(candidate.id)) continue
    const resolvedCandidate = resolveTavernRelationshipMemoryCandidateForApproval(next, candidate)
    resolvedPendingRelationshipMemoryCandidates.set(candidate.id, resolvedCandidate)
    if (!resolvedCandidate.characterId) continue
    next = upsertTavernRelationshipMemory(next, {
      id: resolvedCandidate.id,
      characterId: resolvedCandidate.characterId,
      kind: resolvedCandidate.kind,
      content: resolvedCandidate.content,
      weight: 0.6,
      userVisible: resolvedCandidate.suggestedUserVisible,
    }, now)
    committedRelationshipMemoryIds.push(resolvedCandidate.id)
  }
  let pendingSceneChangeProposals = sceneChangeProposals
  if (options.commitSceneChange) {
    pendingSceneChangeProposals = []
    for (const sceneChangeProposal of sceneChangeProposals) {
      const resolvedSceneChangeProposal = resolveTavernSceneChangeProposalForApproval(next, sceneChangeProposal)
      if (hasUnresolvedTavernSceneRefs(resolvedSceneChangeProposal)) {
        pendingSceneChangeProposals.push(resolvedSceneChangeProposal)
        continue
      }
      next = applyTavernSceneChangeProposal(next, resolvedSceneChangeProposal, now)
      committedSceneChange = true
    }
  }
  const pendingRelationshipMemoryCandidates = proposal.relationshipMemoryCandidates
    .filter((candidate) => !committedRelationshipMemoryIds.includes(candidate.id))
    .map((candidate) => resolvedPendingRelationshipMemoryCandidates.get(candidate.id) ?? candidate)
  const pendingRelationshipMemoryCandidateIds = pendingRelationshipMemoryCandidates.map((candidate) => candidate.id)
  const pendingSummaryDraft = Boolean(proposal.summaryDraft?.summary && !committedSummary)
  const uncommittedCharacterDraftProposals = options.commitCharacterDraft
    ? pendingCharacterDraftProposals
    : characterDraftProposals
  const pendingPrimaryCharacterDraft = uncommittedCharacterDraftProposals[0]
  const pendingAdditionalCharacterDrafts = uncommittedCharacterDraftProposals.slice(1)
  const pendingCharacterDraft = Boolean(pendingPrimaryCharacterDraft || pendingAdditionalCharacterDrafts.length)
  const pendingPrimaryLorebookDraft = pendingLorebookDraftProposals[0]
  const pendingAdditionalLorebookDrafts = pendingLorebookDraftProposals.slice(1)
  const pendingLorebookDraftCount = pendingLorebookDraftProposals.length
  const pendingLorebookDraft = pendingLorebookDraftCount > 0
  const pendingPrimarySceneChange = pendingSceneChangeProposals[0]
  const pendingAdditionalSceneChanges = pendingSceneChangeProposals.slice(1)
  const pendingSceneChangeCount = pendingSceneChangeProposals.length
  const pendingSceneChange = pendingSceneChangeCount > 0
  if (options.storePendingProposals !== false && (pendingSummaryDraft || pendingPrimaryCharacterDraft || pendingLorebookDraft || pendingRelationshipMemoryCandidates.length || pendingSceneChange)) {
    const pendingId = normalizeId(proposal.summaryDraft?.id ? `pending-${proposal.summaryDraft.id}` : undefined)
      ?? generateTavernId('pending-writeback', [pendingPrimaryCharacterDraft ? pendingPrimaryCharacterDraft.id : '', pendingPrimaryLorebookDraft ? pendingPrimaryLorebookDraft.id : '', ...pendingRelationshipMemoryCandidateIds, pendingPrimarySceneChange ? tavernSceneChangeProposalEvidenceId(pendingPrimarySceneChange) : ''].join(':'), now)
    next = upsertTavernPendingWriteback(next, {
      id: pendingId,
      sourceAssistantMessageId: proposal.summaryDraft?.id,
      summaryDraft: pendingSummaryDraft ? proposal.summaryDraft : undefined,
      characterDraftProposal: pendingPrimaryCharacterDraft,
      lorebookDraftProposal: pendingPrimaryLorebookDraft,
      relationshipMemoryCandidates: pendingRelationshipMemoryCandidates,
      sceneChangeProposal: pendingPrimarySceneChange,
      evidence: uniqueStrings([
        ...proposal.evidence,
        ...(pendingPrimaryLorebookDraft
          ? buildTavernLorebookDraftReviewEvidence(pendingPrimaryLorebookDraft)
          : []),
      ]),
    }, now)
    pendingWritebackStored = true
  }
  if (options.storePendingProposals !== false) {
    for (const characterDraftProposal of pendingAdditionalCharacterDrafts) {
      next = upsertTavernPendingWriteback(next, {
        id: normalizeId(`pending-${characterDraftProposal.id}`) ?? generateTavernId('pending-writeback', characterDraftProposal.id, now),
        sourceAssistantMessageId: proposal.summaryDraft?.id,
        characterDraftProposal,
        relationshipMemoryCandidates: [],
        evidence: uniqueStrings([`character-draft-candidate:${characterDraftProposal.id}`]),
      }, now)
      pendingWritebackStored = true
    }
    for (const lorebookDraftProposal of pendingAdditionalLorebookDrafts) {
      next = upsertTavernPendingWriteback(next, {
        id: normalizeId(`pending-${lorebookDraftProposal.id}`) ?? generateTavernId('pending-writeback', lorebookDraftProposal.id, now),
        sourceAssistantMessageId: proposal.summaryDraft?.id,
        lorebookDraftProposal,
        relationshipMemoryCandidates: [],
        evidence: uniqueStrings(buildTavernLorebookDraftReviewEvidence(lorebookDraftProposal)),
      }, now)
      pendingWritebackStored = true
    }
    for (const sceneChangeProposal of pendingAdditionalSceneChanges) {
      next = upsertTavernPendingWriteback(next, {
        id: generateTavernId('pending-writeback', tavernSceneChangeProposalEvidenceId(sceneChangeProposal), now),
        sourceAssistantMessageId: proposal.summaryDraft?.id,
        sceneChangeProposal,
        relationshipMemoryCandidates: [],
        evidence: uniqueStrings([
          sceneChangeProposal.sceneId ? `scene:${sceneChangeProposal.sceneId}` : '',
          sceneChangeProposal.branchFromSceneId ? `scene:${sceneChangeProposal.branchFromSceneId}` : '',
          tavernSceneChangeProposalEvidenceId(sceneChangeProposal),
        ]),
      }, now)
      pendingWritebackStored = true
    }
  }
  return {
    snapshot: next,
    committedSummary,
    pendingSummaryDraft,
    committedCharacterDraft,
    pendingCharacterDraft,
    committedLorebookDraft,
    pendingLorebookDraft,
    pendingLorebookDraftCount,
    committedRelationshipMemoryIds,
    pendingRelationshipMemoryCandidateIds,
    committedSceneChange,
    pendingSceneChange,
    pendingSceneChangeCount,
    pendingWritebackStored,
    evidence: proposal.evidence,
  }
}

function resolveActiveScene(snapshot: TavernSnapshot, sceneId: string | undefined): TavernScene | undefined {
  if (sceneId) return snapshot.scenes.find((scene) => scene.id === sceneId)
  return snapshot.scenes.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0]
}

function buildCharacterDraftProposals(input: {
  userInput?: string
  assistantOutput?: string
  characters: TavernCharacterCard[]
  allCharacters?: TavernCharacterCard[]
  scene?: TavernScene
  now: number
}): TavernCharacterDraftProposal[] {
  const source = [input.userInput, input.assistantOutput]
    .filter(Boolean)
    .join('\n')
    .trim()
    .slice(0, TEXT_LIMIT)
  if (!source || !hasCharacterDraftCue(source)) return []
  const blocks = splitTavernCharacterDraftBlocks(source)
  return uniqueByComparable(
    blocks
      .map((block, index) => buildCharacterDraftProposalFromSource({
        source: block,
        characters: input.characters,
        allCharacters: input.allCharacters,
        scene: input.scene,
        now: input.now,
        fallbackExisting: blocks.length === 1 ? input.characters[0] : undefined,
        multiCharacterDraft: blocks.length > 1,
        blockIndex: index,
      }))
      .filter((proposal): proposal is TavernCharacterDraftProposal => Boolean(proposal)),
    (proposal) => `${proposal.characterId ?? ''}:${normalizeComparableText(proposal.name)}:${normalizeComparableText(proposal.persona ?? '')}:${normalizeComparableText(proposal.speechStyle ?? '')}`
  )
}

function buildCharacterDraftProposalFromSource(input: {
  source: string
  characters: TavernCharacterCard[]
  allCharacters?: TavernCharacterCard[]
  scene?: TavernScene
  now: number
  fallbackExisting?: TavernCharacterCard
  multiCharacterDraft: boolean
  blockIndex: number
}): TavernCharacterDraftProposal | undefined {
  const source = input.source.trim().slice(0, TEXT_LIMIT)
  if (!source || !hasCharacterDraftCue(source)) return undefined
  const explicitName = extractTavernCharacterHeaderName(source)
    ?? extractTavernLabeledField(source, ['name', 'character name', 'character', 'person', 'virtual person', 'virtual character', '角色名', '角色', '人物', '虚拟人物', '虛擬人物', '名前', 'キャラクター', 'キャラ', '仮想人物'])
  const explicitTargetRef = extractTavernLabeledField(source, ['target character', 'target person', 'update character', 'update target', 'character id', 'character ID', 'target id', 'target ID', 'target', '目标角色', '目標角色', '目标人物', '目標人物', '更新角色', '更新目標', '更新目标', '角色ID', '角色 ID', '対象キャラクター', '対象人物', '更新対象', '対象ID', 'キャラクターID'])
  const targetExisting = resolveTavernExistingCharacterForDraft(explicitTargetRef, input.allCharacters ?? input.characters)
  const matchedExisting = resolveTavernExistingCharacterForDraft(explicitName, input.characters)
  const existing = targetExisting ?? matchedExisting ?? (!explicitName && !explicitTargetRef ? input.fallbackExisting : undefined)
  const name = explicitName
    ?? existing?.name
    ?? 'Tavern character'
  const persona = extractTavernLabeledField(source, ['persona', 'personality', 'character traits', 'traits', '人设', '人設', '人格', '性格', '人物设定', '人物設定', '性格設定'])
  const voice = extractTavernLabeledField(source, ['voice', 'tone', 'speech', 'speech style', '语气', '語氣', '说话方式', '說話方式', '口吻', '話し方', '口調'])
  const emotionalTone = extractTavernLabeledField(source, ['emotional tone', 'emotional range', 'emotional style', 'affect', 'feeling tone', '情绪基调', '情緒基調', '情绪语气', '情緒語氣', '情绪输出', '情緒輸出', '情感基调', '情感基調', '感情のトーン', '感情表現', '感情の幅'])
  const wordingStyle = extractTavernLabeledField(source, ['wording', 'phrasing', 'phrases', 'recurring wording', 'recurring phrases', 'signature phrases', 'preferred phrases', 'catchphrases', '措辞', '措辭', '措辞规则', '措辭規則', '常用措辞', '常用措辭', '常用表达', '常用表達', '口头禅', '口頭禪', '言葉選び', '言い回し', '決まり文句', 'よく使う言葉'])
  const exampleLines = extractTavernLabeledFields(source, TAVERN_CHARACTER_VOICE_SAMPLE_LABELS)
  const speechStyle = normalizeText(uniqueStrings([
    voice,
    emotionalTone ? `Emotional tone: ${emotionalTone}` : '',
    wordingStyle ? `Wording: ${wordingStyle}` : '',
    ...exampleLines.map((exampleLine) => `Example line: ${exampleLine}`),
  ].filter(isString)).join(' '), TEXT_LIMIT)
  let background = extractTavernLabeledField(source, ['background', 'scene', 'first scene', 'opening scene', '背景', '场景', '開場', '开场', '場面'])
  const openingMessage = extractTavernLabeledField(source, ['opening', 'first line', 'first reply', 'first message', 'opening message', 'greeting', '开场白', '开场', '開場白', '開場', '第一句', '第一句话', '第一句話', '第一条消息', '第一條消息', '首次回应', '首次回應', '问候', '問候', '冒頭', '最初の一言', '最初の言葉', '第一声', '初回メッセージ', '挨拶'])
  const constraints = uniqueStrings([
    ...splitTavernStructuredList(extractTavernLabeledListField(source, ['boundaries', 'boundary', 'constraints', 'limits', 'avoid', '边界', '邊界', '限制', '禁忌', '境界', '制約'])),
    ...splitTavernStructuredList(extractTavernLabeledListField(source, ['traits to avoid', 'avoid traits', 'avoid personality', 'avoid persona', 'avoid archetype', 'avoid character traits', 'negative traits', 'identity to avoid', 'avoid identity', 'avoid role', '反例', '避免性格', '避开性格', '避開性格', '不要的性格', '不要的人设', '不要的人設', '避免特征', '避免特徵', '避免身份', '不要的身份', '避けたい性格', '避ける性格', '避けたい特徴', '避けたい人格', '苦手な性格', '避けたい立場', '避けたい役割']))
      .map((trait) => `Avoid trait: ${trait}`),
    ...splitTavernStructuredList(extractTavernLabeledListField(source, ['phrases to avoid', 'avoid phrases', 'avoid wording', 'forbidden phrases', 'avoid expressions', '避免措辞', '避免措辭', '避免表达', '避免表達', '避免说法', '避免說法', '禁用措辞', '禁用措辭', '避けたい表現', '避ける言い方', '使わない言葉']))
      .map((phrase) => `Avoid phrase: ${phrase}`),
  ])
  const tags = uniqueStrings([
    ...splitTavernStructuredList(extractTavernLabeledListField(source, ['tags', '标签', '標籤', 'タグ'])),
    'conversation-shaped',
  ])
  const hasDraftContent = Boolean(persona || speechStyle || background || openingMessage || constraints.length)
  if (!hasDraftContent) return undefined
  background = background ?? input.scene?.narrativeGoal
  return {
    id: generateTavernId('character-draft', `${existing?.id ?? name}:${input.blockIndex}:${persona ?? ''}:${speechStyle ?? ''}:${background ?? ''}:${openingMessage ?? ''}`, input.now),
    characterId: existing?.id,
    name,
    persona,
    speechStyle,
    background,
    openingMessage,
    constraints,
    tags,
    reason: input.multiCharacterDraft
      ? 'Detected explicit multi-character shaping summaries in the Tavern turn. User confirmation is required before saving character cards.'
      : 'Detected an explicit character-shaping summary in the Tavern turn. User confirmation is required before saving the character card.',
    requiresUserConfirmation: true,
  }
}

function hasCharacterDraftCue(source: string): boolean {
  return /(?:character|person|virtual person|virtual character|角色|人物|虚拟人物|虛擬人物|キャラクター|キャラ|仮想人物)(?:\s*(?:[#№]?\s*[\d０-９一二三四五六七八九十]+|第\s*[\d０-９一二三四五六七八九十]+|[\d０-９一二三四五六七八九十]+\s*(?:人目|番目)))?\s*[:：=]/i.test(source) ||
    /(?:persona|personality|voice|tone|emotional tone|emotional range|speech style|wording|phrasing|phrases|example line|sample line|example reply|sample reply|voice sample|phrases to avoid|traits to avoid|avoid traits|avoid personality|avoid archetype|avoid identity|identity to avoid|boundar(?:y|ies)|opening message)\s*[:：=]/i.test(source) ||
    /(?:角色|人物|虚拟人物|虛擬人物|人设|人設|人格|语气|語氣|说话方式|說話方式|情绪基调|情緒基調|情绪语气|情緒語氣|情绪输出|情緒輸出|措辞|措辭|常用措辞|常用措辭|例句|示例句|示例回复|示例回覆|说话示例|說話示例|语气示例|語氣示例|代表台词|代表台詞|避免措辞|避免措辭|避免性格|避开性格|避開性格|不要的性格|避免身份|不要的身份|边界|邊界|限制|开场白|開場白|場面|キャラクター|キャラ|話し方|口調|感情のトーン|言葉選び|セリフ例|台詞例|話し方の例|返答例|避けたい表現|避けたい性格|避けたい特徴|避けたい立場|境界|仮想人物)\s*[:：=]/.test(source)
}

function splitTavernCharacterDraftBlocks(source: string): string[] {
  const blockStartPattern = /^\s*(?:character|person|virtual person|virtual character|角色|人物|虚拟人物|虛擬人物|キャラクター|キャラ|仮想人物)(?:\s*(?:[#№]?\s*[\d０-９一二三四五六七八九十]+|第\s*[\d０-９一二三四五六七八九十]+|[\d０-９一二三四五六七八九十]+\s*(?:人目|番目)))?\s*[:：=]/i
  const lines = source.split(/\r?\n/)
  const blocks: string[] = []
  let current: string[] = []
  for (const line of lines) {
    if (blockStartPattern.test(line)) {
      if (current.length) blocks.push(current.join('\n'))
      current = [line]
      continue
    }
    if (current.length) current.push(line)
  }
  if (current.length) blocks.push(current.join('\n'))
  return blocks.length > 1 ? blocks.slice(0, LIST_LIMIT) : [source]
}

function extractTavernCharacterHeaderName(source: string): string | undefined {
  const match = /(?:^|[\n;；])\s*(?:character|person|virtual person|virtual character|角色|人物|虚拟人物|虛擬人物|キャラクター|キャラ|仮想人物)(?:\s*(?:[#№]?\s*[\d０-９一二三四五六七八九十]+|第\s*[\d０-９一二三四五六七八九十]+|[\d０-９一二三四五六七八九十]+\s*(?:人目|番目)))?\s*[:：=]\s*([^\n;；]+)/i.exec(source)
  return normalizeText(match?.[1], SHORT_TEXT_LIMIT)
}

function resolveTavernExistingCharacterForDraft(name: string | undefined, characters: TavernCharacterCard[]): TavernCharacterCard | undefined {
  if (!name) return undefined
  const key = normalizeComparableText(name)
  const idMatch = characters.find((character) => normalizeComparableText(character.id) === key)
  if (idMatch) return idMatch
  const nameMatches = characters.filter((character) => normalizeComparableText(character.name) === key)
  return nameMatches.length === 1 ? nameMatches[0] : undefined
}

function buildLorebookDraftProposals(input: {
  userInput?: string
  assistantOutput?: string
  lorebook: TavernLorebookEntry[]
  now: number
}): TavernLorebookDraftProposal[] {
  const source = [input.userInput, input.assistantOutput]
    .filter(Boolean)
    .join('\n')
    .trim()
    .slice(0, TEXT_LIMIT)
  if (!source || !hasLorebookDraftCue(source)) return []
  const blocks = splitTavernLorebookDraftBlocks(source)
  return uniqueByComparable(
    (blocks.length ? blocks : [source])
      .slice(0, LIST_LIMIT)
      .map((block) => buildLorebookDraftProposalFromSource({
        source: block,
        lorebook: input.lorebook,
        now: input.now,
      }))
      .filter((proposal): proposal is TavernLorebookDraftProposal => Boolean(proposal)),
    (proposal) => `${proposal.loreId ?? ''}:${normalizeComparableText(proposal.title)}:${normalizeComparableText(proposal.content)}`
  )
}

function buildLorebookDraftProposalFromSource(input: {
  source: string
  lorebook: TavernLorebookEntry[]
  now: number
}): TavernLorebookDraftProposal | undefined {
  const source = input.source.trim().slice(0, TEXT_LIMIT)
  if (!source || !hasLorebookDraftCue(source)) return undefined
  const draftSource = selectTavernLorebookDraftSource(source)
  const targetRef = extractTavernLabeledField(draftSource, ['target lore', 'target lorebook', 'target world info', 'target world rule', 'lore id', 'lore ID', 'lorebook id', 'world info id', '目标世界书', '目標世界書', '目标世界', '目標世界', '世界书ID', '世界書ID', '目标规则', '目標規則', '対象ロア', '対象世界観', 'ロアID', '世界観ID'])
  const existing = resolveTavernExistingLorebookForDraft(targetRef, input.lorebook)
  const title = extractTavernLabeledField(draftSource, ['title', 'lore title', 'lorebook title', 'world title', 'setting title', 'rule title', '标题', '標題', '世界书标题', '世界書標題', '世界观标题', '世界觀標題', '规则标题', '規則標題', 'タイトル', 'ロアタイトル', '世界観タイトル', 'ルール名'])
    ?? existing?.title
  const inlineContent = extractTavernInlineBlockHeaderValue(draftSource, TAVERN_LOREBOOK_BLOCK_LABELS)
  const content = extractTavernLabeledField(draftSource, ['content', 'note', 'rule', 'world rule', 'background rule', 'background fact', 'canon', 'setting rule', 'world fact', 'description', ...TAVERN_LOREBOOK_BLOCK_LABELS, '内容', '內容', '设定', '設定', '规则', '規則', '世界规则', '世界規則', '背景规则', '背景規則', '背景事实', '背景事實', '正史', '本文', '世界のルール', '背景ルール', '背景事実', '正史設定', '内容'])
    ?? inlineContent
  const normalizedContent = normalizeText(content, TEXT_LIMIT)
  if (!normalizedContent) return undefined
  const keywords = splitTavernStructuredList(extractTavernLabeledListField(draftSource, ['keywords', 'keys', 'key', 'tags', '关键词', '關鍵詞', '关键字', '關鍵字', '触发词', '觸發詞', '标签', '標籤', 'キーワード', 'キー', 'タグ']))
  const priorityText = extractTavernLabeledField(draftSource, ['priority', 'weight', 'order', '优先级', '優先級', '权重', '權重', '順序', '優先度'])
  const priority = priorityText ? clampNumber(Number(priorityText), 0, 100, existing?.priority ?? 50) : existing?.priority
  const enabledText = extractTavernLabeledField(draftSource, ['enabled', 'active', '启用', '啟用', '生效', '有効', '有効化'])
  const enabled = enabledText ? !/(?:false|off|disabled|no|否|禁用|停用|無効|オフ)/i.test(enabledText) : existing?.enabled
  const finalTitle = normalizeText(title, SHORT_TEXT_LIMIT) ?? inferTavernLorebookTitle(normalizedContent)
  return {
    id: generateTavernId('lore-draft', `${existing?.id ?? finalTitle}:${normalizedContent}`, input.now),
    loreId: existing?.id,
    title: finalTitle,
    content: normalizedContent,
    keywords,
    priority,
    enabled,
    reason: 'Detected an explicit lore, world-rule, canon, or background-rule summary in the Tavern turn. User confirmation is required before saving lore.',
    requiresUserConfirmation: true,
  }
}

const TAVERN_LOREBOOK_BLOCK_LABELS = ['lore', 'lorebook', 'world info', 'world rule', 'background rule', 'background fact', 'canon', 'setting rule', 'worldbuilding', 'world building', '世界书', '世界書', '世界观', '世界觀', '世界规则', '世界規則', '背景规则', '背景規則', '背景事实', '背景事實', '正史', 'ロア', '世界観', '世界のルール', '背景ルール', '背景事実', '正史設定']

function selectTavernLorebookDraftSource(source: string): string {
  const blocks = splitTavernLorebookDraftBlocks(source)
  if (blocks.length) return blocks[0]
  return source
}

function splitTavernLorebookDraftBlocks(source: string): string[] {
  const lines = source.split(/\r?\n/)
  const blocks: string[] = []
  let current: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (isTavernLorebookDraftBlockStart(trimmed)) {
      if (current.length) blocks.push(current.join('\n'))
      current = [line]
      continue
    }
    if (!current.length) continue
    if (!trimmed) {
      blocks.push(current.join('\n'))
      current = []
      continue
    }
    if (isTavernNonLoreDraftBlockStart(trimmed)) {
      blocks.push(current.join('\n'))
      current = []
      continue
    }
    current.push(line)
  }
  if (current.length) blocks.push(current.join('\n'))
  return blocks
}

function isTavernLorebookDraftBlockStart(line: string): boolean {
  const escaped = TAVERN_LOREBOOK_BLOCK_LABELS.map(escapeRegExp).join('|')
  return new RegExp(`^\\s*(?:${escaped})\\s*[:：=]`, 'i').test(line)
}

function isTavernNonLoreDraftBlockStart(line: string): boolean {
  return /^(?:character|person|virtual person|virtual character|scene|relationship\s+memory|memory|relationship\s+note|relationship\s+signal|relationship\s+role|relationship\s+dynamic|relationship\s+style|角色|人物|虚拟人物|虛擬人物|场景|場景|记忆|記憶|关系记忆|關係記憶|关系信号|關係信號|关系定位|關係定位|关系角色|關係角色|キャラクター|キャラ|仮想人物|シーン|場面|メモ|関係の手がかり|関係性の役割)\s*[:：=]/i.test(line)
}

function hasLorebookDraftCue(source: string): boolean {
  return /(?:lore|lorebook|world info|world rule|world rules|background rule|background fact|canon|setting rule|worldbuilding|world building)\s*[:：=]/i.test(source) ||
    /(?:世界书|世界書|世界观|世界觀|世界规则|世界規則|背景规则|背景規則|背景事实|背景事實|正史|设定规则|設定規則|魔法体系)\s*[:：=]/.test(source) ||
    /(?:ロア|世界観|世界のルール|背景ルール|背景事実|正史設定|設定ルール|魔法体系)\s*[:：=]/.test(source)
}

function inferTavernLorebookTitle(content: string): string {
  const firstClause = normalizeText(content.split(/[.。！？!?;；\n]/)[0], SHORT_TEXT_LIMIT)
  return firstClause || 'Tavern lore'
}

function extractTavernLabeledField(source: string, labels: string[]): string | undefined {
  const escaped = labels.map(escapeRegExp).join('|')
  const pattern = new RegExp(`(?:^|[\\n;；])\\s*(?:${escaped})\\s*[:：=]\\s*([^\\n;；]+)`, 'i')
  return normalizeText(pattern.exec(source)?.[1], TEXT_LIMIT)
}

function extractTavernLabeledFields(source: string, labels: readonly string[]): string[] {
  const escaped = labels.map(escapeRegExp).join('|')
  const pattern = new RegExp(`(?:^|[\\n;；])\\s*(?:${escaped})\\s*[:：=]\\s*([^\\n;；]+)`, 'gi')
  return uniqueStrings(Array.from(source.matchAll(pattern))
    .map((match) => normalizeText(match[1], TEXT_LIMIT))
    .filter(isString))
}

function extractTavernLabeledListField(source: string, labels: string[]): string | undefined {
  const escaped = labels.map(escapeRegExp).join('|')
  const pattern = new RegExp(`(?:^|[\\n])\\s*(?:${escaped})\\s*[:：=]\\s*([^\\n]+)`, 'i')
  return normalizeText(pattern.exec(source)?.[1], TEXT_LIMIT)
}

function splitTavernStructuredList(value?: string): string[] {
  if (!value) return []
  return uniqueStrings(value.split(/[,，、|/；;]/).map((item) => normalizeText(item, SHORT_TEXT_LIMIT)).filter(isString))
}

function buildRelationshipMemoryCandidates(input: {
  userInput?: string
  assistantOutput?: string
  characterId?: string
  characters?: TavernCharacterCard[]
  existingMemories?: TavernRelationshipMemory[]
  now: number
}): TavernRelationshipMemoryCandidate[] {
  const rawSource = [input.userInput, input.assistantOutput]
    .filter(Boolean)
    .join('\n')
    .trim()
    .slice(0, TEXT_LIMIT)
  const source = normalizeText(rawSource, TEXT_LIMIT)
  if (!source) return []
  const labeledCandidates = buildLabeledRelationshipMemoryCandidates({
    source: rawSource,
    characters: input.characters ?? [],
    existingMemories: input.existingMemories ?? [],
    now: input.now,
  })
  if (labeledCandidates.length) return labeledCandidates
  if (!input.characterId || !hasRelationshipMemoryCue(source)) return []
  const kind = inferRelationshipMemoryKind(source)
  const content = selectRelationshipMemoryCandidateText(source)
  if (!content) return []
  const review = resolveRelationshipMemoryCandidateReview({
    characterId: input.characterId,
    kind,
    content,
    existingMemories: input.existingMemories ?? [],
  })
  return [{
    id: generateTavernId('memory-candidate', `${input.characterId}:${kind}:${content}`, input.now),
    characterId: input.characterId,
    kind,
    content,
    suggestedUserVisible: inferRelationshipMemoryVisibility(source, kind),
    confidence: inferRelationshipMemoryConfidence(source, kind),
    retentionClass: inferRelationshipMemoryRetentionClass(source, kind),
    reviewStatus: review.status,
    relatedMemoryId: review.relatedMemoryId,
    reason: 'Detected a relationship, preference, promise, or boundary cue in the Tavern turn. User confirmation is required before persistence or cross-mode use.',
    requiresUserConfirmation: true,
  }]
}

function buildLabeledRelationshipMemoryCandidates(input: {
  source: string
  characters: TavernCharacterCard[]
  existingMemories: readonly TavernRelationshipMemory[]
  now: number
}): TavernRelationshipMemoryCandidate[] {
  const blocks = splitTavernRelationshipMemoryBlocks(input.source)
  if (!blocks.length) return []
  const candidates: TavernRelationshipMemoryCandidate[] = []
  const seen = new Set<string>()
  for (const block of blocks.slice(0, LIST_LIMIT)) {
    const targetCharacterText = extractTavernLabeledField(block, ['target character', 'target person', 'target role', 'character id', 'character ID', 'target id', 'target ID', '目标角色', '目標角色', '目标人物', '目標人物', '角色ID', '角色 ID', '対象キャラクター', '対象人物', '対象ID', 'キャラクターID'])
    const characterText = targetCharacterText
      ?? extractTavernLabeledField(block, ['character', 'person', '角色', '人物', '角色名', '人物名', 'キャラクター', 'キャラ', '人物名'])
    const characterResolution = resolveTavernCharacterRefResolution(characterText, input.characters)
    const characterId = characterResolution.resolved[0]
    const unresolvedCharacterRef = characterId ? undefined : characterResolution.unresolved[0]
    const content = extractTavernLabeledField(block, ['content', 'note', '内容', '內容', 'メモ'])
      ?? extractTavernInlineBlockHeaderValue(block, ['memory', 'relationship memory', 'relationship note', 'relationship signal', 'relationship role', 'relationship dynamic', 'relationship style', '记忆', '記憶', '关系记忆', '關係記憶', '关系信号', '關係信號', '关系定位', '關係定位', '关系角色', '關係角色', 'メモ', '関係の手がかり', '関係性の役割'])
    if ((!characterId && !unresolvedCharacterRef) || !content) continue
    const kindText = extractTavernLabeledField(block, ['kind', 'type', 'memory kind', '类型', '類型', '类别', '類別', '種別', '種類'])
    const kind = normalizeRelationshipMemoryKindText(kindText) ?? inferRelationshipMemoryKind(`${kindText ?? ''} ${content}`)
    const visibilityText = extractTavernLabeledField(block, ['visibility', 'visible', 'privacy', 'share', '可见性', '可見性', '可见', '可見', '私密', '隐私', '隱私', '公開範囲', '共有範囲'])
    const retentionText = extractTavernLabeledField(block, ['retention', 'retention class', 'keep', '保留', '留存', '保存', '保持', '保持期間', '保存期間'])
    const reason = extractTavernLabeledField(block, ['reason', 'why', '原因', '理由', '理由づけ'])
    const review = characterId
      ? resolveRelationshipMemoryCandidateReview({
        characterId,
        kind,
        content,
        existingMemories: input.existingMemories,
      })
      : { status: 'new' as TavernRelationshipMemoryReviewStatus, relatedMemoryId: undefined }
    const characterRefForId = characterId ?? unresolvedCharacterRef
    const dedupeKey = normalizeComparableText(`${characterRefForId}:${kind}:${content}`)
    if (!dedupeKey || seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    candidates.push({
      id: generateTavernId('memory-candidate', `${characterRefForId}:${kind}:${content}`, input.now),
      characterId,
      unresolvedCharacterRef,
      kind,
      content,
      suggestedUserVisible: inferLabeledRelationshipMemoryVisibility(visibilityText, content, kind),
      confidence: Math.max(0.86, inferRelationshipMemoryConfidence(`${kindText ?? ''} ${content}`, kind)),
      retentionClass: normalizeLabeledRelationshipMemoryRetentionClass(retentionText, content, kind),
      reviewStatus: review.status,
      relatedMemoryId: review.relatedMemoryId,
      reason: reason ?? 'Detected an explicit relationship memory summary in the Tavern turn. User confirmation is required before persistence or cross-mode use.',
      requiresUserConfirmation: true,
    })
  }
  return candidates
}

function splitTavernRelationshipMemoryBlocks(source: string): string[] {
  const blocks: string[] = []
  let current: string[] = []
  for (const line of source.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    if (isTavernRelationshipMemoryBlockStart(line)) {
      if (current.length) blocks.push(current.join('\n'))
      current = [line]
      continue
    }
    if (current.length) current.push(line)
  }
  if (current.length) blocks.push(current.join('\n'))
  return blocks
}

function isTavernRelationshipMemoryBlockStart(line: string): boolean {
  return /^(?:relationship\s+memory|memory|relationship\s+note|relationship\s+signal|relationship\s+role|relationship\s+dynamic|relationship\s+style|memory\s+\d+|记忆|記憶|关系记忆|關係記憶|关系信号|關係信號|关系定位|關係定位|关系角色|關係角色|メモ|関係の手がかり|関係性の役割)(?:\s+\d+)?\s*[:：=]/i.test(line)
}

function extractTavernInlineBlockHeaderValue(block: string, labels: string[]): string | undefined {
  const firstLine = block.split(/\r?\n/)[0]?.trim()
  if (!firstLine) return undefined
  const escaped = labels.map(escapeRegExp).join('|')
  const pattern = new RegExp(`^(?:${escaped})(?:\\s+\\d+)?\\s*[:：=]\\s*(.+)$`, 'i')
  return normalizeText(pattern.exec(firstLine)?.[1], TEXT_LIMIT)
}

function normalizeRelationshipMemoryKindText(value?: string): TavernRelationshipMemoryKind | undefined {
  if (!value) return undefined
  if (/boundary|limit|constraint|consent|personal space|pet name|nickname|too intimate|边界|邊界|限制|称呼|稱呼|昵称|暱稱|距离感|距離感|越界|同意|境界|制約|距離感|呼び方|あだ名|愛称|同意|許可/i.test(value)) return 'boundary'
  if (/preference|prefer|like|favorite|偏好|喜好|喜欢|喜歡|好み|好き/i.test(value)) return 'preference'
  if (/trust|信任|信頼/i.test(value)) return 'trust'
  if (/affinity|closeness|closer|亲近|好感|親し/i.test(value)) return 'affinity'
  if (/event|fact|note|事件|事实|出来事|事実/i.test(value)) return 'event'
  return undefined
}

function inferLabeledRelationshipMemoryVisibility(value: string | undefined, content: string, kind: TavernRelationshipMemoryKind): boolean {
  if (value && /private|secret|sensitive|hidden|local|私密|秘密|敏感|隐藏|隱藏|本地|非公開/i.test(value)) return false
  if (value && /visible|public|shareable|show|可见|可見|公开|公開|表示/i.test(value)) return true
  return inferRelationshipMemoryVisibility(content, kind)
}

function normalizeLabeledRelationshipMemoryRetentionClass(
  value: string | undefined,
  content: string,
  kind: TavernRelationshipMemoryKind
): TavernRelationshipMemoryRetentionClass {
  if (value && /boundary|边界|邊界|境界/i.test(value)) return 'boundary'
  if (value && /long(?:-| )?term|persistent|长期|長期/i.test(value)) return 'long-term'
  if (value && /session|temporary|this scene|for now|本轮|本輪|暂时|暫時|一時|この場面/i.test(value)) return 'session'
  return inferRelationshipMemoryRetentionClass(content, kind)
}

function resolveRelationshipMemoryCandidateReview(input: {
  characterId: string
  kind: TavernRelationshipMemoryKind
  content: string
  existingMemories: readonly TavernRelationshipMemory[]
}): { status: TavernRelationshipMemoryReviewStatus; relatedMemoryId?: string } {
  const scoped = input.existingMemories.filter((memory) => memory.characterId === input.characterId)
  const strictDuplicate = scoped.find((memory) => memory.kind === input.kind && isStrictDuplicateRelationshipMemory(memory.content, input.content))
  if (strictDuplicate) return { status: 'duplicate', relatedMemoryId: strictDuplicate.id }
  const conflict = scoped.find((memory) => isLikelyConflictingRelationshipMemory(memory, input.kind, input.content))
  if (conflict) return { status: 'conflict', relatedMemoryId: conflict.id }
  const duplicate = scoped.find((memory) => memory.kind === input.kind && isLikelyDuplicateRelationshipMemory(memory.content, input.content))
  if (duplicate) return { status: 'duplicate', relatedMemoryId: duplicate.id }
  return { status: 'new' }
}

function isStrictDuplicateRelationshipMemory(existing: string, candidate: string): boolean {
  const existingText = normalizeComparableText(existing)
  const candidateText = normalizeComparableText(candidate)
  if (!existingText || !candidateText) return false
  return existingText === candidateText || existingText.includes(candidateText) || candidateText.includes(existingText)
}

function isLikelyDuplicateRelationshipMemory(existing: string, candidate: string): boolean {
  if (isStrictDuplicateRelationshipMemory(existing, candidate)) return true
  const existingText = normalizeComparableText(existing)
  const candidateText = normalizeComparableText(candidate)
  if (!existingText || !candidateText) return false
  return tokenOverlapRatio(tokenizeComparableText(existingText), tokenizeComparableText(candidateText)) >= 0.72
}

function isLikelyConflictingRelationshipMemory(
  existing: TavernRelationshipMemory,
  candidateKind: TavernRelationshipMemoryKind,
  candidateContent: string
): boolean {
  if (existing.kind !== candidateKind && existing.kind !== 'boundary' && candidateKind !== 'boundary') return false
  const existingTokens = tokenizeComparableText(existing.content)
  const candidateTokens = tokenizeComparableText(candidateContent)
  if (tokenOverlapRatio(existingTokens, candidateTokens) < 0.2) return false
  return hasRelationshipMemoryConflictCue(candidateContent) || hasContrastingRelationshipMemoryTokens(existingTokens, candidateTokens)
}

function selectRelationshipMemoryCandidateText(source: string): string | undefined {
  const sentences = splitTavernSentences(source)
  const cueSentences = sentences.filter(hasRelationshipMemoryCue)
  const selected = cueSentences.length ? cueSentences : sentences
  return normalizeText(selected.slice(0, 2).join(' '), 420)
}

function buildSceneChangeProposals(input: {
  scene?: TavernScene
  scenes?: TavernScene[]
  characters?: TavernCharacterCard[]
  userInput?: string
  assistantOutput?: string
}): TavernSceneChangeProposal[] {
  const source = [input.userInput, input.assistantOutput]
    .filter(Boolean)
    .join('\n')
    .trim()
    .slice(0, TEXT_LIMIT)
  const normalizedSource = normalizeText(source, TEXT_LIMIT)
  if (!normalizedSource) return []
  const blocks = splitTavernSceneChangeBlocks(source)
  return uniqueByComparable(
    (blocks.length ? blocks : [source])
      .slice(0, LIST_LIMIT)
      .map((block) => buildSceneChangeProposalFromSource({
        scene: input.scene,
        scenes: input.scenes,
        characters: input.characters,
        source: block,
      }))
      .filter((proposal): proposal is TavernSceneChangeProposal => Boolean(proposal)),
    (proposal) => `${proposal.sceneId ?? ''}:${proposal.branchFromSceneId ?? ''}:${normalizeComparableText(proposal.title ?? '')}:${normalizeComparableText(proposal.location ?? '')}:${normalizeComparableText(proposal.narrativeGoal ?? '')}`
  )
}

function buildSceneChangeProposalFromSource(input: {
  scene?: TavernScene
  scenes?: TavernScene[]
  characters?: TavernCharacterCard[]
  source: string
}): TavernSceneChangeProposal | undefined {
  const source = input.source.trim().slice(0, TEXT_LIMIT)
  const normalizedSource = normalizeText(source, TEXT_LIMIT)
  if (!normalizedSource) return undefined
  const hasExplicitSceneSummary = hasSceneDraftCue(source)
  const hasTransition = hasSceneChangeCue(normalizedSource)
  const hasAmbientSceneShaping = hasAmbientSceneShapingCue(normalizedSource)
  if (!hasTransition && !hasExplicitSceneSummary && !hasAmbientSceneShaping) return undefined
  const explicitTitle = extractTavernSceneHeaderTitle(source)
    ?? extractTavernLabeledField(source, ['scene', 'scene title', 'title', '场景', '場景', '场景标题', '場景標題', '標題', '場面', 'シーン', '場面名'])
  const explicitTargetRef = extractTavernLabeledField(source, ['target scene', 'target location', 'update scene', 'update target', 'scene id', 'scene ID', 'target id', 'target ID', 'target', '目标场景', '目標場景', '目标場景', '目標场景', '目标地点', '目標地點', '更新场景', '更新場景', '场景ID', '場景ID', '场景 ID', '場景 ID', '対象シーン', '対象場面', '更新対象', 'シーンID', '場面ID'])
  const sceneTargetResolution = resolveTavernSceneRefResolution(explicitTargetRef, input.scenes ?? (input.scene ? [input.scene] : []))
  const targetScene = sceneTargetResolution.resolved
    ? (input.scenes ?? [input.scene].filter((scene): scene is TavernScene => Boolean(scene))).find((scene) => scene.id === sceneTargetResolution.resolved)
    : undefined
  const explicitLocation = extractTavernLabeledField(source, ['location', 'place', 'setting', '地点', '地點', '位置', '场所', '場所'])
  const timeOfDay = extractTavernLabeledField(source, ['time', 'time of day', '时段', '時段', '时间', '時間', '時刻'])
  const mood = extractTavernLabeledField(source, ['mood', 'atmosphere', 'vibe', '氛围', '氛圍', '气氛', '氣氛', '情绪', '情緒', '雰囲気'])
    ?? (hasAmbientSceneShaping ? inferAmbientSceneMood(normalizedSource) : undefined)
  const destination = hasTransition ? inferSceneChangeDestination(normalizedSource) : undefined
  const narrativeGoal = extractTavernLabeledField(source, ['goal', 'narrative goal', 'scene goal', 'first beat', 'what happens first', '目标', '目標', '场景目标', '場景目標', '先发生', '先發生', '最先发生', '最先發生', '目的', '狙い'])
    ?? (hasTransition ? selectSceneChangeCandidateText(normalizedSource, destination ?? explicitLocation ?? explicitTitle) : undefined)
    ?? (hasAmbientSceneShaping ? 'Atmosphere-first scene shaping; ask before adding plot, fixed cast, or major events.' : undefined)
  const activeCharacterRefs = resolveTavernCharacterRefResolution(
    extractTavernLabeledListField(source, ['active characters', 'characters', 'cast', 'present characters', '在场角色', '在場角色', '登场角色', '登場角色', '出场角色', '出場角色', '角色', '人物', '登場人物', 'キャラクター', 'キャラ']),
    input.characters ?? []
  )
  const activeCharacterIds = activeCharacterRefs.resolved
  const speakingOrderRefs = resolveTavernCharacterRefResolution(
    extractTavernLabeledListField(source, ['speaking order', 'turn order', 'order', '发言顺序', '發言順序', '轮次顺序', '輪次順序', '顺序', '順序', '話す順番', '発話順']),
    input.characters ?? []
  )
  const speakingOrder = speakingOrderRefs.resolved
  const narratorStyle = extractTavernLabeledField(source, ['narrator', 'narrator style', 'narration', 'narration style', '旁白', '旁白风格', '旁白風格', '叙述', '敘述', '叙述风格', '敘述風格', 'ナレーター', '語り口'])
  const sceneBranch = inferTavernSceneBranchMode(source, input.scene, input.scenes)
  const title = explicitTitle ?? destination ?? targetScene?.title ?? input.scene?.title
  const location = explicitLocation ?? destination ?? explicitTitle ?? targetScene?.location ?? input.scene?.location
  return {
    sceneId: sceneBranch.createNewScene ? undefined : targetScene?.id ?? (explicitTargetRef ? undefined : input.scene?.id),
    unresolvedSceneRef: sceneBranch.createNewScene ? undefined : sceneTargetResolution.unresolved,
    createNewScene: sceneBranch.createNewScene || undefined,
    branchFromSceneId: sceneBranch.branchFromSceneId,
    unresolvedBranchFromSceneRef: sceneBranch.unresolvedBranchFromSceneRef,
    title,
    location,
    timeOfDay,
    mood,
    narrativeGoal,
    activeCharacterIds: activeCharacterIds.length ? activeCharacterIds : undefined,
    unresolvedCharacterRefs: activeCharacterRefs.unresolved.length ? activeCharacterRefs.unresolved : undefined,
    narratorStyle,
    speakingOrder: speakingOrder.length ? speakingOrder : undefined,
    unresolvedSpeakingOrderRefs: speakingOrderRefs.unresolved.length ? speakingOrderRefs.unresolved : undefined,
    reason: sceneBranch.createNewScene
      ? 'Detected an explicit new-scene or branch summary in the Tavern turn. User confirmation is required before adding scene state.'
      : hasExplicitSceneSummary
      ? 'Detected an explicit scene-shaping summary in the Tavern turn. User confirmation is required before saving scene state.'
      : hasAmbientSceneShaping
      ? 'Detected atmosphere-first scene shaping in the Tavern turn. User confirmation is required before saving scene mood.'
      : 'Detected scene transition language. User confirmation is required before changing active scene state.',
    requiresUserConfirmation: true,
  }
}

function inferTavernSceneBranchMode(
  source: string,
  scene?: TavernScene,
  scenes: TavernScene[] = scene ? [scene] : []
): { createNewScene: boolean; branchFromSceneId?: string; unresolvedBranchFromSceneRef?: string } {
  const branchCue = extractTavernLabeledField(source, [
    'new scene',
    'create scene',
    'create new scene',
    'branch',
    'branch scene',
    'fork scene',
    '新场景',
    '新場景',
    '创建场景',
    '創建場景',
    '分支',
    '分支场景',
    '分支場景',
    '新しい場面',
    '新規場面',
    '分岐',
  ])
  const branchFrom = extractTavernLabeledField(source, [
    'branch from',
    'fork from',
    'from scene',
    'source scene',
    '源场景',
    '源場景',
    '来源场景',
    '來源場景',
    '分支自',
    '分岐元',
  ])
  const createNewScene = isTavernAffirmativeBranchCue(branchCue) || Boolean(branchFrom)
  const branchResolution = createNewScene && branchFrom
    ? resolveTavernSceneRefResolution(branchFrom, scenes)
    : { resolved: undefined, unresolved: undefined }
  return {
    createNewScene,
    branchFromSceneId: createNewScene ? branchResolution.resolved ?? (!branchFrom ? scene?.id : undefined) : undefined,
    unresolvedBranchFromSceneRef: createNewScene ? branchResolution.unresolved : undefined,
  }
}

function isTavernAffirmativeBranchCue(value?: string): boolean {
  if (!value) return false
  return !/^(?:no|false|0|update|replace|same|current|existing|reuse|否|不|不要|更新|当前|目前|既有|いいえ|既存|現在)$/i.test(value.trim())
}

function splitTavernSceneChangeBlocks(source: string): string[] {
  const lines = source.split(/\r?\n/)
  const blocks: string[] = []
  let current: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (isTavernSceneDraftBlockStart(trimmed)) {
      if (current.length && isTavernSceneTitleBlockStart(trimmed) && current.some((item) => isTavernSceneTitleBlockStart(item.trim()))) {
        blocks.push(current.join('\n'))
        current = [line]
      } else {
        current.push(line)
      }
      continue
    }
    if (!current.length) continue
    if (!trimmed) {
      blocks.push(current.join('\n'))
      current = []
      continue
    }
    if (isTavernNonSceneDraftBlockStart(trimmed)) {
      blocks.push(current.join('\n'))
      current = []
      continue
    }
    current.push(line)
  }
  if (current.length) blocks.push(current.join('\n'))
  return blocks
}

function isTavernSceneDraftBlockStart(line: string): boolean {
  return /^\s*(?:scene|scene\s+title|target\s+scene|update\s+scene|new\s+scene|branch\s+scene|场景|場景|目标场景|目標場景|目标場景|目標场景|更新场景|更新場景|新场景|新場景|分支场景|分支場景|場面|シーン|対象シーン|対象場面|新しい場面|新規場面)(?:\s*(?:[#№]?\s*[\d０-９一二三四五六七八九十]+|第\s*[\d０-９一二三四五六七八九十]+|[\d０-９一二三四五六七八九十]+\s*(?:幕|場|场|場面|シーン|番目)))?\s*[:：=]/i.test(line)
}

function isTavernSceneTitleBlockStart(line: string): boolean {
  return /^\s*(?:scene|scene\s+title|场景|場景|場面|シーン)(?:\s*(?:[#№]?\s*[\d０-９一二三四五六七八九十]+|第\s*[\d０-９一二三四五六七八九十]+|[\d０-９一二三四五六七八九十]+\s*(?:幕|場|场|場面|シーン|番目)))?\s*[:：=]/i.test(line)
}

function extractTavernSceneHeaderTitle(source: string): string | undefined {
  const match = /(?:^|[\n;；])\s*(?:scene|scene\s+title|场景|場景|場面|シーン)(?:\s*(?:[#№]?\s*[\d０-９一二三四五六七八九十]+|第\s*[\d０-９一二三四五六七八九十]+|[\d０-９一二三四五六七八九十]+\s*(?:幕|場|场|場面|シーン|番目)))\s*[:：=]\s*([^\n;；]+)/i.exec(source)
  return normalizeText(match?.[1], SHORT_TEXT_LIMIT)
}

function isTavernNonSceneDraftBlockStart(line: string): boolean {
  return /^(?:character|person|virtual person|virtual character|relationship\s+memory|memory|relationship\s+note|relationship\s+signal|relationship\s+role|relationship\s+dynamic|relationship\s+style|lore|lorebook|world info|world rule|background rule|background fact|canon|角色|人物|虚拟人物|虛擬人物|记忆|記憶|关系记忆|關係記憶|关系信号|關係信號|关系定位|關係定位|关系角色|關係角色|世界书|世界書|世界观|世界觀|世界规则|世界規則|背景规则|背景規則|背景事实|背景事實|正史|キャラクター|キャラ|仮想人物|メモ|関係の手がかり|関係性の役割|ロア|世界観|世界のルール|背景ルール|背景事実|正史設定)\s*[:：=]/i.test(line)
}

function hasSceneDraftCue(source: string): boolean {
  return /(?:scene|scene title|target scene|update scene|scene id|new scene|branch|branch from|location|place|setting|time|time of day|mood|atmosphere|cast|active characters|speaking order|narrator style|narrator|goal|scene goal)\s*[:：=]/i.test(source) ||
    /(?:场景|場景|目标场景|目標場景|目标場景|目標场景|更新场景|更新場景|场景ID|場景ID|场景标题|場景標題|新场景|新場景|分支|分支自|地点|地點|位置|时段|時段|时间|時間|氛围|氛圍|气氛|氣氛|在场角色|在場角色|登场角色|登場角色|发言顺序|發言順序|旁白|旁白风格|旁白風格|叙述风格|敘述風格|场景目标|場景目標)\s*[:：=]/.test(source) ||
    /(?:場面|シーン|対象シーン|対象場面|更新対象|シーンID|場面ID|新しい場面|新規場面|分岐|分岐元|場所|時間|雰囲気|登場人物|話す順番|ナレーター|語り口|目的|狙い)\s*[:：=]/.test(source)
}

function hasAmbientSceneShapingCue(value: string): boolean {
  return /\b(?:just a mood|mood only|atmosphere only|vibe only|no plot|no storyline|no full plot|comforting night|quiet night|cozy night|sensory anchor|emotional anchor)\b/i.test(value) ||
    /(?:只要.*(?:氛围|氛圍|感觉|感覺)|氛围感|氛圍感|不要剧情|不要劇情|无剧情|無劇情|没剧情|沒劇情|感官锚点|感官錨點|情绪锚点|情緒錨點|安静的夜|安靜的夜|舒服的夜)/.test(value) ||
    /(?:雰囲気だけ|空気感だけ|ムードだけ|筋書きなし|筋書きはいらない|物語なし|感覚のアンカー|感情のアンカー|静かな夜|落ち着く夜)/.test(value)
}

function inferAmbientSceneMood(source: string): string | undefined {
  const selected = splitTavernSentences(source).find(hasAmbientSceneShapingCue) ?? source
  const cleaned = normalizeText(selected, SHORT_TEXT_LIMIT)
    ?.replace(/^\s*(?:user|tavern)\s*[:：]\s*/i, '')
    .replace(/\b(?:keep this as|make it|let it be|just|only|as)\b/gi, '')
    .replace(/\b(?:a mood|mood only|atmosphere only|vibe only|no plot|no storyline|no full plot)\b/gi, '')
    .replace(/(?:只要|只先|先只|氛围|氛圍|氛围感|氛圍感|不要剧情|不要劇情|无剧情|無劇情|没剧情|沒劇情)/g, '')
    .replace(/(?:雰囲気だけ|空気感だけ|ムードだけ|筋書きなし|筋書きはいらない|物語なし)/g, '')
    .replace(/^[\s:：,，;；。.!?？]+|[\s:：,，;；。.!?？]+$/g, '')
  return cleaned || normalizeText(selected, SHORT_TEXT_LIMIT)
}

function resolveTavernCharacterRefResolution(
  value: string | undefined,
  characters: TavernCharacterCard[]
): { resolved: string[]; unresolved: string[] } {
  if (!value) return { resolved: [], unresolved: [] }
  const byComparableId = new Map<string, string>()
  const byComparableName = new Map<string, string[]>()
  for (const character of characters) {
    byComparableId.set(normalizeComparableText(character.id), character.id)
    const nameKey = normalizeComparableText(character.name)
    byComparableName.set(nameKey, [...(byComparableName.get(nameKey) ?? []), character.id])
  }
  const resolved: string[] = []
  const unresolved: string[] = []
  for (const item of splitTavernStructuredList(value.replace(/(?:->|→|＞|>)/g, ','))) {
    const parenthetical = /\(([^)]+)\)/.exec(item)?.[1]
    const bareName = item.replace(/\s*\([^)]*\)\s*$/, '')
    const candidates = [item, parenthetical, bareName]
      .map((candidate) => normalizeText(candidate, SHORT_TEXT_LIMIT))
      .filter(isString)
    let matched: string | undefined
    for (const candidate of candidates) {
      const key = normalizeComparableText(candidate)
      const resolvedById = byComparableId.get(key)
      const nameMatches = byComparableName.get(key) ?? []
      const resolved = resolvedById ?? (nameMatches.length === 1 ? nameMatches[0] : undefined)
      if (resolved) {
        matched = resolved
        break
      }
    }
    if (matched) {
      resolved.push(matched)
    } else {
      const unresolvedRef = normalizeText(bareName || item, SHORT_TEXT_LIMIT)
      if (unresolvedRef) unresolved.push(unresolvedRef)
    }
  }
  return {
    resolved: uniqueStrings(resolved),
    unresolved: uniqueStrings(unresolved),
  }
}

function selectSceneChangeCandidateText(source: string, destination?: string): string | undefined {
  const sentences = splitTavernSentences(source)
  const cueSentences = sentences.filter(hasSceneChangeCue)
  const selected = cueSentences.length ? cueSentences : sentences
  const text = normalizeText(selected.slice(0, 2).join(' '), 360)
  if (text) return text
  return destination ? `Scene transition: ${destination}` : undefined
}

function inferSceneChangeDestination(source: string): string | undefined {
  const patterns = [
    /(?:go|goes|went|head|heads|headed|walk|walks|walked|step|steps|stepped)\s+(?:to|into|toward|towards)\s+(?:the\s+)?([^.!?。！？,;]+)/i,
    /(?:enter|enters|entered)\s+(?:the\s+)?([^.!?。！？,;]+)/i,
    /(?:change scene|new scene|next scene|move(?:s|d)? to|arrive(?:s|d)? at|scene moves to|scene moved to)\s+(?:the\s+)?([^.!?。！？,;]+)/i,
    /(?:前往|走向|进入|走进)\s*([^。！？,，；]+)/,
    /(?:换到|来到|抵达|移到|场景(?:切到|换到|来到))\s*([^。！？,，；]+)/,
    /(?:シーン|場面|移動|到着)[^。！？,、；]*(?:へ|に|は)\s*([^。！？,、；]+)/,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(source)
    const destination = cleanSceneDestination(match?.[1])
    if (destination) return destination
  }
  return undefined
}

function cleanSceneDestination(value?: string): string | undefined {
  const cleaned = normalizeText(value, SHORT_TEXT_LIMIT)
    ?.replace(/^(?:the|a|an)\s+/i, '')
    .replace(/\s+(?:now|tonight|today|please)$/i, '')
    .replace(/[。！？.!?，,；;:：]+$/g, '')
    .trim()
  return cleaned || undefined
}

function resolveTavernExistingSceneId(snapshot: TavernSnapshot, sceneId?: string): string | undefined {
  if (!sceneId) return undefined
  return snapshot.scenes.some((scene) => scene.id === sceneId) ? sceneId : undefined
}

function extractTavernUnresolvedThreads(...values: (string | undefined)[]): string[] {
  const text = values.filter(Boolean).join(' ')
  if (!text) return []
  const questionMatches = text.match(/[^.!?。！？]*[?？][^.!?。！？]*/g) ?? []
  return uniqueStrings(questionMatches.map((item) => normalizeText(item, SHORT_TEXT_LIMIT)).filter(isString)).slice(0, 4)
}

function extractTavernPromises(...values: (string | undefined)[]): string[] {
  const text = values.filter(Boolean).join(' ')
  if (!text) return []
  const patterns = [
    /(?:promise|promised|will remember|ask before)[^.!?。！？]*/gi,
    /(?:承诺|会记住|先询问|先确认)[^。！？.!?]*/g,
    /(?:約束|覚えて|先に確認)[^。！？.!?]*/g,
  ]
  return uniqueStrings(patterns.flatMap((pattern) => text.match(pattern) ?? []).map((item) => normalizeText(item, SHORT_TEXT_LIMIT)).filter(isString)).slice(0, 4)
}

function extractTavernImportantChanges(...values: (string | undefined)[]): string[] {
  const text = values.filter(Boolean).join(' ')
  if (!text) return []
  const patterns = [
    /(?:now|became|changed|decided|revealed)[^.!?。！？]*/gi,
    /(?:现在|变成|决定|透露|发现)[^。！？.!?]*/g,
    /(?:今は|変わった|決めた|明かした|見つけた)[^。！？.!?]*/g,
  ]
  return uniqueStrings(patterns.flatMap((pattern) => text.match(pattern) ?? []).map((item) => normalizeText(item, SHORT_TEXT_LIMIT)).filter(isString)).slice(0, 4)
}

function splitTavernSentences(value: string): string[] {
  return (value.match(/[^.!?。！？]+[.!?。！？]?/g) ?? [value])
    .map((item) => normalizeText(item, SHORT_TEXT_LIMIT))
    .filter(isString)
}

function hasRelationshipMemoryCue(value: string): boolean {
  return /remember|prefer|trust|boundary|promise|relationship|affinity|just listen|listen first|listen to me|no advice|no fixing|don't fix|do not fix|don't solve|do not solve|slow down|low pressure|less intense|not too intense|one question at a time|fewer questions|too many questions|don't ask too many|do not ask too many|don't interrogate|do not interrogate|don't speak for me|do not speak for me|don't speak for the user|do not speak for the user|don't control me|do not control me|don't control my actions|do not control my actions|don't narrate my actions|do not narrate my actions|don't roleplay me|do not roleplay me|call me|address me as|preferred name|preferred nickname|use my name|no clich[eé]s?|no platitudes?|no lectures?|don't lecture|do not lecture|not preachy|toxic positivity|记住|偏好|信任|边界|承诺|关系|倾听|傾聽|听我说|聽我說|听着就好|聽著就好|先听|先聽|不要建议|不要建議|别建议|別建議|不要解决|不要解決|慢一点|慢一點|慢慢来|慢慢來|低压力|低壓力|少问|少問|别问太多|別問太多|不要问太多|不要問太多|一次一个问题|一次一個問題|一步一步|别追问|別追問|不要追问|不要追問|别审问|別審問|不要替我|不要替用户|不要替用戶|别替我|別替我|不要代替我|别代替我|不要控制我|别控制我|不要描写我|不要描寫我|别描写我|別描寫我|不要替我说话|不要替我說話|别替我说话|別替我說話|叫我|称呼我|稱呼我|喊我|可以叫|昵称是|暱稱是|不要鸡汤|不要雞湯|不要套话|不要套話|别套话|別套話|别说教|別說教|覚えて|好み|信頼|境界|約束|関係|聞いて|聞くだけ|まず聞|アドバイスしない|助言しない|解決しない|直そうとしない|ゆっくり|急がない|一つずつ|一問ずつ|質問しすぎない|聞きすぎない|詰問しない|勝手に決めない|勝手に動かさない|代弁しない|ユーザーの行動を描写しない|行動を描写しない|心情を決めない|呼んで|呼んでほしい|名前で呼んで|ニックネーム|押し付けない|説教しない|きれいごと|きれい事|綺麗事/i.test(value) ||
    hasRelationshipRoleCue(value) ||
    hasRelationshipRoutineCue(value) ||
    hasNonRomanticRelationshipBoundaryCue(value) ||
    hasRelationshipPacingBoundaryCue(value)
}

function hasSceneChangeCue(value: string): boolean {
  return /change scene|new scene|next scene|move to|arrive at|\b(?:go|head|walk|step)\s+(?:to|into|toward|towards)\b|enter(?:s|ed)?\s+the\b|场景|换到|来到|抵达|前往|走向|进入|走进|シーン|場面|移動|到着|向かう|入る/i.test(value)
}

function inferRelationshipMemoryKind(value: string): TavernRelationshipMemoryKind {
  if (hasPreferredAddressCue(value)) return 'preference'
  if (hasNonRomanticRelationshipBoundaryCue(value)) return 'boundary'
  if (hasRelationshipPacingBoundaryCue(value)) return 'boundary'
  if (hasRelationshipRoleCue(value)) return 'preference'
  if (/boundary|limit|consent|personal space|pet name|nickname|too intimate|do not|don't|should not|no pet names?|no advice|no fixing|too many questions|don't ask too many|do not ask too many|don't interrogate|do not interrogate|don't speak for me|do not speak for me|don't speak for the user|do not speak for the user|don't control me|do not control me|don't control my actions|do not control my actions|don't narrate my actions|do not narrate my actions|don't roleplay me|do not roleplay me|no clich[eé]s?|no platitudes?|no lectures?|don't lecture|do not lecture|not preachy|toxic positivity|do not call|don't call|without consent|不要|别|別|不应|不應|边界|邊界|称呼|稱呼|昵称|暱稱|距离感|距離感|越界|宝贝|寶貝|亲爱的|親愛的|同意|不要建议|不要建議|别建议|別建議|不要解决|不要解決|别问太多|別問太多|不要问太多|不要問太多|别追问|別追問|不要追问|不要追問|别审问|別審問|不要审问|不要審問|不要替我|不要替用户|不要替用戶|别替我|別替我|不要代替我|别代替我|不要控制我|别控制我|不要描写我|不要描寫我|别描写我|別描寫我|不要替我说话|不要替我說話|别替我说话|別替我說話|不要鸡汤|不要雞湯|不要套话|不要套話|别套话|別套話|别说教|別說教|不要大道理|境界|しないで|しない|呼び方|呼ばない|呼び捨て|あだ名|愛称|触れない|触らない|許可|先に聞|アドバイスしない|助言しない|解決しない|直そうとしない|質問しすぎない|聞きすぎない|詰問しない|勝手に決めない|勝手に動かさない|代弁しない|ユーザーの行動を描写しない|行動を描写しない|心情を決めない|押し付けない|説教しない|きれいごと|きれい事|綺麗事/i.test(value)) return 'boundary'
  if (hasRelationshipRoutineCue(value)) return 'preference'
  if (/prefer|like|favorite|just listen|listen first|listen to me|slow down|low pressure|less intense|one question at a time|fewer questions|call me|address me as|preferred name|preferred nickname|use my name|偏好|喜欢|喜歡|倾听|傾聽|听我说|聽我說|听着就好|聽著就好|先听|先聽|慢一点|慢一點|慢慢来|慢慢來|低压力|低壓力|少问|少問|一次一个问题|一次一個問題|一步一步|叫我|称呼我|稱呼我|喊我|可以叫|昵称是|暱稱是|好み|好き|聞いて|聞くだけ|まず聞|ゆっくり|急がない|一つずつ|一問ずつ|呼んで|呼んでほしい|名前で呼んで|ニックネーム/i.test(value)) return 'preference'
  if (/trust|信任|信頼/i.test(value)) return 'trust'
  if (/affinity|closer|亲近|好感|親し/i.test(value)) return 'affinity'
  return 'event'
}

function hasPreferredAddressCue(value: string): boolean {
  return /(?:\b(?:call me|address me as|preferred name|preferred nickname|use my name|you can call me)\b|叫我|称呼我|稱呼我|喊我|可以叫|昵称是|暱稱是|呼んで|呼んでほしい|名前で呼んで|ニックネーム)/i.test(value) &&
    !/(?:do not call|don't call|should not call|no pet names?|don't use|do not use|不要叫|别叫|別叫|不要称呼|不要稱呼|不要用|別用|别用|呼ばない|呼び捨てしない|呼ばないで|使わない)/i.test(value)
}

function hasNonRomanticRelationshipBoundaryCue(value: string): boolean {
  return /\b(?:platonic|non[- ]?romantic|no romance|not romantic|no flirting|no flirt|no seduction|keep it sfw|keep it friendly|nonsexual|no sexual content)\b/i.test(value) ||
    /(?:不要恋爱|不要戀愛|非恋爱|非戀愛|柏拉图|柏拉圖|别暧昧|別曖昧|不暧昧|不曖昧|别调情|別調情|不调情|不調情|保持友好|不要性化|不要色情|不要成人内容|不要成人內容)/.test(value) ||
    /(?:プラトニック|恋愛なし|非恋愛|恋愛ではない|口説かない|誘惑しない|友好的|性的にしない|成人向けにしない)/.test(value)
}

function hasRelationshipPacingBoundaryCue(value: string): boolean {
  return /\b(?:give me space|not clingy|don't be clingy|do not be clingy|don't pressure me|do not pressure me|let me lead|let the user lead)\b/i.test(value) ||
    /(?:给我空间|給我空間|不要黏人|不要粘人|别黏人|別黏人|别粘人|不要催我|别催我|別催我|让我主导|讓我主導|让我来|讓我來)/.test(value) ||
    /(?:距離を置いて|距離を置く|べったりしない|急かさない|急かさないで|主導させて)/.test(value)
}

function hasRelationshipRoutineCue(value: string): boolean {
  return /\b(?:(?:goodnight|good night|good morning|morning|nightly|bedtime|sleep|before bed|before sleep|wake[- ]?up)\s+(?:check[- ]?in|ritual|routine|greeting)|(?:daily|nightly|morning)\s+check[- ]?in|every (?:morning|night|evening)|before (?:sleep|bed))\b/i.test(value) ||
    /(?:睡前陪我|睡前(?:问候|問候|安抚|安撫|陪|聊)|晚安(?:仪式|儀式|问候|問候|例行)|早安(?:问候|問候|打卡)|每天.*(?:问候|問候|晚安|早安|陪)|每日.*(?:问候|問候|晚安|早安)|早上.*(?:问候|問候|叫醒)|晚上.*(?:问候|問候|陪))/.test(value) ||
    /(?:寝る前.*(?:声かけ|一緒|寄り添|話|挨拶)|おやすみ(?:の)?(?:声かけ|挨拶|ルーティン)|おはよう(?:の)?(?:声かけ|挨拶)|朝の声かけ|毎朝.*(?:声かけ|挨拶)|毎晩.*(?:声かけ|挨拶)|就寝前.*(?:声かけ|挨拶))/.test(value)
}

function hasRelationshipRoleCue(value: string): boolean {
  return /\b(?:friend-like|best friend|trusted friend|friendship|mentor|guide|coach|sibling|older sister|older brother|roommate|teammate|partner in crime|rivalry|rival)\b/i.test(value) ||
    /(?:朋友感|朋友|好友|好朋友|知己|导师|導師|引导者|引導者|姐姐感|哥哥感|姐姐|哥哥|兄妹|室友|对手|對手|搭档|搭檔|队友|隊友|前辈|前輩|关系定位|關係定位)/.test(value) ||
    /(?:友達|親友|相棒|仲間|先輩|メンター|ガイド|姉|兄|きょうだい|ルームメイト|ライバル|関係性の役割)/.test(value)
}

function inferRelationshipMemoryVisibility(value: string, kind: TavernRelationshipMemoryKind): boolean {
  if (kind === 'boundary') return false
  return !/private|secret|sensitive|hidden|local only|do not share|don't share|私密|秘密|敏感|隐藏|本地|不要分享|非公開|共有しない/i.test(value)
}

function inferRelationshipMemoryConfidence(value: string, kind: TavernRelationshipMemoryKind): number {
  const explicitCueBoost = hasRelationshipMemoryCue(value) ? 0.08 : 0
  const kindBase = kind === 'boundary'
    ? 0.82
    : kind === 'preference' || kind === 'trust'
    ? 0.76
    : kind === 'affinity'
    ? 0.7
    : 0.62
  return clampNumber(kindBase + explicitCueBoost, 0, 1, kindBase)
}

function inferRelationshipMemoryRetentionClass(value: string, kind: TavernRelationshipMemoryKind): TavernRelationshipMemoryRetentionClass {
  if (kind === 'boundary') return 'boundary'
  if (/temporary|for now|this scene|tonight|本轮|暂时|この場面|今夜/i.test(value)) return 'session'
  if (kind === 'preference' || kind === 'trust' || kind === 'affinity') return 'long-term'
  return /remember|will remember|记住|覚えて/i.test(value) ? 'long-term' : 'session'
}
function normalizeComparableText(value: string): string {
  return value.toLowerCase().replace(/[_/\\|.,;:!?()[\]{}<>+=*&^%$#@~，。！？；：（）【】《》、]/g, ' ').replace(/\s+/g, ' ').trim()
}

function tokenizeComparableText(value: string): Set<string> {
  const normalized = normalizeComparableText(value)
  const rawTokens = normalized.match(/[a-z0-9]{2,}|[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]{2,}/g) ?? []
  const stopWords = new Set(['that', 'this', 'with', 'when', 'they', 'them', 'user', 'aria', 'please', 'remember', 'notes', 'memory', 'relationship'])
  return new Set(rawTokens.filter((token) => !stopWords.has(token)).slice(0, 80))
}

function tokenOverlapRatio(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0
  let overlap = 0
  for (const token of left) {
    if (right.has(token)) overlap += 1
  }
  return overlap / Math.min(left.size, right.size)
}

function hasRelationshipMemoryConflictCue(value: string): boolean {
  return /no longer|instead|changed my mind|rather than|not anymore|don't want|do not want|不要再|改成|不再|不是|やめて|ではなく|もう.*ない/i.test(value)
}

function hasContrastingRelationshipMemoryTokens(left: Set<string>, right: Set<string>): boolean {
  const pairs: [string, string][] = [
    ['slow', 'fast'],
    ['slower', 'faster'],
    ['share', 'private'],
    ['share', 'hidden'],
    ['share', 'secret'],
    ['open', 'closed'],
    ['open', 'avoid'],
    ['trust', 'distrust'],
    ['like', 'dislike'],
    ['慢', '快'],
    ['分享', '私密'],
    ['分享', '隐藏'],
    ['打开', '不要打开'],
    ['信任', '不信任'],
    ['遅い', '速い'],
    ['共有', '非公開'],
    ['開ける', '開けない'],
  ]
  return pairs.some(([a, b]) => (left.has(a) && right.has(b)) || (left.has(b) && right.has(a)))
}

function normalizeText(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, limit) : undefined
}
function normalizeId(value: unknown): string | undefined {
  const text = normalizeText(value, 120)
  if (!text || /[\u0000-\u001F]/.test(text)) return undefined
  return text
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Number(Math.max(min, Math.min(max, value)).toFixed(3))
    : fallback
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function uniqueByComparable<T>(values: T[], getKey: (value: T) => string): T[] {
  const seen = new Set<string>()
  const items: T[] = []
  for (const value of values) {
    const key = getKey(value)
    if (!key || seen.has(key)) continue
    seen.add(key)
    items.push(value)
  }
  return items
}
function generateTavernId(prefix: string, value: string, now: number): string {
  return `tavern-${prefix}-${Math.abs(hashString(`${value}:${now}`)).toString(36)}`
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash | 0
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isString(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0
}
