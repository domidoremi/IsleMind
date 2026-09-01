import {
  createResponseLifecycle,
  lifecycleStageForTrace,
  normalizeResponseLifecycle,
  responseLifecycleElapsedMs,
  responseLifecycleTraceTimestamp,
  safeResponseLifecycleSummary,
  transitionResponseLifecycle,
} from './responseLifecycle'

describe('response lifecycle', () => {
  it('records real stage boundaries without resetting a repeated stage timer', () => {
    const created = createResponseLifecycle(100, 'preparing')
    const thinking = transitionResponseLifecycle(created, 'thinking', 140)
    const repeated = transitionResponseLifecycle(thinking, 'thinking', 220, {
      summary: 'Analyzing the relevant constraints.',
    })

    expect(repeated.stage).toBe('thinking')
    expect(repeated.startedAt).toBe(100)
    expect(repeated.stageStartedAt).toBe(140)
    expect(repeated.history).toHaveLength(2)
    expect(repeated.history[1]).toMatchObject({
      stage: 'thinking',
      startedAt: 140,
      summary: 'Analyzing the relevant constraints.',
    })
    expect(responseLifecycleElapsedMs(repeated, 340)).toBe(200)
  })

  it('does not reopen a terminal response when a late provider event arrives', () => {
    const completed = transitionResponseLifecycle(
      createResponseLifecycle(100, 'working'),
      'completed',
      480,
    )
    const lateTrace = transitionResponseLifecycle(completed, 'tool_calling', 510)

    expect(lateTrace).toEqual(completed)
    expect(responseLifecycleElapsedMs(lateTrace, 9_999)).toBe(380)
  })

  it('maps provider trace events to observable work stages', () => {
    expect(lifecycleStageForTrace({ type: 'reasoning', status: 'running' })).toBe('thinking')
    expect(lifecycleStageForTrace({ type: 'tool', status: 'running' })).toBe('tool_calling')
    expect(lifecycleStageForTrace({ type: 'tool', status: 'done' })).toBe('tool_result')
    expect(lifecycleStageForTrace({ type: 'retrieval', status: 'running' })).toBe('working')
    expect(lifecycleStageForTrace({ type: 'reasoning', status: 'done' }, true)).toBe('generating')
  })

  it('uses completion time for terminal trace stages', () => {
    expect(responseLifecycleTraceTimestamp({
      status: 'running',
      startedAt: 120,
      completedAt: undefined,
    }, 300)).toBe(120)
    expect(responseLifecycleTraceTimestamp({
      status: 'done',
      startedAt: 120,
      completedAt: 280,
    }, 300)).toBe(280)
  })

  it('ignores stale non-terminal events without blocking a later tool loop', () => {
    const generating = transitionResponseLifecycle(
      createResponseLifecycle(100, 'thinking'),
      'generating',
      300,
    )
    const staleReasoning = transitionResponseLifecycle(generating, 'thinking', 240)

    expect(staleReasoning).toEqual(generating)

    const toolCalling = transitionResponseLifecycle(generating, 'tool_calling', 360)
    const toolResult = transitionResponseLifecycle(toolCalling, 'tool_result', 410)
    const resumedGeneration = transitionResponseLifecycle(toolResult, 'generating', 430)

    expect(resumedGeneration.stage).toBe('generating')
    expect(resumedGeneration.stageStartedAt).toBe(430)
    expect(resumedGeneration.history.map((entry) => entry.stage)).toEqual([
      'thinking',
      'generating',
      'tool_calling',
      'tool_result',
      'generating',
    ])
  })

  it('uses persisted message completion time when normalizing a legacy terminal response', () => {
    const lifecycle = normalizeResponseLifecycle(undefined, 100, 'done', 620)

    expect(lifecycle).toMatchObject({
      stage: 'completed',
      startedAt: 100,
      completedAt: 620,
    })
    expect(responseLifecycleElapsedMs(lifecycle!, 9_999)).toBe(520)
  })

  it('redacts secrets and removes private thinking blocks from summaries', () => {
    const summary = safeResponseLifecycleSummary(
      '<think>private chain of thought</think> Checking the implementation. api_key=top-secret-token',
    )

    expect(summary).toContain('Checking the implementation.')
    expect(summary).not.toContain('private chain of thought')
    expect(summary).not.toContain('top-secret-token')
  })
})
