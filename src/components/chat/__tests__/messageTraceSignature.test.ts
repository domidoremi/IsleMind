import type { ProcessTrace } from '@/core'
import { createProcessTraceSignature } from '../messageTraceSignature'

function trace(content: string): ProcessTrace {
  return {
    id: 'trace-1',
    type: 'reasoning',
    title: 'Thinking',
    content,
    status: 'running',
  }
}

describe('createProcessTraceSignature', () => {
  it('changes when same-length trace content changes', () => {
    const before = 'a'.repeat(240)
    const after = `${'a'.repeat(120)}b${'a'.repeat(119)}`

    expect(after).toHaveLength(before.length)
    expect(createProcessTraceSignature([trace(before)])).not.toBe(createProcessTraceSignature([trace(after)]))
  })

  it('remains stable for equivalent traces', () => {
    const first = trace('reasoning output')
    const second = { ...first }

    expect(createProcessTraceSignature([first])).toBe(createProcessTraceSignature([second]))
  })

  it('captures title and terminal state changes', () => {
    const base = trace('done')
    const titleChanged = { ...base, title: 'Updated' }
    const statusChanged = { ...base, status: 'done' as const }

    expect(createProcessTraceSignature([base])).not.toBe(createProcessTraceSignature([titleChanged]))
    expect(createProcessTraceSignature([base])).not.toBe(createProcessTraceSignature([statusChanged]))
  })
})
