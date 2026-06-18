type ActiveStreamHandle = {
  controller: AbortController
  messageId: string
  flush?: () => void
  done?: Promise<void>
}

const activeControllers = new Map<string, ActiveStreamHandle>()
let streamAborter: ((conversationId: string) => void) | null = null

export function getActiveStream(conversationId: string): ActiveStreamHandle | undefined {
  return activeControllers.get(conversationId)
}

export function setActiveStream(conversationId: string, handle: ActiveStreamHandle): void {
  activeControllers.set(conversationId, handle)
}

export function clearActiveStream(conversationId: string): void {
  activeControllers.delete(conversationId)
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

export function abortStream(conversationId: string): void {
  streamAborter?.(conversationId)
}

export function abortAllStreams(): void {
  const conversationIds = listActiveStreamConversationIds()
  for (const conversationId of conversationIds) {
    streamAborter?.(conversationId)
  }
}
