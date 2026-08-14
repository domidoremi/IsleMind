import type { ProviderContentPart } from './providerContentParts'
import { toGoogleContentParts } from './providerContentParts'
import { mergeProviderToolDeclarations } from './providerToolDeclarations'

export interface GoogleRequestMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string | readonly ProviderContentPart[]
}

export interface GoogleRequestShape {
  messages: readonly GoogleRequestMessage[]
  systemPrompt?: string
  contextPrompt?: string
}

export interface GoogleRequestParameters {
  maxTokens?: number
  temperature?: number
  topP?: number
  topK?: number
}

export interface GoogleRequestBodyBuilderDependencies<
  Request extends GoogleRequestShape,
  Attachment,
> {
  selectAttachments(request: Request): readonly Attachment[]
  buildAttachmentPart(attachment: Attachment): Record<string, unknown> | undefined
  resolveRequestParameters(request: Request): GoogleRequestParameters
  resolveThinkingConfig(request: Request): Record<string, unknown> | undefined
  resolveStructuredOutputConfig(request: Request): Record<string, unknown> | undefined
  resolveDeclaredTools(request: Request): readonly unknown[] | undefined
  resolveNativeSearchTool(request: Request): Record<string, unknown> | undefined
}

export interface GoogleRequestBodyBuilder<Request extends GoogleRequestShape> {
  build(request: Request): Record<string, unknown>
}

/**
 * Owns Gemini content, generation-config, and tool request assembly while
 * provider/model capability decisions remain injected.
 */
export function createGoogleRequestBodyBuilder<
  Request extends GoogleRequestShape,
  Attachment,
>(
  dependencies: GoogleRequestBodyBuilderDependencies<Request, Attachment>,
): GoogleRequestBodyBuilder<Request> {
  return {
    build(request) {
      const contents: Record<string, unknown>[] = []
      const attachments = dependencies.selectAttachments(request)
      const systemPrompt = [request.systemPrompt, request.contextPrompt].filter(Boolean).join('\n\n')
      const systemInstruction = systemPrompt
        ? { parts: [{ text: systemPrompt }] }
        : undefined

      for (const message of request.messages) {
        const parts = toGoogleContentParts(message.content)
        if (message.role === 'user' && message === request.messages[request.messages.length - 1] && attachments.length) {
          for (const attachment of attachments) {
            const part = dependencies.buildAttachmentPart(attachment)
            if (part) parts.push(part)
          }
        }
        contents.push({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts,
        })
      }

      const requestParameters = dependencies.resolveRequestParameters(request)
      const generationConfig: Record<string, unknown> = {}
      if (requestParameters.maxTokens !== undefined) generationConfig.maxOutputTokens = requestParameters.maxTokens
      if (requestParameters.temperature !== undefined) generationConfig.temperature = requestParameters.temperature
      if (requestParameters.topP !== undefined) generationConfig.topP = requestParameters.topP
      if (requestParameters.topK !== undefined) generationConfig.topK = requestParameters.topK
      const thinkingConfig = dependencies.resolveThinkingConfig(request)
      if (thinkingConfig) generationConfig.thinkingConfig = thinkingConfig
      const structuredOutputConfig = dependencies.resolveStructuredOutputConfig(request)
      if (structuredOutputConfig) Object.assign(generationConfig, structuredOutputConfig)

      const nativeSearchTool = dependencies.resolveNativeSearchTool(request)
      const tools = mergeProviderToolDeclarations(
        dependencies.resolveDeclaredTools(request),
        nativeSearchTool ? [nativeSearchTool] : [],
      )
      return {
        contents,
        systemInstruction,
        generationConfig,
        ...(tools ? { tools } : {}),
      }
    },
  }
}
