import type { FlashListRef } from '@shopify/flash-list'
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react'
import type { EdgeInsets } from 'react-native-safe-area-context'

import type { useIsleDialog, IsleBackgroundState } from '@/components/ui/isle'
import type { ComposerCommand } from '@/components/chat/Composer'
import type { useAppTheme } from '@/hooks/useAppTheme'
import type { useMotionPreference } from '@/hooks/useMotionPreference'
import type { ConversationChatWorkflowRuntimeRequestedOutput } from '@/modules/tasks'
import type { ConversationMetrics } from '@/modules/conversations'
import type { useSettingsStore } from '@/store/settingsStore'
import type { Attachment, CommandReference, Conversation, Message } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { ChatMultimodalPolicy } from '@/presentation/features/chat/chatMultimodalPolicy'

import type { RuntimeRepairIntent } from './RuntimeRepairIntentCard'
import type { ChatBoundaryMemoryStatus } from './ChatEmptyState'
import type { ComposerPanel } from './FloatingComposer'
import type { IntentDraft, PendingStreamingMessage } from './chatStreamingIntentActions'
import type { ModelAccessSettings } from './chatModelSelection'
import type { ConversationHealth } from './conversationHealth'
import type { CompressionSummary } from './compressionSummary'

export interface ChatActiveWorkspaceProps {
  conversation: Conversation
  provider: AIProvider | undefined
  providerHealth: ConversationHealth | null
  latestCompression: CompressionSummary | null
  showOptions: boolean
  chromeCollapsed: boolean
  isStreaming: boolean
  activityLabel: string
  pendingNotice?: string
  initialDraft?: string
  initialDraftKey?: string | number
  initialAttachments?: Attachment[]
  restoreInitialDraftIfEmpty?: boolean
  runtimeRepairIntent?: RuntimeRepairIntent
  intentDraft: IntentDraft | null
  composerCommands: ComposerCommand[]
  composerReferences: CommandReference[]
  multimodalPolicy: ChatMultimodalPolicy
  memoryStatus: ChatBoundaryMemoryStatus
  supportsReasoningQuick: boolean
  reasoningEffort: Conversation['reasoningEffort']
  metrics: ConversationMetrics
  regenerableAssistantId?: string
  switchableProviders: AIProvider[]
  readyProviders: AIProvider[]
  composerBottomInset: number
  messageListBottomPadding: number
  insets: EdgeInsets
  visualTopInset: number
  colors: ReturnType<typeof useAppTheme>['colors']
  embedded: boolean
  backgroundState: IsleBackgroundState
  compactViewport: boolean
  mobileViewport: boolean
  viewportHeight: number
  showBack: boolean
  shellNavigation: boolean
  topChromeInset: number
  goHistory: () => void
  goSettings: () => void
  onNewConversation: () => void
  goProviders: () => void
  goMemoryReview: () => void
  openWorkspaceReview: () => void
  goKnowledge: () => void
  openAgentWorkflowSettings: (message: Message) => void
  onApplyStarter: (draft: string, attachments?: Attachment[], restoreIfEmpty?: boolean) => void
  refreshSkills: () => Promise<void>
  updateConversation: (id: string, updates: Partial<Conversation>) => void
  switchConversationModel: (id: string, providerId: string, model: string) => boolean
  removeMessage: (convId: string, msgId: string) => void
  hydrateProviderKey: (id: string) => Promise<AIProvider | null>
  updateProvider: (id: string, updates: Partial<AIProvider>) => Promise<void>
  dialog: ReturnType<typeof useIsleDialog>
  listRef: RefObject<FlashListRef<Message> | null>
  setShowOptions: Dispatch<SetStateAction<boolean>>
  setChromeCollapsed: Dispatch<SetStateAction<boolean>>
  setPendingStreamingMessage: Dispatch<SetStateAction<PendingStreamingMessage | null>>
  setIntentDraft: Dispatch<SetStateAction<IntentDraft | null>>
  composerOutputMode: ConversationChatWorkflowRuntimeRequestedOutput
  onToggleComposerOutputMode: () => void
  setProviderHealth: Dispatch<SetStateAction<ConversationHealth | null>>
  composerPanel: ComposerPanel
  setComposerPanel: Dispatch<SetStateAction<ComposerPanel>>
  setComposerHeight: Dispatch<SetStateAction<number>>
  collapseQuickTools: () => void
  motion: ReturnType<typeof useMotionPreference>
  markChromeActive: () => void
  restoreChrome: () => void
  lastScrollOffset: MutableRefObject<number>
  autoStickToBottom: MutableRefObject<boolean>
  keyboardLift: number
  keyboardVisible: boolean
  workspaceOverlayLocked: boolean
  settings: ReturnType<typeof useSettingsStore.getState>['settings']
  modelAccessSettings: ModelAccessSettings
  modeEmptyTitle: string
  modeEmptyDescription: string
  modeComposerPlaceholder: string
  modeSystemPromptPlaceholder: string
  modeOutputLocked: boolean
  modeShowOutputControl: boolean
  modeShowReasoningControl: boolean
  setComposerFocused: Dispatch<SetStateAction<boolean>>
  setPagerGestureLocked?: (locked: boolean) => void
  settingsTransitionActive: boolean
}
