import type { ChatMultimodalPolicy } from './chatMultimodalPolicy'

export type ChatBoundaryStatusAction = 'provider' | 'memory' | 'tools' | 'notice'
export type ChatBoundaryStatusActionGlyph = 'provider-key' | 'memory-brain' | 'tools' | 'info'

export interface ChatBoundaryStatusActionMetadata {
  action: ChatBoundaryStatusAction
  labelKey: string
  glyph: ChatBoundaryStatusActionGlyph
  requiresConfirmation: boolean
}

const CHAT_BOUNDARY_STATUS_ACTION_METADATA = {
  provider: {
    action: 'provider',
    labelKey: 'chatPresentation.boundaryStatusProviderAction',
    glyph: 'provider-key',
    requiresConfirmation: true,
  },
  memory: {
    action: 'memory',
    labelKey: 'chatPresentation.boundaryStatusMemoryAction',
    glyph: 'memory-brain',
    requiresConfirmation: true,
  },
  tools: {
    action: 'tools',
    labelKey: 'chatPresentation.boundaryStatusToolsAction',
    glyph: 'tools',
    requiresConfirmation: true,
  },
  notice: {
    action: 'notice',
    labelKey: 'chatPresentation.boundaryStatusDetailsAction',
    glyph: 'info',
    requiresConfirmation: false,
  },
} as const satisfies Record<ChatBoundaryStatusAction, ChatBoundaryStatusActionMetadata>

export interface ResolveChatBoundaryStatusActionInput {
  multimodalPolicy?: ChatMultimodalPolicy | null
  pendingMemoryCount?: number
  canInspectProvider?: boolean
  canOpenMemory?: boolean
  canOpenTools?: boolean
}

export function resolveChatBoundaryStatusAction(input: ResolveChatBoundaryStatusActionInput): ChatBoundaryStatusAction {
  const policy = input.multimodalPolicy ?? null
  const providerFixableMediaGap = !!policy && Object.values(policy.entries).some((entry) => !entry.available)
  if (input.canInspectProvider && providerFixableMediaGap) return 'provider'

  const pendingMemoryCount = Math.max(0, Math.round(input.pendingMemoryCount ?? 0))
  if (input.canOpenMemory && pendingMemoryCount > 0) return 'memory'

  const mediaStatusNeedsInspection = !!policy && (policy.unavailableCount > 0 || policy.generationUnavailableCount > 0)
  if (input.canOpenTools && mediaStatusNeedsInspection) return 'tools'

  return 'notice'
}

export function getChatBoundaryStatusActionMetadata(action: ChatBoundaryStatusAction): ChatBoundaryStatusActionMetadata {
  return CHAT_BOUNDARY_STATUS_ACTION_METADATA[action]
}
