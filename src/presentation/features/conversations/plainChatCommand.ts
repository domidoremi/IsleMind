import {
  createPlainChatController,
} from './plainChatController'
import type { AssistantRun } from '@/modules/assistant-runtime'
import type { ConversationRunUseCase } from '@/modules/conversations'
import {
  createPlainChatProjection,
  finishPlainChatProjectionFailure,
  isPlainChatMessageCancelled,
  recoverChatProjection,
} from './plainChatProjection'

const controller = createPlainChatController({
  createProjection: createPlainChatProjection,
  finishProjectionFailure: finishPlainChatProjectionFailure,
  isMessageCancelled: isPlainChatMessageCancelled,
  recoverProjection: recoverChatProjection,
})

export type {
  StartPlainChatRunInput,
  PlainChatEligibilityInput,
  PlainChatRunHandle,
  PlainChatRuntimeFactory,
  PlainChatRuntimeInput,
} from './plainChatController'

export const isPlainChatEligible = controller.isEligible

export const tryStartPlainChatRun = controller.start

export async function recoverChatRuns(runtime: ConversationRunUseCase): Promise<readonly AssistantRun[]> {
  return controller.recover(runtime)
}
