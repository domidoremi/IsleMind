import type { AssistantRun } from '@/modules/assistant-runtime'
import type { ConversationRunProjection, ConversationRunUseCase } from '@/modules/conversations'
import type { Conversation } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { Settings } from '@/types/settingsContracts'

export interface VNextPlainChatEligibilityInput {
  conversation: Conversation
  hasAttachments: boolean
  settings: Settings
}

export interface VNextPlainChatProjectionInput {
  conversation: Conversation
  assistantMessageId: string
  provider: AIProvider
}

export interface VNextPlainChatRuntimeInput {
  conversation: Conversation
  provider: AIProvider
  settings: Settings
}

export type VNextPlainChatRuntimeFactory = (
  input: VNextPlainChatRuntimeInput,
) => ConversationRunUseCase

export interface StartVNextPlainChatRunInput extends VNextPlainChatEligibilityInput, VNextPlainChatProjectionInput {
  controller: AbortController
  createRuntime: VNextPlainChatRuntimeFactory
}

export interface VNextPlainChatRunHandle {
  done: Promise<void>
}

export interface VNextPlainChatControllerDependencies {
  createProjection: (
    input: VNextPlainChatProjectionInput,
    onTerminalPersisted: () => void,
  ) => ConversationRunProjection
  finishProjectionFailure: (
    input: VNextPlainChatProjectionInput,
    message: string,
  ) => Promise<void>
  isMessageCancelled: (conversationId: string, messageId: string) => boolean
  recoverProjection: (run: AssistantRun) => Promise<void>
}

export interface VNextPlainChatController {
  isEligible(input: VNextPlainChatEligibilityInput): boolean
  start(input: StartVNextPlainChatRunInput): Promise<VNextPlainChatRunHandle | undefined>
  recover(runtime: ConversationRunUseCase): Promise<readonly AssistantRun[]>
}

export function createVNextPlainChatController(
  dependencies: VNextPlainChatControllerDependencies,
): VNextPlainChatController {
  return {
    isEligible: isVNextPlainChatEligible,

    async start(input) {
      if (!isVNextPlainChatEligible(input) ||
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

export function isVNextPlainChatEligible(input: VNextPlainChatEligibilityInput): boolean {
  return !input.hasAttachments &&
    !input.settings.webSearchEnabled &&
    !input.conversation.skillIds?.length &&
    !input.conversation.skillSnapshot &&
    !input.conversation.enabledTools?.length
}

export function resolveVNextChatRecoveryMessageId(
  run: Pick<AssistantRun, 'responseMessageId'>,
): string | undefined {
  return run.responseMessageId
}
