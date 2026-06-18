import type { ProcessTrace } from '@/types'

export function splitSseBuffer(buffer: string): { events: string[]; remainder: string } {
  const normalized = buffer.replace(/\r\n/g, '\n')
  const parts = normalized.split('\n\n')
  const remainder = parts.pop() ?? ''
  return { events: parts, remainder }
}

export function dedupeTraces(traces: ProcessTrace[]): ProcessTrace[] {
  const seen = new Set<string>()
  return traces.filter((trace) => {
    const key = trace.id || `${trace.type}:${trace.title}:${trace.content ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
