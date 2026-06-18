import type { Attachment } from '@/types'

export function anthropicAttachmentPart(attachment: Attachment): Record<string, unknown> | undefined {
  if (!attachment.base64) return undefined
  if (attachment.type === 'image') {
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: attachment.mimeType,
        data: attachment.base64,
      },
    }
  }
  if (attachment.type === 'pdf' || attachment.type === 'text') {
    return {
      type: 'document',
      source: {
        type: 'base64',
        media_type: attachment.mimeType,
        data: attachment.base64,
      },
    }
  }
  return undefined
}

export function anthropicNativeWebSearchTool(modelId: string): Record<string, unknown> {
  return {
    type: supportsAnthropicDynamicWebSearch(modelId) ? 'web_search_20260209' : 'web_search_20250305',
    name: 'web_search',
    max_uses: 3,
  }
}

export function supportsAnthropicDynamicWebSearch(modelId: string): boolean {
  const normalized = modelId.toLowerCase().split('/').at(-1) ?? modelId.toLowerCase()
  return /^claude-(fable-5|mythos-5|mythos-preview|opus-4-[678]|sonnet-4-6)/.test(normalized)
}
