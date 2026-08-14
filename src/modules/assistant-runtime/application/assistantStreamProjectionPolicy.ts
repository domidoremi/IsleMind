import type { ProcessTrace } from '@/core'

export interface AssistantStreamProjectionIdentity {
  conversationId: string
  responseMessageId: string
}

export interface AssistantStreamTextProjection extends AssistantStreamProjectionIdentity {
  text: string
}

export interface AssistantStreamTraceProjection extends AssistantStreamProjectionIdentity {
  trace: ProcessTrace
}

export interface AssistantStreamProjectionPolicyDependencies {
  schedule(callback: () => void, delayMs: number): () => void
  appendContent(projection: AssistantStreamTextProjection): void
  upsertTrace(projection: AssistantStreamTraceProjection): void
  clampTraceContent(content: string, type: ProcessTrace['type']): string
}

export interface AssistantStreamProjectionPolicyOptions {
  textFlushMs?: number
  textMaxBuffer?: number
  traceFlushMs?: number
  traceMaxBuffer?: number
}

export interface AssistantStreamProjectionSession {
  pushText(chunk: string): void
  pushTrace(trace: ProcessTrace): void
  flush(): void
}

export interface AssistantStreamProjectionPolicy {
  start(identity: AssistantStreamProjectionIdentity): AssistantStreamProjectionSession
}

const DEFAULT_TEXT_FLUSH_MS = 64
const DEFAULT_TEXT_MAX_BUFFER = 128
const DEFAULT_TRACE_FLUSH_MS = 280
const DEFAULT_TRACE_MAX_BUFFER = 8

export function createAssistantStreamProjectionPolicy(
  dependencies: AssistantStreamProjectionPolicyDependencies,
  options: AssistantStreamProjectionPolicyOptions = {},
): AssistantStreamProjectionPolicy {
  const textFlushMs = options.textFlushMs ?? DEFAULT_TEXT_FLUSH_MS
  const textMaxBuffer = options.textMaxBuffer ?? DEFAULT_TEXT_MAX_BUFFER
  const traceFlushMs = options.traceFlushMs ?? DEFAULT_TRACE_FLUSH_MS
  const traceMaxBuffer = options.traceMaxBuffer ?? DEFAULT_TRACE_MAX_BUFFER

  return {
    start(input) {
      const identity: AssistantStreamProjectionIdentity = {
        conversationId: input.conversationId,
        responseMessageId: input.responseMessageId,
      }
      let pendingText = ''
      let cancelTextFlush: (() => void) | undefined
      const pendingTraces = new Map<string, ProcessTrace>()
      let cancelTraceFlush: (() => void) | undefined

      function flushText() {
        cancelTextFlush?.()
        cancelTextFlush = undefined
        if (!pendingText) return
        const text = pendingText
        pendingText = ''
        dependencies.appendContent({ ...identity, text })
      }

      function flushTraces() {
        cancelTraceFlush?.()
        cancelTraceFlush = undefined
        if (!pendingTraces.size) return
        const traces = Array.from(pendingTraces.values())
        pendingTraces.clear()
        for (const trace of traces) {
          dependencies.upsertTrace({ ...identity, trace })
        }
      }

      return {
        pushText(chunk) {
          if (!chunk) return
          pendingText += chunk
          if (pendingText.length >= textMaxBuffer) {
            flushText()
            return
          }
          cancelTextFlush ??= dependencies.schedule(flushText, textFlushMs)
        },
        pushTrace(trace) {
          const key = trace.id || `${trace.type}:${trace.title}`
          const current = pendingTraces.get(key)
          pendingTraces.set(key, current ? mergeTrace(current, trace, dependencies.clampTraceContent) : trace)
          if (
            pendingTraces.size >= traceMaxBuffer ||
            trace.status === 'done' ||
            trace.status === 'error' ||
            trace.status === 'skipped'
          ) {
            flushTraces()
            return
          }
          cancelTraceFlush ??= dependencies.schedule(flushTraces, traceFlushMs)
        },
        flush() {
          flushText()
          flushTraces()
        },
      }
    },
  }
}

function mergeTrace(
  current: ProcessTrace,
  next: ProcessTrace,
  clampContent: AssistantStreamProjectionPolicyDependencies['clampTraceContent'],
): ProcessTrace {
  const shouldAppend =
    next.status === 'running' &&
    current.content &&
    next.content &&
    current.content !== next.content &&
    !current.content.endsWith(next.content)
  const content = shouldAppend ? `${current.content}${next.content}` : next.content ?? current.content
  return {
    ...current,
    ...next,
    content: content ? clampContent(content, next.type) : undefined,
    startedAt: current.startedAt ?? next.startedAt,
    completedAt: next.completedAt ?? current.completedAt,
    durationMs: next.durationMs ?? current.durationMs,
    metadata: { ...current.metadata, ...next.metadata },
  }
}
