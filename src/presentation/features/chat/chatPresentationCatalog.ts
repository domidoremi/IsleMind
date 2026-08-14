import type { ConversationChatWorkflowRuntimeRequestedOutput } from '@/modules/tasks'

export type { ConversationChatWorkflowRuntimeRequestedOutput } from '@/modules/tasks'

export type ChatPresentationGlyph =
  | 'attachment'
  | 'edit'
  | 'message'
  | 'refresh'
  | 'search-check'

export interface ChatStarterDefinition {
  id: string
  titleKey: string
  descriptionKey: string
  promptKey: string
  glyph: ChatPresentationGlyph
}

export interface ChatCueDefinition {
  id: string
  labelKey: string
  glyph: ChatPresentationGlyph
}

export interface ChatBoundaryDefinition {
  id: string
  titleKey: string
  descriptionKey: string
  handoffKey: string
  glyph: ChatPresentationGlyph
}

export interface ChatMemoryDefinition {
  id: string
  scope: 'conversation-local'
  titleKey: string
  summaryKey: string
  visibilityKey: string
  glyph: ChatPresentationGlyph
}

export interface ChatPresentationCatalog {
  id: 'chat'
  labelKey: string
  setupDescriptionKey: string
  emptyTitleKey: string
  emptyDescriptionKey: string
  composerPlaceholderKey: string
  systemPromptPlaceholderKey: string
  requestedOutput: ConversationChatWorkflowRuntimeRequestedOutput
  outputModeLocked: false
  showOutputControl: true
  showReasoningControl: true
  boundary: ChatBoundaryDefinition
  memory: ChatMemoryDefinition
  cues: readonly ChatCueDefinition[]
  starters: readonly ChatStarterDefinition[]
}

export const CHAT_PRESENTATION_CATALOG = {
  id: 'chat',
  labelKey: 'common.chat',
  setupDescriptionKey: 'chatPresentation.setupDescription',
  emptyTitleKey: 'chatPresentation.emptyTitle',
  emptyDescriptionKey: 'chatPresentation.emptyDescription',
  composerPlaceholderKey: 'chatPresentation.composerPlaceholder',
  systemPromptPlaceholderKey: 'chatPresentation.systemPromptPlaceholder',
  requestedOutput: 'auto',
  outputModeLocked: false,
  showOutputControl: true,
  showReasoningControl: true,
  boundary: {
    id: 'conversation-scope',
    titleKey: 'chatPresentation.boundary.title',
    descriptionKey: 'chatPresentation.boundary.description',
    handoffKey: 'chatPresentation.boundary.handoff',
    glyph: 'message',
  },
  memory: {
    id: 'thread-local',
    scope: 'conversation-local',
    titleKey: 'chatPresentation.memory.title',
    summaryKey: 'chatPresentation.memory.summary',
    visibilityKey: 'chatPresentation.memory.visibility',
    glyph: 'message',
  },
  cues: [
    {
      id: 'ask',
      labelKey: 'chatPresentation.cues.ask',
      glyph: 'message',
    },
    {
      id: 'context',
      labelKey: 'chatPresentation.cues.context',
      glyph: 'attachment',
    },
    {
      id: 'refine',
      labelKey: 'chatPresentation.cues.refine',
      glyph: 'refresh',
    },
  ],
  starters: [
    {
      id: 'ask',
      titleKey: 'chatPresentation.starters.ask.title',
      descriptionKey: 'chatPresentation.starters.ask.description',
      promptKey: 'chatPresentation.starters.ask.prompt',
      glyph: 'message',
    },
    {
      id: 'analyze',
      titleKey: 'chatPresentation.starters.analyze.title',
      descriptionKey: 'chatPresentation.starters.analyze.description',
      promptKey: 'chatPresentation.starters.analyze.prompt',
      glyph: 'search-check',
    },
    {
      id: 'draft',
      titleKey: 'chatPresentation.starters.draft.title',
      descriptionKey: 'chatPresentation.starters.draft.description',
      promptKey: 'chatPresentation.starters.draft.prompt',
      glyph: 'edit',
    },
  ],
} as const satisfies ChatPresentationCatalog
