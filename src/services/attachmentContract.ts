import type { Attachment } from '@/types'

export function attachmentHasPayload(attachment: Attachment | null | undefined): attachment is Attachment & { base64: string } {
  return typeof attachment?.base64 === 'string' && attachment.base64.length > 0
}

export function filterSendableAttachments(attachments: Attachment[] | undefined): Attachment[] {
  return (attachments ?? []).filter(attachmentHasPayload)
}

export function sanitizeAttachmentForPersistence(attachment: Attachment): Attachment {
  return {
    ...attachment,
    uri: isPersistableAttachmentUri(attachment.uri) ? attachment.uri : '',
    base64: undefined,
  }
}

export function sanitizeAttachmentsForPersistence(attachments: Attachment[] | undefined): Attachment[] | undefined {
  if (!attachments?.length) return undefined
  return attachments.map(sanitizeAttachmentForPersistence)
}

function isPersistableAttachmentUri(uri: string | undefined): boolean {
  if (!uri) return false
  try {
    const parsed = new URL(uri)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}
