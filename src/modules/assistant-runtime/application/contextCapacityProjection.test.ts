import {
  ASSISTANT_CONTEXT_PLAN_RECEIPT_SCHEMA,
  type AssistantContextPlanReceipt,
  type AssistantContextPlanReceiptSource,
} from '../contracts'
import { projectContextCapacity } from './contextCapacityProjection'

function source(
  overrides: Partial<AssistantContextPlanReceiptSource> & Pick<AssistantContextPlanReceiptSource, 'type'>,
): AssistantContextPlanReceiptSource {
  return {
    fragmentId: overrides.fragmentId ?? `${overrides.type}-fragment`,
    type: overrides.type,
    priority: overrides.priority ?? 'normal',
    sourceId: overrides.sourceId ?? `${overrides.type}-source`,
    decision: overrides.decision ?? 'included',
    tokenCap: overrides.tokenCap ?? 1_000,
    estimatedTokens: overrides.estimatedTokens ?? 0,
    originalEstimatedTokens: overrides.originalEstimatedTokens ?? overrides.estimatedTokens ?? 0,
    ...(overrides.sourceCount === undefined ? {} : { sourceCount: overrides.sourceCount }),
  }
}

function receipt(
  overrides: {
    budget?: Partial<AssistantContextPlanReceipt['budget']>
    compression?: Partial<AssistantContextPlanReceipt['compression']>
    sourceManifest?: readonly AssistantContextPlanReceiptSource[]
    failureCodes?: readonly string[]
  } = {},
): AssistantContextPlanReceipt {
  return {
    schema: ASSISTANT_CONTEXT_PLAN_RECEIPT_SCHEMA,
    providerId: 'openai-primary',
    model: 'gpt-5.2',
    budget: {
      modelContextWindow: 128_000,
      requestBudgetTokens: 80_000,
      contextPromptTokens: 1_200,
      estimatedInputTokens: 4_000,
      fixedTokens: 2_000,
      messageTokens: 4_000,
      includedFragmentTokens: 6_000,
      originalFragmentTokens: 6_000,
      totalTokenCap: 90_000,
      activeContextTokens: 6_000,
      tokensUntilCompaction: 74_000,
      ...overrides.budget,
    },
    compression: {
      triggered: false,
      strategy: 'none',
      triggerReason: 'disabled_or_unneeded',
      sourceMessageCount: 0,
      keptMessageCount: 0,
      sourceTokens: 0,
      compressedTokens: 0,
      estimatedSavedTokens: 0,
      compressionRatio: 0,
      summaryTokens: 0,
      summarySectionCount: 0,
      ...overrides.compression,
    },
    sourceManifest: overrides.sourceManifest ?? [],
    failureCodes: overrides.failureCodes ?? [],
  }
}

function project(value: AssistantContextPlanReceipt) {
  return projectContextCapacity({ runId: 'run-1', capturedAt: 1_700_000_000_000, receipt: value })
}

describe('context capacity projection', () => {
  it('rebuilds the planner input ceiling instead of comparing against the model window', () => {
    const view = project(receipt())

    expect(view.contextWindowTokens).toBe(128_000)
    expect(view.inputBudgetTokens).toBe(82_000)
    expect(view.reservedTokens).toBe(46_000)
    expect(view.status).toBe('measured')
  })

  it('totals used tokens from the fragment manifest so the gauge and the breakdown agree', () => {
    const view = project(receipt({
      sourceManifest: [
        source({ type: 'system', estimatedTokens: 1_500 }),
        source({ type: 'recent_messages', estimatedTokens: 4_000 }),
      ],
    }))

    expect(view.usedTokens).toBe(5_500)
    expect(view.segments.reduce((total, segment) => total + segment.tokens, 0)).toBe(view.usedTokens)
    expect(view.remainingTokens).toBe(76_500)
  })

  it('merges fragments that share a type and separates measured from counted sources', () => {
    const view = project(receipt({
      sourceManifest: [
        source({ type: 'tool_outputs', fragmentId: 'mcp-context', estimatedTokens: 900, sourceCount: 12 }),
        source({ type: 'tool_outputs', fragmentId: 'tool-outputs', estimatedTokens: 0, sourceCount: 3 }),
      ],
    }))

    expect(view.segments).toHaveLength(1)
    expect(view.segments[0]).toMatchObject({
      type: 'tool_outputs',
      tokens: 900,
      sourceCount: 15,
      unmeasuredSourceCount: 3,
    })
    expect(view.notices).toContain('unmeasured_sources')
  })

  it('does not report unmeasured sources when every fragment carries an estimate', () => {
    const view = project(receipt({
      sourceManifest: [source({ type: 'retrieved_context', estimatedTokens: 700, sourceCount: 4 })],
    }))

    expect(view.segments[0]?.unmeasuredSourceCount).toBe(0)
    expect(view.notices).not.toContain('unmeasured_sources')
  })

  it('accounts for capped and excluded fragments as dropped tokens', () => {
    const view = project(receipt({
      sourceManifest: [
        source({ type: 'memory', decision: 'capped', estimatedTokens: 400, originalEstimatedTokens: 1_000 }),
        source({ type: 'retrieved_context', decision: 'excluded', estimatedTokens: 0, originalEstimatedTokens: 2_500 }),
      ],
    }))

    const memory = view.segments.find((segment) => segment.type === 'memory')
    const retrieved = view.segments.find((segment) => segment.type === 'retrieved_context')
    expect(memory).toMatchObject({ tokens: 400, cappedCount: 1, droppedTokens: 600 })
    expect(retrieved).toMatchObject({ tokens: 0, excludedCount: 1, droppedTokens: 2_500 })
    expect(view.notices).toContain('excluded_sources')
  })

  it('degrades to unmeasured when the receipt reports no model window', () => {
    const view = project(receipt({
      budget: { modelContextWindow: 0 },
      sourceManifest: [source({ type: 'recent_messages', estimatedTokens: 4_000 })],
    }))

    expect(view.status).toBe('unmeasured')
    expect(view.usedRatio).toBe(0)
    expect(view.usedTokens).toBe(4_000)
  })

  it('flags a plan that overran its input budget', () => {
    const view = project(receipt({
      budget: { requestBudgetTokens: 256, fixedTokens: 100 },
      sourceManifest: [source({ type: 'recent_messages', estimatedTokens: 9_000 })],
    }))

    expect(view.notices).toContain('budget_overrun')
    expect(view.remainingTokens).toBe(0)
  })

  it('reports compression and planner failures without exposing prompt text', () => {
    const view = project(receipt({
      compression: {
        triggered: true,
        strategy: 'structured-v2',
        sourceMessageCount: 40,
        keptMessageCount: 8,
        estimatedSavedTokens: 5_200,
      },
      failureCodes: ['context_budget_overrun'],
    }))

    expect(view.compression).toMatchObject({
      triggered: true,
      strategy: 'structured-v2',
      savedTokens: 5_200,
      keptMessageCount: 8,
      sourceMessageCount: 40,
    })
    expect(view.notices).toContain('compression_active')
    expect(view.notices).toContain('plan_failures')
    expect(JSON.stringify(view)).not.toContain('prompt')
  })

  it('falls back to the reported included fragment total when the manifest is empty', () => {
    const view = project(receipt({ budget: { includedFragmentTokens: 6_000 } }))

    expect(view.segments).toHaveLength(0)
    expect(view.usedTokens).toBe(6_000)
  })
})
