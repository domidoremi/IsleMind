export const CONTEXT_CONTRIBUTION_SCHEMA = 'islemind.context-runtime.v1'

export type ContextContributionLane = 'retrieval' | 'web' | 'tools' | 'tavern'
export type ContextAuthority = 'user-private' | 'external-public' | 'permissioned-tool' | 'local-state'
export type ContextContributionPlannerType = 'retrieved_context' | 'memory' | 'tool_outputs'

export interface ContextContributionInput {
  id: string
  lane: ContextContributionLane
  plannerType: ContextContributionPlannerType
  authority: ContextAuthority
  text?: string
  sourceCount: number
  evidence: Readonly<Record<string, unknown>>
  trace: Readonly<Record<string, unknown>>
}

export interface ContextContribution extends ContextContributionInput {
  schema: typeof CONTEXT_CONTRIBUTION_SCHEMA
  estimatedTokens: number
  budgetPolicy: 'planner-token-cap'
}

export interface ContextContributionPlannerSource {
  id: string
  type: ContextContributionPlannerType
  text?: string
  sourceCount: number
  trace: Record<string, unknown>
}

export interface ContextContributionAssembly {
  schema: typeof CONTEXT_CONTRIBUTION_SCHEMA
  contributions: ContextContribution[]
  contextSources: ContextContributionPlannerSource[]
  trace: {
    schema: typeof CONTEXT_CONTRIBUTION_SCHEMA
    contributionCount: number
    includedContributionCount: number
  }
}

export interface ContextContributionAssembler {
  assemble(inputs: readonly ContextContributionInput[]): ContextContributionAssembly
}

export function createContextContributionAssembler(dependencies: {
  estimateTokens(text: string): number
}): ContextContributionAssembler {
  function assemble(inputs: readonly ContextContributionInput[]): ContextContributionAssembly {
    const contributions = inputs.map((input) => createContribution(input, dependencies.estimateTokens))
    return {
      schema: CONTEXT_CONTRIBUTION_SCHEMA,
      contributions,
      contextSources: contributions.map(toPlannerSource),
      trace: {
        schema: CONTEXT_CONTRIBUTION_SCHEMA,
        contributionCount: contributions.length,
        includedContributionCount: contributions.filter((contribution) => contribution.estimatedTokens > 0).length,
      },
    }
  }

  return { assemble }
}

function createContribution(
  input: ContextContributionInput,
  estimateTokens: (text: string) => number,
): ContextContribution {
  const text = input.text?.trim()
  return {
    ...input,
    schema: CONTEXT_CONTRIBUTION_SCHEMA,
    text,
    estimatedTokens: text ? estimateTokens(text) : 0,
    budgetPolicy: 'planner-token-cap',
  }
}

function toPlannerSource(contribution: ContextContribution): ContextContributionPlannerSource {
  return {
    id: contribution.id,
    type: contribution.plannerType,
    text: contribution.text,
    sourceCount: contribution.sourceCount,
    trace: {
      ...contribution.trace,
      contextRuntime: {
        schema: contribution.schema,
        lane: contribution.lane,
        authority: contribution.authority,
        estimatedTokens: contribution.estimatedTokens,
        budgetPolicy: contribution.budgetPolicy,
        evidence: contribution.evidence,
      },
    },
  }
}
