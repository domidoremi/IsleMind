import type { ChatWorkspaceReviewRuntime } from '@/modules/workspaces'

import {
  createChatWorkspaceReviewController,
  type ChatWorkspaceReviewViewState,
} from './chatWorkspaceReviewController'

export const CHAT_WORKSPACE_REVIEW_RUNTIME_ALREADY_BOUND_ERROR =
  'chat_workspace_review_runtime_already_bound'

export type ChatWorkspaceReviewRuntimeResolver = () => ChatWorkspaceReviewRuntime | undefined

let runtimeResolver: ChatWorkspaceReviewRuntimeResolver | undefined

const controller = createChatWorkspaceReviewController({
  resolveRuntime() {
    return runtimeResolver?.()
  },
})

export function bindChatWorkspaceReviewRuntime(
  resolver: ChatWorkspaceReviewRuntimeResolver,
): void {
  if (!runtimeResolver) {
    runtimeResolver = resolver
    return
  }
  if (runtimeResolver !== resolver) {
    throw new Error(CHAT_WORKSPACE_REVIEW_RUNTIME_ALREADY_BOUND_ERROR)
  }
}

export function releaseChatWorkspaceReviewRuntime(
  resolver: ChatWorkspaceReviewRuntimeResolver,
): void {
  if (runtimeResolver === resolver) runtimeResolver = undefined
}

export const loadChatWorkspaceReview = controller.load
export const approveChatWorkspacePendingWriteback = controller.approve
export const dismissChatWorkspacePendingWriteback = controller.dismiss
export const clearChatWorkspacePrivateMemory = controller.clearPrivateMemory
export const cancelChatWorkspaceReviewOperation = controller.cancel

export type { ChatWorkspaceReviewViewState }
