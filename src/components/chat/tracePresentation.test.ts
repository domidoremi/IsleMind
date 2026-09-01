import type { ProcessTrace } from '@/core'
import {
  formatProcessTraceForCopy,
  safeProcessTraceContent,
} from './tracePresentation'

describe('trace presentation privacy', () => {
  it('shows only an explicitly safe reasoning summary', () => {
    const trace: ProcessTrace = {
      id: 'reasoning-safe-summary',
      type: 'reasoning',
      title: 'Reasoning',
      content: 'Private chain-of-thought with api_key=top-secret-token',
      status: 'done',
      startedAt: 100,
      completedAt: 180,
      metadata: {
        safeSummary: 'Comparing the supported implementation options.',
      },
    }

    expect(safeProcessTraceContent(trace)).toBe(
      'Comparing the supported implementation options.',
    )
    const copy = formatProcessTraceForCopy(trace)
    expect(copy).toContain('Comparing the supported implementation options.')
    expect(copy).not.toContain('Private chain-of-thought')
    expect(copy).not.toContain('top-secret-token')
  })

  it('does not expose raw reasoning when no safe summary exists', () => {
    const trace: ProcessTrace = {
      id: 'reasoning-private-only',
      type: 'reasoning',
      title: 'Reasoning',
      content: 'Internal reasoning details that must stay private.',
      status: 'running',
      startedAt: 100,
    }

    expect(safeProcessTraceContent(trace)).toBe('')
    expect(formatProcessTraceForCopy(trace)).not.toContain(
      'Internal reasoning details that must stay private.',
    )
  })
})
