import { cloneAssistantContextPlanReceipt, isAssistantContextPlanReceipt, isAssistantToolDeclarationReceipt, type AssistantToolDeclarationReceipt } from '../contracts'
import { buildAssistantContextPlanReceipt } from './contextPlanReceipt'
import { projectContextCapacity } from './contextCapacityProjection'

const receipt: AssistantToolDeclarationReceipt = {
  schema: 'islemind.tool-declaration-receipt.v1', mode: 'discovery',
  catalogRevision: 'islemind.model.operation.catalog.v1:abc123', totalCount: 24,
  declaredCount: 2, deferredCount: 22, declarationChars: 4_500, fullDeclarationChars: 30_000,
  summaryChars: 2_000, budgetChars: 12_000,
}

test('preserves exact declaration diagnostics through receipt cloning and projection without changing token budgets', () => {
  const baseline = buildAssistantContextPlanReceipt({ providerId: 'provider', model: 'model' })
  const captured = cloneAssistantContextPlanReceipt({ ...baseline, toolDeclarations: { ...receipt } })
  expect(isAssistantContextPlanReceipt(captured)).toBe(true)
  const view = projectContextCapacity({ runId: 'run', capturedAt: 1, receipt: captured })
  const old = projectContextCapacity({ runId: 'run', capturedAt: 1, receipt: baseline })
  expect(view.toolDeclarations).toEqual(receipt)
  expect(view.usedTokens).toBe(old.usedTokens)
  expect(view.inputBudgetTokens).toBe(old.inputBudgetTokens)
  expect(view.segments).toEqual(old.segments)
  expect(view.toolDeclarations).not.toBe(captured.toolDeclarations)
  expect(cloneAssistantContextPlanReceipt(baseline)).not.toHaveProperty('toolDeclarations')
})

test.each([
  { schema: 'unknown' }, { mode: 'auto' }, { catalogRevision: 'catalog' },
  { totalCount: 65 }, { declaredCount: 9, deferredCount: 15 }, { declaredCount: 1.5 },
  { deferredCount: 21 }, { declarationChars: -1 }, { fullDeclarationChars: Infinity },
  { summaryChars: 0 }, { summaryChars: 4_501 }, { budgetChars: 1 }, { savedTokens: 1 },
])('rejects malformed or inconsistent declaration diagnostics (%j)', change => {
  const invalid = { ...receipt, ...change }
  expect(isAssistantToolDeclarationReceipt(invalid)).toBe(false)
  expect(isAssistantContextPlanReceipt({ ...buildAssistantContextPlanReceipt({ providerId: 'provider', model: 'model' }), toolDeclarations: invalid })).toBe(false)
})

test('full definitions require matching character counts and no deferred tools or summary', () => {
  const full = { ...receipt, mode: 'full', declaredCount: 24, deferredCount: 0, summaryChars: 0, declarationChars: 30_000 }
  expect(isAssistantToolDeclarationReceipt(full)).toBe(true)
  for (const change of [{ deferredCount: 1 }, { summaryChars: 1 }, { declarationChars: 4_500 }]) {
    expect(isAssistantToolDeclarationReceipt({ ...full, ...change })).toBe(false)
  }
})
