export interface WorkflowAndroidUndoFollowUp {
  readonly count: number
  readonly toolName: 'android.files.undo_operations'
  readonly summary: string
}

export interface WorkflowAndroidUndoFollowUpObservation {
  readonly output?: string
}

export interface WorkflowAndroidUndoFollowUpStep {
  readonly observation?: WorkflowAndroidUndoFollowUpObservation
}

export interface WorkflowAndroidUndoFollowUpRun {
  readonly steps: readonly WorkflowAndroidUndoFollowUpStep[]
}

export function buildWorkflowAndroidUndoFollowUp(
  run: WorkflowAndroidUndoFollowUpRun,
): WorkflowAndroidUndoFollowUp | undefined {
  const undoOperationCount = run.steps
    .map((step) => parseUndoOperationCount(step.observation?.output))
    .find((count) => count !== undefined && count > 0)
  if (!undoOperationCount) return undefined

  return {
    count: undoOperationCount,
    toolName: 'android.files.undo_operations',
    summary: `Undo available for ${undoOperationCount} reversible Android SAF move operation(s). Reversal must use android.files.undo_operations from a visible user confirmation; delete-based undo remains unsupported.`,
  }
}

export function appendWorkflowAndroidUndoFollowUp(
  output: string | undefined,
  followUp: WorkflowAndroidUndoFollowUp | undefined,
): string | undefined {
  if (!followUp) return output
  return [
    output,
    [
      'Android undo available.',
      `Undo operations: ${followUp.count}`,
      'Requires visible confirmation through android.files.undo_operations.',
      'Delete-based undo remains unsupported.',
    ].join('\n'),
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function projectWorkflowAndroidUndoFollowUpMetadata(
  followUp: WorkflowAndroidUndoFollowUp | undefined,
): Record<string, unknown> {
  if (!followUp) return {}
  return {
    androidUndoOperationCount: followUp.count,
    androidUndoToolName: followUp.toolName,
    androidUndoRequiresVisibleConfirmation: true,
    androidUndoSummary: followUp.summary,
  }
}

function parseUndoOperationCount(value: string | undefined): number | undefined {
  if (!value) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isPlainRecord(parsed)) return undefined
    const undoOperations = parsed.undoOperations
    return Array.isArray(undoOperations) && undoOperations.length
      ? undoOperations.length
      : undefined
  } catch {
    return undefined
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
