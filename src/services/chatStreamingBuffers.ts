import type { ProcessTrace } from '@/types'

export interface StreamingChunkBuffer {
  push(chunk: string): void
  flush(): void
}

export interface StreamingTraceBuffer {
  push(trace: ProcessTrace): void
  flush(): void
}

export interface CreateStreamingChunkBufferInput {
  flushMs: number
  maxBuffer: number
  appendContent(text: string): void
}

export interface CreateStreamingTraceBufferInput {
  flushMs: number
  maxBuffer: number
  upsertTrace(trace: ProcessTrace): void
  mergeTrace(current: ProcessTrace, next: ProcessTrace): ProcessTrace
}

export function createStreamingChunkBuffer(input: CreateStreamingChunkBufferInput): StreamingChunkBuffer {
  let pendingText = ''
  let timer: ReturnType<typeof setTimeout> | null = null

  function flush() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!pendingText) return
    const text = pendingText
    pendingText = ''
    input.appendContent(text)
  }

  function push(chunk: string) {
    if (!chunk) return
    pendingText += chunk
    if (pendingText.length >= input.maxBuffer) {
      flush()
      return
    }
    if (!timer) {
      timer = setTimeout(flush, input.flushMs)
    }
  }

  return { push, flush }
}

export function createStreamingTraceBuffer(input: CreateStreamingTraceBufferInput): StreamingTraceBuffer {
  const pending = new Map<string, ProcessTrace>()
  let timer: ReturnType<typeof setTimeout> | null = null

  function traceKey(trace: ProcessTrace): string {
    return trace.id || `${trace.type}:${trace.title}`
  }

  function flush() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!pending.size) return
    const traces = Array.from(pending.values())
    pending.clear()
    for (const trace of traces) {
      input.upsertTrace(trace)
    }
  }

  function push(trace: ProcessTrace) {
    const key = traceKey(trace)
    const current = pending.get(key)
    pending.set(key, current ? input.mergeTrace(current, trace) : trace)
    if (pending.size >= input.maxBuffer || trace.status === 'done' || trace.status === 'error' || trace.status === 'skipped') {
      flush()
      return
    }
    if (!timer) {
      timer = setTimeout(flush, input.flushMs)
    }
  }

  return { push, flush }
}

export function mergeBufferedTrace(
  current: ProcessTrace,
  next: ProcessTrace,
  clampContent: (content: string, type: ProcessTrace['type']) => string,
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
