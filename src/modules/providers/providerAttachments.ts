import type { AIProvider } from '@/types/providerContracts'
import { isPerplexityProvider } from './providerIdentityPolicy'

export interface ProviderAttachment {
  type: 'image' | 'pdf' | 'text' | 'document'
  name: string
  mimeType: string
  base64?: string
}

export interface ProviderAttachmentEncodingRequest {
  provider: AIProvider
}

export interface ProviderAttachmentEncodingPolicy<
  Request extends ProviderAttachmentEncodingRequest,
  Attachment extends ProviderAttachment,
> {
  openAIChat(request: Request, attachment: Attachment): Record<string, unknown>
  openAIResponses(attachment: Attachment): Record<string, unknown>
  anthropic(attachment: Attachment): Record<string, unknown> | undefined
  google(attachment: Attachment): Record<string, unknown> | undefined
}

/** Owns protocol attachment encoding, including Perplexity URL-mode files. */
export function createProviderAttachmentEncodingPolicy<
  Request extends ProviderAttachmentEncodingRequest,
  Attachment extends ProviderAttachment,
>(): ProviderAttachmentEncodingPolicy<Request, Attachment> {
  return {
    openAIChat(request, attachment) {
      return buildOpenAIChatAttachmentPart(
        attachment,
        isPerplexityProvider(request.provider) ? 'url' : 'inline',
      )
    },
    openAIResponses: buildOpenAIResponsesAttachmentPart,
    anthropic: buildAnthropicAttachmentPart,
    google: buildGoogleAttachmentPart,
  }
}

export function buildAnthropicAttachmentPart(attachment: ProviderAttachment): Record<string, unknown> | undefined {
  if (!attachment.base64) return undefined
  if (attachment.type !== 'image' && attachment.type !== 'pdf' && attachment.type !== 'text') return undefined
  return {
    type: attachment.type === 'image' ? 'image' : 'document',
    source: {
      type: 'base64',
      media_type: attachment.mimeType,
      data: attachment.base64,
    },
  }
}

export function buildGoogleAttachmentPart(attachment: ProviderAttachment): Record<string, unknown> | undefined {
  if (!attachment.base64) return undefined
  return { inline_data: { mime_type: attachment.mimeType, data: attachment.base64 } }
}

export function buildOpenAIChatAttachmentPart(attachment: ProviderAttachment, fileMode: 'inline' | 'url' = 'inline'): Record<string, unknown> {
  if (attachment.type === 'image') {
    return { type: 'image_url', image_url: { url: dataUrl(attachment), detail: 'auto' } }
  }
  if (fileMode === 'url') return { type: 'file_url', file_url: { url: attachment.base64 ?? '' } }
  return { type: 'file', file: { filename: attachment.name, file_data: dataUrl(attachment) } }
}

export function buildOpenAIResponsesAttachmentPart(attachment: ProviderAttachment): Record<string, unknown> {
  return attachment.type === 'image'
    ? { type: 'input_image', image_url: dataUrl(attachment) }
    : { type: 'input_file', filename: attachment.name, file_data: dataUrl(attachment) }
}

export interface ProviderAttachmentSelectionInput<Attachment extends ProviderSelectableAttachment> {
  attachments?: readonly Attachment[]
  imageInputSupported?: boolean
  fileInputSupported?: boolean
  visionCapabilityAllowed?: boolean
  filesCapabilityAllowed?: boolean
}

export interface ProviderSelectableAttachment {
  type: string
  base64?: string
}

export function selectProviderRequestAttachments<Attachment extends ProviderSelectableAttachment>(
  input: ProviderAttachmentSelectionInput<Attachment>,
): Attachment[] {
  const imageAllowed = input.imageInputSupported === true && input.visionCapabilityAllowed === true
  const fileAllowed = input.fileInputSupported === true && input.filesCapabilityAllowed === true
  return (input.attachments ?? []).filter((attachment) => {
    if (typeof attachment.base64 !== 'string' || attachment.base64.length === 0) return false
    return attachment.type === 'image' ? imageAllowed : fileAllowed
  })
}

function dataUrl(attachment: ProviderAttachment): string {
  return `data:${attachment.mimeType};base64,${attachment.base64 ?? ''}`
}
