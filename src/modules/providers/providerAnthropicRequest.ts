import type { AIProvider } from '@/types/providerContracts'
import type { ProviderContentPart } from './providerContentParts'
import { toAnthropicContentBlocks } from './providerContentParts'
import { providerNativeRemoteCompactEvidenceMatchesProvider } from './providerCompatibilityCatalog'
import { buildAnthropicNativeContextManagement } from './providerContextManagementPolicy'
import { sanitizeAnthropicReplayContentBlocks } from './providerReplay'
import { mergeProviderToolDeclarations } from './providerToolDeclarations'

export interface AnthropicRequestMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string | readonly ProviderContentPart[]
  providerContentBlocks?: readonly Record<string, unknown>[]
}

export interface AnthropicRequestShape {
  provider?: AIProvider
  model: string
  messages: readonly AnthropicRequestMessage[]
  systemPrompt?: string
  contextPrompt?: string
  stream?: boolean
  remoteCompactEligible?: boolean
  settings?: {
    remoteCompactThresholdTokens?: number
  }
}

export interface AnthropicRequestParameters {
  maxTokens?: number
  temperature?: number
  topP?: number
  topK?: number
}

export interface AnthropicRequestReasoningPolicy {
  thinkingConfig?: {
    thinking?: Record<string, unknown>
    outputConfig?: Record<string, unknown>
  }
  miniMaxThinking?: { type: 'adaptive' | 'disabled' }
  mimoThinking?: { type: 'enabled' | 'disabled' }
  omitSampling: boolean
}

export interface AnthropicRequestBodyBuilderDependencies<
  Request extends AnthropicRequestShape,
  Attachment,
> {
  selectAttachments(request: Request): readonly Attachment[]
  buildAttachmentPart(attachment: Attachment): Record<string, unknown> | undefined
  resolveDeclaredTools(request: Request): readonly unknown[] | undefined
  resolveNativeSearchTool(request: Request): Record<string, unknown> | undefined
  resolveStructuredOutputTool(request: Request): Record<string, unknown> | undefined
  resolveReasoningPolicy(request: Request): AnthropicRequestReasoningPolicy
  resolveRequestParameters(
    request: Request,
    options: { omitSampling: boolean },
  ): AnthropicRequestParameters
}

export interface AnthropicRequestBodyBuilder<Request extends AnthropicRequestShape> {
  build(request: Request): Record<string, unknown>
}

/**
 * Owns Anthropic-compatible content replay and request-body assembly while
 * provider/model capability and thinking decisions remain injected.
 */
export function createAnthropicRequestBodyBuilder<
  Request extends AnthropicRequestShape,
  Attachment,
>(
  dependencies: AnthropicRequestBodyBuilderDependencies<Request, Attachment>,
): AnthropicRequestBodyBuilder<Request> {
  return {
    build(request) {
      const system = [request.systemPrompt, request.contextPrompt].filter(Boolean).join('\n\n') || undefined
      const messages: Record<string, unknown>[] = []
      const attachments = dependencies.selectAttachments(request)

      for (const message of request.messages) {
        if (message.role === 'user') {
          const content = toAnthropicContentBlocks(message.content)
          if (attachments.length && message === request.messages[request.messages.length - 1]) {
            for (const attachment of attachments) {
              const part = dependencies.buildAttachmentPart(attachment)
              if (part) content.push(part)
            }
          }
          messages.push({ role: 'user', content })
        } else if (message.role === 'assistant') {
          const content = [
            ...sanitizeAnthropicReplayContentBlocks(message.providerContentBlocks ?? []),
            ...toAnthropicContentBlocks(message.content),
          ]
          messages.push({
            role: 'assistant',
            content: !message.providerContentBlocks?.length && content.length === 1 && content[0].type === 'text'
              ? stringValue(content[0].text)
              : content,
          })
        }
      }

      const nativeSearchTool = dependencies.resolveNativeSearchTool(request)
      const structuredOutputTool = dependencies.resolveStructuredOutputTool(request)
      const tools = mergeProviderToolDeclarations(
        dependencies.resolveDeclaredTools(request),
        [nativeSearchTool, structuredOutputTool].filter((tool): tool is Record<string, unknown> => !!tool),
      )
      const reasoning = dependencies.resolveReasoningPolicy(request)
      const requestParameters = dependencies.resolveRequestParameters(request, {
        omitSampling: reasoning.omitSampling,
      })
      const body: Record<string, unknown> = {
        model: request.model,
        system,
        messages,
        stream: request.stream ?? true,
        ...(tools ? { tools } : {}),
      }
      if (requestParameters.maxTokens !== undefined) body.max_tokens = requestParameters.maxTokens
      if (structuredOutputTool) body.tool_choice = { type: 'tool', name: structuredOutputTool.name }
      if (requestParameters.temperature !== undefined) body.temperature = requestParameters.temperature
      if (requestParameters.topP !== undefined) body.top_p = requestParameters.topP
      if (requestParameters.topK !== undefined) body.top_k = requestParameters.topK
      if (reasoning.thinkingConfig?.thinking) body.thinking = reasoning.thinkingConfig.thinking
      if (reasoning.thinkingConfig?.outputConfig) body.output_config = reasoning.thinkingConfig.outputConfig
      if (reasoning.miniMaxThinking) body.thinking = reasoning.miniMaxThinking
      if (reasoning.mimoThinking) body.thinking = reasoning.mimoThinking
      // Official server-side compaction (beta compact-2026-01-12). Header is added in providerHeaders.
      if (anthropicNativeRemoteCompactAllowed(request)) {
        body.context_management = buildAnthropicNativeContextManagement({
          thresholdTokens: request.settings?.remoteCompactThresholdTokens ?? 150_000,
        })
      }
      return body
    },
  }
}

export function anthropicNativeRemoteCompactAllowed(
  request: Pick<AnthropicRequestShape, 'provider' | 'remoteCompactEligible'>,
): boolean {
  const provider = request.provider
  return request.remoteCompactEligible === true &&
    provider !== undefined &&
    provider.type === 'anthropic' &&
    provider.wireProtocol === undefined &&
    provider.capabilities?.remoteCompact === true &&
    providerNativeRemoteCompactEvidenceMatchesProvider(provider)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
