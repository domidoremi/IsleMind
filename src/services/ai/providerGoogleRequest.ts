import type { Attachment } from '@/types'

export function googleAttachmentPart(attachment: Attachment): Record<string, unknown> | undefined {
  if (!attachment.base64) return undefined
  return {
    inline_data: {
      mime_type: attachment.mimeType,
      data: attachment.base64,
    },
  }
}

export function googleNativeWebSearchTool(): Record<string, unknown> {
  return { google_search: {} }
}
