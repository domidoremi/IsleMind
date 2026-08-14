import type {
  ChatWorkspacePrivateMemoryConfirmation,
  ChatWorkspaceReviewCursor,
  ChatWorkspaceReviewMutationOutcome,
  ChatWorkspaceReviewProjection as WorkspaceReviewProjection,
  ChatWorkspaceReviewRuntime,
} from '@/modules/workspaces'

import type { ChatWorkspaceReviewProjection } from '@/components/chat/chatWorkspaceReviewPresentation'
import { projectChatWorkspaceReview } from './chatWorkspaceReviewProjection'

export interface ChatWorkspaceReviewViewState {
  readonly conversationId: string
  readonly cursor: ChatWorkspaceReviewCursor
  readonly projection: ChatWorkspaceReviewProjection
}

export type ChatWorkspaceReviewControllerOutcome =
  | { readonly status: 'ready'; readonly state: ChatWorkspaceReviewViewState }
  | {
      readonly status: 'updated'
      readonly operation: 'approved' | 'dismissed' | 'private_memory_cleared'
      readonly changed: boolean
      readonly state: ChatWorkspaceReviewViewState
    }
  | {
      readonly status: 'confirmation_required'
      readonly operation: 'approve' | 'clear_private_memory'
      readonly confirmation: ChatWorkspacePrivateMemoryConfirmation
      readonly state: ChatWorkspaceReviewViewState
    }
  | { readonly status: 'stale'; readonly state?: ChatWorkspaceReviewViewState }
  | { readonly status: 'not_found'; readonly state: ChatWorkspaceReviewViewState }
  | { readonly status: 'cancelled' | 'superseded' }
  | { readonly status: 'failed'; readonly code: 'unavailable' | 'execution_failed' }

export interface ChatWorkspaceReviewControllerDependencies {
  resolveRuntime(): ChatWorkspaceReviewRuntime | undefined
}

export interface ChatWorkspaceReviewController {
  load(conversationId: string): Promise<ChatWorkspaceReviewControllerOutcome>
  approve(
    state: ChatWorkspaceReviewViewState,
    pendingWritebackId: string,
    confirmation?: ChatWorkspacePrivateMemoryConfirmation,
  ): Promise<ChatWorkspaceReviewControllerOutcome>
  dismiss(
    state: ChatWorkspaceReviewViewState,
    pendingWritebackId: string,
  ): Promise<ChatWorkspaceReviewControllerOutcome>
  clearPrivateMemory(
    state: ChatWorkspaceReviewViewState,
    confirmation?: ChatWorkspacePrivateMemoryConfirmation,
  ): Promise<ChatWorkspaceReviewControllerOutcome>
  cancel(): void
}

interface ActiveRequest {
  readonly id: number
  readonly controller: AbortController
}

export function createChatWorkspaceReviewController(
  dependencies: ChatWorkspaceReviewControllerDependencies,
): ChatWorkspaceReviewController {
  let requestSequence = 0
  let activeRequest: ActiveRequest | undefined

  async function execute(
    operation: (
      runtime: ChatWorkspaceReviewRuntime,
      signal: AbortSignal,
    ) => Promise<ChatWorkspaceReviewControllerOutcome>,
  ): Promise<ChatWorkspaceReviewControllerOutcome> {
    const runtime = dependencies.resolveRuntime()
    if (!runtime) return Object.freeze({ status: 'failed', code: 'unavailable' })

    activeRequest?.controller.abort()
    const request: ActiveRequest = {
      id: ++requestSequence,
      controller: new AbortController(),
    }
    activeRequest = request
    try {
      const outcome = await operation(runtime, request.controller.signal)
      return activeRequest?.id === request.id
        ? outcome
        : Object.freeze({ status: 'superseded' as const })
    } catch {
      return activeRequest?.id === request.id
        ? Object.freeze({ status: 'failed' as const, code: 'execution_failed' as const })
        : Object.freeze({ status: 'superseded' as const })
    } finally {
      if (activeRequest?.id === request.id) activeRequest = undefined
    }
  }

  return Object.freeze({
    load(conversationId: string) {
      return execute(async (runtime, signal) => {
        const outcome = await runtime.loadReview({ conversationId }, { signal })
        if (outcome.status === 'ready') {
          return Object.freeze({ status: 'ready', state: createViewState(outcome.projection) })
        }
        if (outcome.status === 'cancelled') return Object.freeze({ status: 'cancelled' })
        return Object.freeze({ status: 'failed', code: 'execution_failed' })
      })
    },

    approve(
      state: ChatWorkspaceReviewViewState,
      pendingWritebackId: string,
      confirmation?: ChatWorkspacePrivateMemoryConfirmation,
    ) {
      return execute(async (runtime, signal) => mapMutationOutcome(await runtime.approvePendingWriteback({
        conversationId: state.conversationId,
        pendingWritebackId,
        expected: state.cursor,
        ...(confirmation ? { confirmation } : {}),
      }, { signal })))
    },

    dismiss(state: ChatWorkspaceReviewViewState, pendingWritebackId: string) {
      return execute(async (runtime, signal) => mapMutationOutcome(await runtime.dismissPendingWriteback({
        conversationId: state.conversationId,
        pendingWritebackId,
        expected: state.cursor,
      }, { signal })))
    },

    clearPrivateMemory(
      state: ChatWorkspaceReviewViewState,
      confirmation?: ChatWorkspacePrivateMemoryConfirmation,
    ) {
      return execute(async (runtime, signal) => mapMutationOutcome(await runtime.clearPrivateMemory({
        conversationId: state.conversationId,
        expected: state.cursor,
        ...(confirmation ? { confirmation } : {}),
      }, { signal })))
    },

    cancel() {
      activeRequest?.controller.abort()
      activeRequest = undefined
    },
  })
}

function mapMutationOutcome(
  outcome: ChatWorkspaceReviewMutationOutcome,
): ChatWorkspaceReviewControllerOutcome {
  if (outcome.status === 'updated') {
    return Object.freeze({
      status: 'updated',
      operation: outcome.operation,
      changed: outcome.changed,
      state: createViewState(outcome.projection),
    })
  }
  if (outcome.status === 'confirmation_required') {
    return Object.freeze({
      status: 'confirmation_required',
      operation: outcome.operation,
      confirmation: Object.freeze({ ...outcome.confirmation }),
      state: createViewState(outcome.projection),
    })
  }
  if (outcome.status === 'stale') {
    return Object.freeze({
      status: 'stale',
      ...(outcome.projection ? { state: createViewState(outcome.projection) } : {}),
    })
  }
  if (outcome.status === 'not_found') {
    return Object.freeze({ status: 'not_found', state: createViewState(outcome.projection) })
  }
  if (outcome.status === 'cancelled') return Object.freeze({ status: 'cancelled' })
  return Object.freeze({ status: 'failed', code: 'execution_failed' })
}

function createViewState(
  projection: WorkspaceReviewProjection,
): ChatWorkspaceReviewViewState {
  const presented = projectChatWorkspaceReview(projection)
  return Object.freeze({
    conversationId: projection.conversationId,
    cursor: Object.freeze({
      workspaceId: projection.workspaceId,
      revision: projection.revision,
    }),
    projection: Object.freeze({
      ...presented,
      pendingWritebacks: Object.freeze(presented.pendingWritebacks.map((writeback) => Object.freeze({
        ...writeback,
        kindCounts: Object.freeze({ ...writeback.kindCounts }),
      }))),
    }),
  })
}
