type ActiveStreamHandle = {
  controller: AbortController
  messageId: string
  flush?: () => void
  done?: Promise<void>
}

export type StreamCleanupTaskScope = 'provider-stream' | 'agent-task' | 'media-generation'

export interface StreamCleanupTaskHandle {
  id: string
  conversationId: string
  messageId?: string
  scope: StreamCleanupTaskScope
  abortControllerLinked: boolean
  cancel: () => void
  cleanupPartialArtifact?: () => void
}

const activeControllers = new Map<string, ActiveStreamHandle>()
const cleanupTasks = new Map<string, StreamCleanupTaskHandle>()
let streamAborter: ((conversationId: string) => void) | null = null
let streamStateCleaner: {
  clearConversation: (conversationId: string) => void
  clearAll: () => void
} | null = null

export function getActiveStream(conversationId: string): ActiveStreamHandle | undefined {
  return activeControllers.get(conversationId)
}

export function setActiveStream(conversationId: string, handle: ActiveStreamHandle): void {
  activeControllers.set(conversationId, handle)
}

export function clearActiveStream(conversationId: string): void {
  activeControllers.delete(conversationId)
}

export function registerStreamCleanupTask(handle: StreamCleanupTaskHandle): () => void {
  if (handle.scope === 'media-generation' && !handle.abortControllerLinked) {
    throw new Error('media_generation_cleanup_requires_abort_controller')
  }
  const key = streamCleanupTaskKey(handle)
  cleanupTasks.set(key, handle)
  return () => {
    cleanupTasks.delete(key)
  }
}

export function listStreamCleanupTasks(scope?: StreamCleanupTaskScope): StreamCleanupTaskHandle[] {
  const tasks = Array.from(cleanupTasks.values())
  return scope ? tasks.filter((task) => task.scope === scope) : tasks
}

export function clearStreamCleanupTasks(conversationId: string): void {
  for (const [key, task] of Array.from(cleanupTasks.entries())) {
    if (task.conversationId !== conversationId) continue
    runStreamCleanupTask(task)
    cleanupTasks.delete(key)
  }
}

export function clearAllStreamCleanupTasks(): void {
  for (const [key, task] of Array.from(cleanupTasks.entries())) {
    runStreamCleanupTask(task)
    cleanupTasks.delete(key)
  }
}

export function hasActiveStream(conversationId: string): boolean {
  return activeControllers.has(conversationId)
}

export function listActiveStreamConversationIds(): string[] {
  return Array.from(activeControllers.keys())
}

export function registerStreamAborter(aborter: ((conversationId: string) => void) | null): void {
  streamAborter = aborter
}

export function registerStreamStateCleaner(cleaner: typeof streamStateCleaner): void {
  streamStateCleaner = cleaner
}

export function clearStreamState(conversationId: string): void {
  streamStateCleaner?.clearConversation(conversationId)
}

export function clearAllStreamState(): void {
  streamStateCleaner?.clearAll()
}

export function abortStream(conversationId: string): void {
  abortActiveController(conversationId)
  streamAborter?.(conversationId)
  clearActiveStream(conversationId)
  clearStreamCleanupTasks(conversationId)
  clearStreamState(conversationId)
}

export function abortAllStreams(): void {
  const conversationIds = listActiveStreamConversationIds()
  for (const conversationId of conversationIds) {
    abortActiveController(conversationId)
    streamAborter?.(conversationId)
  }
  activeControllers.clear()
  clearAllStreamCleanupTasks()
  clearAllStreamState()
}

function streamCleanupTaskKey(handle: Pick<StreamCleanupTaskHandle, 'scope' | 'conversationId' | 'id'>): string {
  return `${handle.scope}:${handle.conversationId}:${handle.id}`
}

function abortActiveController(conversationId: string): void {
  activeControllers.get(conversationId)?.controller.abort()
}

function runStreamCleanupTask(task: StreamCleanupTaskHandle): void {
  try {
    task.cancel()
  } catch {
    // Cleanup must not block stream state removal on user cancellation.
  }
  try {
    task.cleanupPartialArtifact?.()
  } catch {
    // Partial artifact cleanup is best-effort during cancellation.
  }
}
