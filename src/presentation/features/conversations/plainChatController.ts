import type { AssistantRun } from '@/modules/assistant-runtime'
import type { ConversationRunProjection, ConversationRunUseCase } from '@/modules/conversations'
import type { Conversation } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { Settings } from '@/types/settingsContracts'

export interface PlainChatEligibilityInput {
  conversation: Conversation
  hasAttachments: boolean
  settings: Settings
}

export interface PlainChatProjectionInput {
  conversation: Conversation
  assistantMessageId: string
  provider: AIProvider
}

export interface PlainChatRuntimeInput {
  conversation: Conversation
  provider: AIProvider
  settings: Settings
}

export type PlainChatRuntimeFactory = (
  input: PlainChatRuntimeInput,
) => ConversationRunUseCase

export interface StartPlainChatRunInput extends PlainChatEligibilityInput, PlainChatProjectionInput {
  controller: AbortController
  createRuntime: PlainChatRuntimeFactory
}

export interface PlainChatRunHandle {
  done: Promise<void>
}

export interface PlainChatControllerDependencies {
  createProjection: (
    input: PlainChatProjectionInput,
    onTerminalPersisted: () => void,
  ) => ConversationRunProjection
  finishProjectionFailure: (
    input: PlainChatProjectionInput,
    message: string,
  ) => Promise<void>
  isMessageCancelled: (conversationId: string, messageId: string) => boolean
  recoverProjection: (run: AssistantRun) => Promise<void>
}

export interface PlainChatController {
  isEligible(input: PlainChatEligibilityInput): boolean
  start(input: StartPlainChatRunInput): Promise<PlainChatRunHandle | undefined>
  recover(runtime: ConversationRunUseCase): Promise<readonly AssistantRun[]>
}

export function createPlainChatController(
  dependencies: PlainChatControllerDependencies,
): PlainChatController {
  return {
    isEligible: isPlainChatEligible,

    async start(input) {
      if (!isPlainChatEligible(input) ||
        input.controller.signal.aborted ||
        dependencies.isMessageCancelled(input.conversation.id, input.assistantMessageId)) {
        return undefined
      }

      const runtime = input.createRuntime({
        conversation: input.conversation,
        provider: input.provider,
        settings: input.settings,
      })
      let terminalProjectionPersisted = false
      const projection = dependencies.createProjection(input, () => {
        terminalProjectionPersisted = true
      })
      const handle = runtime.start({
        conversationId: input.conversation.id,
        responseMessageId: input.assistantMessageId,
        cancellationSignal: input.controller.signal,
        projection,
      })
      const cancel = () => {
        void runtime.cancel(handle.runId)
      }
      input.controller.signal.addEventListener('abort', cancel, { once: true })
      if (input.controller.signal.aborted) cancel()

      const done = handle.completion
        .then(async (result) => {
          if (!result.ok && !terminalProjectionPersisted) {
            await dependencies.finishProjectionFailure(input, result.error.message)
          }
        })
        .finally(() => {
          input.controller.signal.removeEventListener('abort', cancel)
        })

      return { done }
    },

    async recover(runtime) {
      const recovery = await runtime.recoverInterruptedRuns(async ({ run }) => {
        await dependencies.recoverProjection(run)
      })
      if (!recovery.ok) throw new Error(recovery.error.message)
      return recovery.value
    },
  }
}

export function isPlainChatEligible(input: PlainChatEligibilityInput): boolean {
  return !input.hasAttachments &&
    !input.settings.webSearchEnabled &&
    !input.conversation.skillIds?.length &&
    !input.conversation.skillSnapshot &&
    !input.conversation.enabledTools?.length
}

export function resolveChatRecoveryMessageId(
  run: Pick<AssistantRun, 'responseMessageId'>,
): string | undefined {
  return run.responseMessageId
}
