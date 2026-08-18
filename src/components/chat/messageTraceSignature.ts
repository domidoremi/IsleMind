import type { ProcessTrace } from '@/core'

const TRACE_TEXT_SAMPLE_LIMIT = 96

/**
 * Keep message equality checks cheap while still noticing edits inside a trace
 * whose length has not changed. The sampled FNV-1a fingerprint never walks a
 * string more than TRACE_TEXT_SAMPLE_LIMIT times.
 */
function boundedTraceTextFingerprint(value: string | undefined): string {
  if (!value) return '0:0'

  const length = value.length
  const sampleCount = Math.min(length, TRACE_TEXT_SAMPLE_LIMIT)
  let hash = 2_166_136_261

  if (sampleCount === length) {
    for (let index = 0; index < length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 16_777_619)
    }
  } else {
    const lastIndex = length - 1
    for (let sample = 0; sample < sampleCount; sample += 1) {
      const index = Math.floor((sample * lastIndex) / (sampleCount - 1))
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 16_777_619)
    }
  }

  return `${length}:${(hash >>> 0).toString(36)}`
}

export function createProcessTraceSignature(traces: ProcessTrace[]): string {
  return traces
    .map((trace) => [
      trace.id,
      trace.type,
      trace.status,
      boundedTraceTextFingerprint(trace.title),
      boundedTraceTextFingerprint(trace.content),
      trace.completedAt ?? '',
    ].join(':'))
    .join('|')
}
