/** Stable Tavern domain and interchange contracts; deliberately persistence-free. */
export const TAVERN_SNAPSHOT_SCHEMA = 'islemind.tavern-snapshot.v1'
export const TAVERN_SCOPE_INDEX_SCHEMA = 'islemind.tavern-scope-index.v1'
export const TAVERN_TURN_WRITEBACK_SCHEMA = 'islemind.tavern-turn-writeback.v1'
export const TAVERN_ACTIVE_SCOPE_LINKS_SCHEMA = 'islemind.tavern-active-scopes.v1'
export const TAVERN_CHARACTER_CARD_V2_SPEC = 'chara_card_v2'
export const TAVERN_CHARACTER_CARD_V2_VERSION = '2.0'
export const TAVERN_REVIEW_READY_LABEL_INSTRUCTION = 'Review-ready summaries: when proposing lasting Tavern character, scene, lore, or relationship changes, use parseable labels in the conversation language or English. Accepted examples include Character/角色/人物/キャラクター, numbered Character 1/Character 2, 角色 1/角色 2, or キャラクター1/キャラクター2 blocks for multiple virtual people, Target character/目标角色/目標角色/対象キャラクター when updating an existing virtual person, Persona/人设/性格/性格設定/人設, Voice/语气/口吻/話し方/語氣, Emotional tone/情绪基调/感情のトーン/情緒基調, Phrases/措辞/言葉選び/措辭, Example line/例句/セリフ例 for stable voice samples, Boundaries/边界/境界/邊界, Avoid traits/避免性格/避けたい性格, Avoid identity/避免身份/避けたい立場, Opening/开场白/冒頭/開場白, Scene/场景/場景/場面, Target scene/目标场景/目標場景/対象シーン when updating an existing scene, New scene/新场景/新場景/新しい場面, Branch from/分支自/分岐元, Location/地点/地點/場所, Mood/氛围/氛圍/雰囲気, Characters/在场角色/在場角色/登場人物, Speaking order/发言顺序/發言順序/話す順番, Narrator/旁白/ナレーター, Goal/目标/目標/目的, Lore/世界书/世界書/ロア, Target lore/目标世界书/目標世界書/対象ロア when updating existing lore, World rule/世界规则/世界規則/世界のルール, Canon/正史/正史設定, Background fact/背景事实/背景事實/背景事実, Keywords/关键词/關鍵詞/キーワード, and Relationship signal/关系信号/關係信號/関係の手がかり or Relationship role/关系定位/關係定位/関係性の役割 with Character/角色/人物/キャラクター or Target character/目标角色/目標角色/対象キャラクター, Kind/类型/類型/種別, Content/内容/內容, Visibility/可见性/可見性/公開範囲, and Retention/保留/留存/保持.'

export type TavernRelationshipMemoryKind = 'affinity' | 'trust' | 'event' | 'preference' | 'boundary'
export type TavernRelationshipMemoryRetentionClass = 'session' | 'long-term' | 'boundary'
export type TavernRelationshipMemoryReviewStatus = 'new' | 'duplicate' | 'conflict'
export type TavernCharacterStabilityAnchor = 'persona' | 'voice' | 'emotionalTone' | 'phrasing' | 'boundaries' | 'opening'

export interface TavernCharacterCard {
  id: string
  name: string
  avatarUri?: string
  persona: string
  speechStyle: string
  background: string
  openingMessage?: string
  constraints: string[]
  tags: string[]
  createdAt: number
  updatedAt: number
}

export interface TavernLorebookEntry {
  id: string
  title: string
  content: string
  keywords: string[]
  priority: number
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export interface TavernRelationshipMemory {
  id: string
  characterId: string
  kind: TavernRelationshipMemoryKind
  content: string
  weight: number
  userVisible: boolean
  createdAt: number
  updatedAt: number
}

export interface TavernScene {
  id: string
  title: string
  location: string
  branchFromSceneId?: string
  timeOfDay?: string
  mood?: string
  narrativeGoal?: string
  activeCharacterIds: string[]
  narratorStyle?: string
  speakingOrder: string[]
  createdAt: number
  updatedAt: number
}

export interface TavernNarrativeSummary {
  id: string
  sceneId?: string
  chapterTitle?: string
  summary: string
  unresolvedThreads: string[]
  promises: string[]
  importantChanges: string[]
  createdAt: number
  updatedAt: number
}

export interface TavernSnapshot {
  schema: typeof TAVERN_SNAPSHOT_SCHEMA
  characters: TavernCharacterCard[]
  lorebook: TavernLorebookEntry[]
  relationshipMemories: TavernRelationshipMemory[]
  scenes: TavernScene[]
  narrativeSummaries: TavernNarrativeSummary[]
  pendingWritebacks: TavernPendingWriteback[]
  updatedAt: number
}

export interface TavernCharacterStabilityDiagnostic {
  characterId: string
  name: string
  presentAnchors: TavernCharacterStabilityAnchor[]
  missingAnchors: TavernCharacterStabilityAnchor[]
  score: number
}

export interface TavernRelationshipStateDiagnostic {
  characterId: string
  name: string
  confirmedMemoryCount: number
  visibleMemoryCount: number
  privateMemoryCount: number
  pendingMemoryCount: number
  pendingPrivateMemoryCount: number
  memoryKinds: TavernRelationshipMemoryKind[]
}

export interface TavernRelationshipStateReport {
  characterCount: number
  relatedCharacterCount: number
  pendingCharacterCount: number
  confirmedMemoryCount: number
  pendingMemoryCount: number
  privateMemoryCount: number
  pendingPrivateMemoryCount: number
  diagnostics: TavernRelationshipStateDiagnostic[]
}

export interface TavernContextPack {
  mode: 'companion'
  isolated: true
  shareWithChat: false
  shareWithAgent: false
  scopeId?: string
  scene?: TavernScene
  characters: TavernCharacterCard[]
  lorebook: TavernLorebookEntry[]
  relationshipMemories: TavernRelationshipMemory[]
  narrativeSummaries: TavernNarrativeSummary[]
  promptSections: string[]
  evidence: string[]
}

export interface TavernRelationshipMemoryCandidate {
  id: string
  characterId?: string
  unresolvedCharacterRef?: string
  kind: TavernRelationshipMemoryKind
  content: string
  suggestedUserVisible: boolean
  confidence: number
  retentionClass: TavernRelationshipMemoryRetentionClass
  reviewStatus: TavernRelationshipMemoryReviewStatus
  relatedMemoryId?: string
  reason: string
  requiresUserConfirmation: true
}

export interface TavernSceneChangeProposal {
  sceneId?: string
  unresolvedSceneRef?: string
  createNewScene?: boolean
  branchFromSceneId?: string
  unresolvedBranchFromSceneRef?: string
  title?: string
  location?: string
  timeOfDay?: string
  mood?: string
  narrativeGoal?: string
  activeCharacterIds?: string[]
  unresolvedCharacterRefs?: string[]
  narratorStyle?: string
  speakingOrder?: string[]
  unresolvedSpeakingOrderRefs?: string[]
  reason: string
  requiresUserConfirmation: true
}

export interface TavernCharacterDraftProposal {
  id: string
  characterId?: string
  name: string
  persona?: string
  speechStyle?: string
  background?: string
  openingMessage?: string
  constraints: string[]
  tags: string[]
  reason: string
  requiresUserConfirmation: true
}

export interface TavernLorebookDraftProposal {
  id: string
  loreId?: string
  title: string
  content: string
  keywords: string[]
  priority?: number
  enabled?: boolean
  reason: string
  requiresUserConfirmation: true
}

export interface TavernTurnWritebackSummaryDraft {
  id: string
  sceneId?: string
  chapterTitle?: string
  summary: string
  unresolvedThreads: string[]
  promises: string[]
  importantChanges: string[]
}

export interface TavernTurnWritebackProposal {
  schema: typeof TAVERN_TURN_WRITEBACK_SCHEMA
  mode: 'companion'
  isolated: true
  summaryDraft?: TavernTurnWritebackSummaryDraft
  characterDraftProposal?: TavernCharacterDraftProposal
  additionalCharacterDraftProposals?: TavernCharacterDraftProposal[]
  lorebookDraftProposal?: TavernLorebookDraftProposal
  additionalLorebookDraftProposals?: TavernLorebookDraftProposal[]
  relationshipMemoryCandidates: TavernRelationshipMemoryCandidate[]
  sceneChangeProposal?: TavernSceneChangeProposal
  additionalSceneChangeProposals?: TavernSceneChangeProposal[]
  characterDraftRequiresUserConfirmation: true
  lorebookDraftRequiresUserConfirmation: true
  relationshipMemoryRequiresUserConfirmation: true
  sceneChangeRequiresUserConfirmation: true
  evidence: string[]
}

export interface TavernPendingWriteback {
  id: string
  sourceAssistantMessageId?: string
  summaryDraft?: TavernTurnWritebackSummaryDraft
  characterDraftProposal?: TavernCharacterDraftProposal
  lorebookDraftProposal?: TavernLorebookDraftProposal
  relationshipMemoryCandidates: TavernRelationshipMemoryCandidate[]
  sceneChangeProposal?: TavernSceneChangeProposal
  evidence: string[]
  createdAt: number
  updatedAt: number
}

export interface TavernTurnWritebackOptions extends TavernContextOptions {
  userInput?: string
  assistantOutput?: string
  assistantMessageId?: string
}

export interface TavernTurnWritebackApplyOptions {
  commitSummary?: boolean
  commitCharacterDraft?: boolean
  commitLorebookDraft?: boolean
  commitRelationshipMemoryCandidateIds?: string[]
  commitSceneChange?: boolean
  storePendingProposals?: boolean
}

export interface TavernTurnWritebackApplyResult {
  snapshot: TavernSnapshot
  committedSummary: boolean
  pendingSummaryDraft: boolean
  committedCharacterDraft: boolean
  pendingCharacterDraft: boolean
  committedLorebookDraft: boolean
  pendingLorebookDraft: boolean
  pendingLorebookDraftCount: number
  committedRelationshipMemoryIds: string[]
  pendingRelationshipMemoryCandidateIds: string[]
  committedSceneChange: boolean
  pendingSceneChange: boolean
  pendingSceneChangeCount: number
  pendingWritebackStored: boolean
  evidence: string[]
}

export interface TavernContextOptions {
  query?: string
  scopeId?: string
  sceneId?: string
  characterIds?: string[]
  includeHiddenMemory?: boolean
  loreLimit?: number
  memoryLimit?: number
  summaryLimit?: number
}

export interface TavernExportOptions {
  includeHiddenMemory?: boolean
  includePendingWritebacks?: boolean
}

export interface TavernScopedExportOptions extends TavernExportOptions {
  includeEmptyScopeIds?: readonly string[]
}

export interface TavernExportAudit {
  includeHiddenMemory: boolean
  includePendingWritebacks: boolean
  hiddenRelationshipMemoryOmitted: number
  hiddenPendingRelationshipMemoryCandidateOmitted: number
  pendingWritebackOmitted: number
  pendingSummaryDraftOmitted: number
  pendingCharacterDraftOmitted: number
  pendingLorebookDraftOmitted: number
  pendingRelationshipMemoryCandidateOmitted: number
  pendingSceneChangeOmitted: number
}

export interface TavernScopedExportEntry {
  scopeId: string
  snapshot: TavernSnapshot
  exportAudit: TavernExportAudit
}

export interface TavernActiveScopeLinksExportOptions {
  conversationIds?: readonly string[]
  scopeIds?: readonly string[]
}

export interface TavernScopeDuplicateResult {
  scopeId: string
  snapshot: TavernSnapshot
  duplicateAudit: {
    includePendingWritebacks: boolean
    pendingWritebackOmitted: number
    pendingSummaryDraftOmitted: number
    pendingCharacterDraftOmitted: number
    pendingLorebookDraftOmitted: number
    pendingRelationshipMemoryCandidateOmitted: number
    pendingPrivateRelationshipMemoryCandidateOmitted: number
    pendingPrivateRelationshipMemoryCandidateIncluded: number
    pendingSceneChangeOmitted: number
  }
}

export interface TavernScopeDuplicateOptions {
  includePendingWritebacks?: boolean
  sourceSnapshot?: Partial<TavernSnapshot>
}

export interface TavernCharacterCardV2Export {
  spec: typeof TAVERN_CHARACTER_CARD_V2_SPEC
  spec_version: typeof TAVERN_CHARACTER_CARD_V2_VERSION
  data: {
    name: string
    description: string
    personality: string
    scenario: string
    first_mes: string
    mes_example: string
    creator_notes: string
    system_prompt: string
    post_history_instructions: string
    alternate_greetings: string[]
    tags: string[]
    creator: string
    character_version: string
    extensions: Record<string, unknown>
  }
}

export interface TavernLorebookWorldInfoEntryExport {
  uid: number
  key: string[]
  keysecondary: string[]
  comment: string
  content: string
  constant: boolean
  selective: boolean
  order: number
  disable: boolean
  extensions: Record<string, unknown>
}

export interface TavernLorebookWorldInfoExport {
  entries: Record<string, TavernLorebookWorldInfoEntryExport>
  extensions: Record<string, unknown>
}
