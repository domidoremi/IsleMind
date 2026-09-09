import type { ProcessTrace, ToolContentBlock } from '@/core'

import type { ConversationToolCatalogManifest } from './conversationToolCatalog'

export const WORK_ARTIFACT_TOOL_ID = 'work-artifact:summarize'
export const WORK_ARTIFACT_TOOL_NAME = 'work_artifact.summarize'

export const WORK_ARTIFACT_TOOL_MANIFEST: ConversationToolCatalogManifest = {
  id: WORK_ARTIFACT_TOOL_ID,
  source: 'work-artifact',
  name: WORK_ARTIFACT_TOOL_NAME,
  description: 'Audit and summarize the structure of an existing or newly drafted work artifact. When the user requests a draft audit, supply the actual drafted text and use the returned gaps before finalizing. This tool does not generate a draft, verify facts or approvals, or execute actions.',
  permission: 'read-only',
  enabled: true,
  inputSchema: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The complete artifact or draft text to audit, not instructions asking for one. For a new draft, compose the draft in this field; no other message is fetched.',
      },
      sourceMessageId: {
        type: 'string',
        description: 'Optional known ID of the message whose text is supplied. Omit for a new draft; do not invent an ID or use a role such as user. This is annotation, not a lookup.',
      },
      citations: {
        type: 'array',
        description: 'Optional retained source labels such as "[1]" or source-reference objects, not numeric indexes. Copy known references only; the audit does not verify their claims.',
        items: {
          type: ['string', 'object'],
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            title: { type: 'string' },
            url: { type: 'string' },
            excerpt: { type: 'string' },
          },
        },
      },
    },
    required: ['content'],
  },
}

export interface WorkArtifactCitationReference {
  id?: string
  label?: string
  title?: string
  url?: string
  excerpt?: string
}

interface WorkArtifactWorkflowItem {
  text?: string
}

export interface WorkArtifactWorkflowOutputShape {
  contract: string
  artifact: {
    hasWorkArtifact: boolean
    language: string
    quality: string
    summary: WorkArtifactWorkflowItem[]
    actionItems: WorkArtifactWorkflowItem[]
    decisions: WorkArtifactWorkflowItem[]
    risks: WorkArtifactWorkflowItem[]
    openQuestions: WorkArtifactWorkflowItem[]
    sourceEvidence: WorkArtifactWorkflowItem[]
    handoffText: string
    primaryNextStep?: string
    qualitySummary: string
    followUpPrompt: string
  }
  qualityAudit: {
    ok: boolean
    errors: unknown[]
    warnings: unknown[]
  }
  qualityGaps: unknown[]
  sourceEvidence: WorkArtifactWorkflowItem[]
  sourceMessageId?: string
  citations: WorkArtifactCitationReference[]
  hasWorkArtifact: boolean
  quality: string
  actionItemCount: number
  decisionCount: number
  riskCount: number
  openQuestionCount: number
  evidenceCount: number
  missingKinds: string[]
  primaryNextStep?: string
  qualitySummary: string
  followUpPrompt: string
  handoffText: string
}

export interface WorkArtifactTaskResult {
  ok: boolean
  status: 'done' | 'error' | 'skipped'
  output: string
  blocks: ToolContentBlock[]
  trace: ProcessTrace
  errorCode?: 'cancelled' | 'execution_failed'
  metadata?: Record<string, unknown>
}

export interface WorkArtifactTaskAdapterDependencies {
  buildWorkflowOutput(
    content: string,
    options: { sourceMessageId?: string; citations: WorkArtifactCitationReference[] },
  ): WorkArtifactWorkflowOutputShape
  sanitizeOutput(output: string): string
  clampOutput(output: string, limit: number): string
  createTrace(trace: ProcessTrace): ProcessTrace
  now?(): number
}

export interface WorkArtifactTaskAdapter {
  manifest: typeof WORK_ARTIFACT_TOOL_MANIFEST
  execute(input: {
    toolId: string
    arguments: Record<string, unknown>
    signal?: AbortSignal
    startedAt?: number
  }): WorkArtifactTaskResult
}

export function resolveTaskBoundInternalToolAdapter(
  manifest: Pick<ConversationToolCatalogManifest, 'id' | 'source'>,
  dependencies: WorkArtifactTaskAdapterDependencies,
): WorkArtifactTaskAdapter | undefined {
  return manifest.id === WORK_ARTIFACT_TOOL_ID && manifest.source === 'work-artifact'
    ? createWorkArtifactTaskAdapter(dependencies)
    : undefined
}

/**
 * Internal tools use a task-bound adapter without becoming external integration
 * sources. The stable tool ID is checked at execution so replay cannot bind a
 * persisted work-artifact task to another executor.
 */
export function createWorkArtifactTaskAdapter(
  dependencies: WorkArtifactTaskAdapterDependencies,
): WorkArtifactTaskAdapter {
  return {
    manifest: WORK_ARTIFACT_TOOL_MANIFEST,
    execute(input) {
      if (input.toolId !== WORK_ARTIFACT_TOOL_ID) {
        throw new Error(`Work artifact task is not bound to ${WORK_ARTIFACT_TOOL_ID}.`)
      }
      const startedAt = input.startedAt ?? dependencies.now?.() ?? Date.now()
      if (input.signal?.aborted) return cancelledResult(startedAt, dependencies)

      const workflowOutput = dependencies.buildWorkflowOutput(
        typeof input.arguments.content === 'string' ? input.arguments.content : '',
        {
          sourceMessageId: typeof input.arguments.sourceMessageId === 'string'
            ? input.arguments.sourceMessageId
            : undefined,
          citations: normalizeCitationArguments(input.arguments.citations),
        },
      )
      if (input.signal?.aborted) return cancelledResult(startedAt, dependencies)

      const output = dependencies.sanitizeOutput(formatSummary(workflowOutput))
      const compactOutput = buildCompactOutput(workflowOutput, dependencies.clampOutput)
      return {
        ok: true,
        status: 'done',
        output,
        blocks: [{ type: 'text', text: output }],
        trace: dependencies.createTrace({
          id: `agent-tool-${WORK_ARTIFACT_TOOL_ID}-${startedAt}`,
          type: 'tool',
          title: `Agent ${WORK_ARTIFACT_TOOL_NAME}`,
          content: `contract=${workflowOutput.contract} · quality=${workflowOutput.quality} · evidence=${workflowOutput.evidenceCount} · gaps=${workflowOutput.qualityGaps.length} · next=${workflowOutput.primaryNextStep ? 'present' : 'missing'}`,
          status: 'done',
          startedAt,
          metadata: {
            contract: workflowOutput.contract,
            source: 'work-artifact',
            quality: workflowOutput.quality,
            qualityAuditOk: workflowOutput.qualityAudit.ok,
            evidenceCount: workflowOutput.evidenceCount,
            sourceEvidenceCount: workflowOutput.sourceEvidence.length,
            qualityGapCount: workflowOutput.qualityGaps.length,
            qualityGapCodes: workflowOutput.qualityGaps.map(qualityGapCode),
            missingKinds: workflowOutput.missingKinds,
            primaryNextStep: workflowOutput.primaryNextStep,
            qualitySummary: workflowOutput.qualitySummary,
            followUpPrompt: workflowOutput.followUpPrompt,
            workArtifactOutput: compactOutput,
          },
        }),
      }
    },
  }
}

function cancelledResult(
  startedAt: number,
  dependencies: WorkArtifactTaskAdapterDependencies,
): WorkArtifactTaskResult {
  const output = 'Agent workflow execution was cancelled.'
  const metadata = {
    toolId: WORK_ARTIFACT_TOOL_ID,
    source: 'work-artifact',
    permission: 'read-only',
    errorCode: 'cancelled',
    status: 'cancelled',
    failureCode: 'cancelled',
  }
  return {
    ok: false,
    status: 'skipped',
    output,
    blocks: [{ type: 'text', text: output }],
    trace: dependencies.createTrace({
      id: `agent-tool-cancelled-${WORK_ARTIFACT_TOOL_ID}-${startedAt}`,
      type: 'system',
      title: 'Agent cancelled',
      content: output,
      status: 'skipped',
      startedAt,
      metadata,
    }),
    errorCode: 'cancelled',
    metadata,
  }
}

function formatSummary(workflowOutput: WorkArtifactWorkflowOutputShape): string {
  const missing = workflowOutput.missingKinds.length ? workflowOutput.missingKinds.join(', ') : 'none'
  // Human follow-up text is an opt-in UI affordance, not a new model task.
  // Keep the template audit intact without treating every category as requested.
  return [
    'Work-artifact structural audit (advisory only).',
    'This checks a general artifact template, not factual accuracy, approvals, or completion of the user task.',
    `Structural quality: ${workflowOutput.quality}; qualityAudit.ok=${workflowOutput.qualityAudit.ok}`,
    `Coverage: actions=${workflowOutput.actionItemCount}, decisions=${workflowOutput.decisionCount}, risks=${workflowOutput.riskCount}, questions=${workflowOutput.openQuestionCount}, evidence=${workflowOutput.evidenceCount}`,
    `Absent template categories: ${missing}`,
    `Template diagnostics: ${JSON.stringify(workflowOutput.qualityGaps)}`,
    'Absent categories are not automatically user requirements or missing source facts. Address findings only where relevant to the requested deliverable.',
    'Complete the requested answer from the available sources, retaining recorded constraints, owners, dates, and pending or unknown statuses. If needed facts are absent, say so. Do not invent facts or approvals, claim unperformed actions, or ask the user to fill generic template sections.',
  ].join('\n')
}

function buildCompactOutput(
  workflowOutput: WorkArtifactWorkflowOutputShape,
  clampOutput: (output: string, limit: number) => string,
): Record<string, unknown> {
  return {
    contract: workflowOutput.contract,
    artifact: {
      hasWorkArtifact: workflowOutput.artifact.hasWorkArtifact,
      language: workflowOutput.artifact.language,
      quality: workflowOutput.artifact.quality,
      summary: compactItems(workflowOutput.artifact.summary, clampOutput),
      actionItems: compactItems(workflowOutput.artifact.actionItems, clampOutput),
      decisions: compactItems(workflowOutput.artifact.decisions, clampOutput),
      risks: compactItems(workflowOutput.artifact.risks, clampOutput),
      openQuestions: compactItems(workflowOutput.artifact.openQuestions, clampOutput),
      sourceEvidence: compactItems(workflowOutput.artifact.sourceEvidence, clampOutput),
      handoffText: clampOutput(workflowOutput.artifact.handoffText, 720),
      primaryNextStep: workflowOutput.artifact.primaryNextStep,
      qualitySummary: workflowOutput.artifact.qualitySummary,
      followUpPrompt: clampOutput(workflowOutput.artifact.followUpPrompt, 480),
    },
    qualityAudit: workflowOutput.qualityAudit,
    qualityGaps: workflowOutput.qualityGaps,
    sourceEvidence: compactItems(workflowOutput.sourceEvidence, clampOutput),
    sourceMessageId: workflowOutput.sourceMessageId,
    citations: workflowOutput.citations,
    hasWorkArtifact: workflowOutput.hasWorkArtifact,
    quality: workflowOutput.quality,
    actionItemCount: workflowOutput.actionItemCount,
    decisionCount: workflowOutput.decisionCount,
    riskCount: workflowOutput.riskCount,
    openQuestionCount: workflowOutput.openQuestionCount,
    evidenceCount: workflowOutput.evidenceCount,
    missingKinds: workflowOutput.missingKinds,
    primaryNextStep: workflowOutput.primaryNextStep,
    qualitySummary: workflowOutput.qualitySummary,
    followUpPrompt: clampOutput(workflowOutput.followUpPrompt, 480),
    handoffText: clampOutput(workflowOutput.handoffText, 720),
  }
}

function compactItems<T extends WorkArtifactWorkflowItem>(
  items: T[],
  clampOutput: (output: string, limit: number) => string,
): T[] {
  return items.slice(0, 12).map((item) => ({
    ...item,
    ...(typeof item.text === 'string' ? { text: clampOutput(item.text, 280) } : {}),
  }))
}

function normalizeCitationArguments(value: unknown): WorkArtifactCitationReference[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (typeof item === 'string') {
        const label = item.trim()
        return label ? { label } : undefined
      }
      if (!item || typeof item !== 'object') return undefined
      const record = item as Record<string, unknown>
      return {
        ...(typeof record.id === 'string' ? { id: record.id } : {}),
        ...(typeof record.label === 'string' ? { label: record.label } : {}),
        ...(typeof record.title === 'string' ? { title: record.title } : {}),
        ...(typeof record.url === 'string' ? { url: record.url } : {}),
        ...(typeof record.excerpt === 'string' ? { excerpt: record.excerpt } : {}),
      }
    })
    .filter((item): item is WorkArtifactCitationReference => Boolean(item && Object.keys(item).length))
}

function qualityGapCode(value: unknown): unknown {
  return value && typeof value === 'object' ? (value as { code?: unknown }).code : undefined
}
