import type { Attachment } from '@/types/chatContracts'

export type ComposerDraftKey = string | number

export type ComposerInitialDraftDecision =
  | { kind: 'ignore' }
  | { kind: 'preserve-current' }
  | {
    kind: 'apply'
    draftKey: ComposerDraftKey
    content: string
    attachments: Attachment[]
  }

export function resolveComposerInitialDraft(input: {
  initialDraft?: string
  initialDraftKey?: ComposerDraftKey
  initialAttachments?: Attachment[]
  consumedDraftKey?: ComposerDraftKey
  restoreInitialDraftIfEmpty: boolean
  currentContent: string
  currentAttachmentCount: number
}): ComposerInitialDraftDecision {
  const content = input.initialDraft ?? ''
  const attachments = input.initialAttachments ?? []
  if (!content.trim() && attachments.length === 0) return { kind: 'ignore' }

  const draftKey = input.initialDraftKey
    ?? [content, ...attachments.map((attachment) => `${attachment.id}:${attachment.uri}`)].join('|')
  if (input.consumedDraftKey === draftKey) return { kind: 'ignore' }
  if (input.restoreInitialDraftIfEmpty && (input.currentContent.trim() || input.currentAttachmentCount > 0)) {
    return { kind: 'preserve-current' }
  }

  return { kind: 'apply', draftKey, content, attachments }
}

export function resolveAppliedInitialDraftKeyAfterSuccessfulSend(
  appliedInitialDraftKey: ComposerDraftKey | undefined,
  currentInitialDraftKey: ComposerDraftKey | undefined,
): ComposerDraftKey | undefined {
  return currentInitialDraftKey !== undefined && appliedInitialDraftKey === currentInitialDraftKey
    ? undefined
    : appliedInitialDraftKey
}

export function restoreRejectedComposerText(currentContent: string, sentContent: string): string {
  return currentContent ? currentContent : sentContent
}

export function restoreRejectedComposerAttachments(
  currentAttachments: Attachment[],
  sentAttachments: Attachment[],
): Attachment[] {
  return currentAttachments.length > 0 ? currentAttachments : sentAttachments
}

export function resolveExternalSubmitKey(input: {
  externalSubmitKey?: ComposerDraftKey
  consumedExternalSubmitKey?: ComposerDraftKey
  canSend: boolean
}): ComposerDraftKey | undefined {
  if (input.externalSubmitKey === undefined) return undefined
  if (input.consumedExternalSubmitKey === input.externalSubmitKey) return undefined
  return input.canSend ? input.externalSubmitKey : undefined
}
