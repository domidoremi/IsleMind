import {
  createVNextPlainChatController,
} from './vnextPlainChatController'
import type { AssistantRun } from '@/modules/assistant-runtime'
import type { ConversationRunUseCase } from '@/modules/conversations'
import {
  createVNextPlainChatProjection,
  finishVNextPlainChatProjectionFailure,
  isVNextPlainChatMessageCancelled,
  recoverVNextChatProjection,
} from './vnextPlainChatProjection'

const controller = createVNextPlainChatController({
  createProjection: createVNextPlainChatProjection,
  finishProjectionFailure: finishVNextPlainChatProjectionFailure,
  isMessageCancelled: isVNextPlainChatMessageCancelled,
  recoverProjection: recoverVNextChatProjection,
})

export type {
  StartVNextPlainChatRunInput,
  VNextPlainChatEligibilityInput,
  VNextPlainChatRunHandle,
  VNextPlainChatRuntimeFactory,
  VNextPlainChatRuntimeInput,
} from './vnextPlainChatController'

export const isVNextPlainChatEligible = controller.isEligible

export const tryStartVNextPlainChatRun = controller.start

export async function recoverVNextChatRuns(runtime: ConversationRunUseCase): Promise<readonly AssistantRun[]> {
  return controller.recover(runtime)
}
