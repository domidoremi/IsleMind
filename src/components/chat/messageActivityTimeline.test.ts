import {
  collectLifecycleActivitySteps,
  hasExpandableActivitySteps,
  createResponseLifecycle,
  lifecycleStageForTrace,
  transitionResponseLifecycle,
} from '@/modules/conversations'
import type { ProcessTrace } from '@/core'
import type { MessageResponseLifecycle, ResponseLifecycleStage } from '@/types/chatContracts'

// Mirrors what chatStreamingStore.upsertTrace does: derive the visible stage
// from a real ProcessTrace, then advance the durable lifecycle at the trace's
// event time. Only real events move the timeline — nothing is invented here.
function stageForTrace(type: ProcessTrace['type'], status: ProcessTrace['status'], hasOutput = false): ResponseLifecycleStage | undefined {
  return lifecycleStageForTrace({ type, status } as Pick<ProcessTrace, 'type' | 'status'>, hasOutput)
}

interface DrivenEvent {
  at: number
  type?: ProcessTrace['type']
  status?: ProcessTrace['status']
  hasOutput?: boolean
  stage?: ResponseLifecycleStage // direct stage (e.g. generating from a text delta, or a terminal)
  summary?: string
}

function driveSequence(events: DrivenEvent[]): MessageResponseLifecycle {
  let lifecycle = createResponseLifecycle(events[0].at, 'preparing')
  for (const event of events) {
    const stage = event.stage ?? (event.type ? stageForTrace(event.type, event.status ?? 'running', event.hasOutput) : undefined)
    if (!stage) continue
    lifecycle = transitionResponseLifecycle(lifecycle, stage, event.at, event.summary ? { summary: event.summary } : {})
  }
  return lifecycle
}

describe('lifecycle activity timeline projection', () => {
  it('projects a canonical reasoning+tool run into an ordered step timeline', () => {
    // thinking -> tool call -> tool result -> thinking -> generating (first delta) -> completed
    const lifecycle = driveSequence([
      { at: 100, type: 'reasoning', status: 'running', summary: 'Comparing candidate approaches.' },
      { at: 200, type: 'tool', status: 'running' },
      { at: 260, type: 'tool', status: 'done' },
      { at: 300, type: 'reasoning', status: 'running' },
      { at: 360, stage: 'generating' },
      { at: 520, stage: 'completed' },
    ])

    const steps = collectLifecycleActivitySteps(lifecycle)
    // A real message opens at 'preparing' (created before the first trace), then
    // advances only as real events arrive.
    expect(steps.map((step) => step.stage)).toEqual([
      'preparing',
      'thinking',
      'tool_calling',
      'tool_result',
      'thinking',
      'generating',
      'completed',
    ])
    // Terminal run: no step is live.
    expect(steps.some((step) => step.live)).toBe(false)
    // Completed non-final steps carry a real duration derived from event times.
    const toolCall = steps.find((step) => step.stage === 'tool_calling')!
    expect(toolCall.completedAt! - toolCall.startedAt).toBe(60)
  })

  it('does not lose, duplicate, or reorder steps across rapid Thinking -> Tool -> Thinking -> Generating switching with a stale event', () => {
    // Reuses the proven stale-ordering sequence and asserts it at the timeline layer.
    const lifecycle = driveSequence([
      { at: 100, type: 'reasoning', status: 'running' },
      { at: 300, stage: 'generating' },
      { at: 240, type: 'reasoning', status: 'running' }, // stale: earlier than current stage start -> ignored
      { at: 360, type: 'tool', status: 'running' },
      { at: 410, type: 'tool', status: 'done' },
      { at: 430, stage: 'generating' },
    ])

    const steps = collectLifecycleActivitySteps(lifecycle)
    expect(steps.map((step) => step.stage)).toEqual([
      'preparing',
      'thinking',
      'generating',
      'tool_calling',
      'tool_result',
      'generating',
    ])
  })

  it('preserves order across multiple consecutive tool cycles', () => {
    const lifecycle = driveSequence([
      { at: 100, type: 'tool', status: 'running' },
      { at: 150, type: 'tool', status: 'done' },
      { at: 200, type: 'tool', status: 'running' },
      { at: 250, type: 'tool', status: 'done' },
      { at: 300, stage: 'generating' },
    ])
    const steps = collectLifecycleActivitySteps(lifecycle)
    expect(steps.map((step) => step.stage)).toEqual([
      'preparing',
      'tool_calling',
      'tool_result',
      'tool_calling',
      'tool_result',
      'generating',
    ])
  })

  it('marks only the current non-terminal stage as live', () => {
    const lifecycle = driveSequence([
      { at: 100, type: 'reasoning', status: 'running' },
      { at: 200, type: 'tool', status: 'running' },
    ])
    const steps = collectLifecycleActivitySteps(lifecycle)
    const last = steps[steps.length - 1]
    expect(last.stage).toBe('tool_calling')
    expect(last.live).toBe(true)
    expect(last.completedAt).toBeUndefined()
    // Only the tail is live.
    expect(steps.filter((step) => step.live)).toHaveLength(1)
  })

  it('closes the timeline on error and cancelled terminals without a live tail', () => {
    const errored = driveSequence([
      { at: 100, type: 'reasoning', status: 'running' },
      { at: 200, stage: 'error' },
    ])
    expect(collectLifecycleActivitySteps(errored).some((step) => step.live)).toBe(false)
    expect(collectLifecycleActivitySteps(errored).at(-1)!.stage).toBe('error')

    const cancelled = driveSequence([
      { at: 100, stage: 'generating' },
      { at: 200, stage: 'cancelled' },
    ])
    expect(collectLifecycleActivitySteps(cancelled).some((step) => step.live)).toBe(false)
    expect(collectLifecycleActivitySteps(cancelled).at(-1)!.stage).toBe('cancelled')
  })

  it('merges adjacent duplicate history entries defensively (legacy/normalized data)', () => {
    // A hand-built lifecycle with adjacent duplicate stages (as legacy persisted
    // history could contain) must collapse into a single step.
    const lifecycle: MessageResponseLifecycle = {
      stage: 'tool_calling',
      startedAt: 100,
      stageStartedAt: 200,
      history: [
        { stage: 'tool_calling', startedAt: 100, completedAt: 150 },
        { stage: 'tool_calling', startedAt: 200 },
      ],
    }
    const steps = collectLifecycleActivitySteps(lifecycle)
    expect(steps).toHaveLength(1)
    expect(steps[0].startedAt).toBe(100)
  })

  it('gates panel expandability on a real multi-step sequence', () => {
    expect(hasExpandableActivitySteps(undefined)).toBe(false)
    const single = createResponseLifecycle(100, 'working')
    expect(hasExpandableActivitySteps(single)).toBe(false)
    const multi = driveSequence([
      { at: 100, type: 'reasoning', status: 'running' },
      { at: 200, stage: 'generating' },
    ])
    expect(hasExpandableActivitySteps(multi)).toBe(true)
  })
})
