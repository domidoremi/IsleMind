import type { ProviderContentPart } from './providerContentParts'
import { toTextContent } from './providerContentParts'
import type { ProviderToolCall } from './providerToolCalls'
import { toOpenAIChatToolCall } from './providerToolReplay'
import { mergeProviderToolDeclarations } from './providerToolDeclarations'

export type OpenAIChatReasoningReplayField = 'reasoning' | 'reasoning_content'
export type OpenAIChatMaxTokensField = 'max_completion_tokens' | 'max_tokens'

export interface OpenAIChatRequestMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string | readonly ProviderContentPart[]
  reasoningContent?: string
  toolCallId?: string
  name?: string
  toolCalls?: readonly ProviderToolCall[]
}

export interface OpenAIChatRequestShape {
  model: string
  messages: readonly OpenAIChatRequestMessage[]
  systemPrompt?: string
  contextPrompt?: string
  stream?: boolean
}

export interface OpenAIChatRequestParameters {
  temperature?: number
  topP?: number
  topK?: number
  maxTokens?: number
}

export interface OpenAIChatReasoningPolicy {
  deepSeekThinking?: { type: 'enabled' | 'disabled'; effort?: string }
  dashScopeThinking?: { enabled: boolean; budget?: number }
  siliconFlowThinking?: { budget: number }
  kimiThinking?: { type: 'enabled' | 'disabled' }
  kimiPreservedThinking?: { type: 'enabled'; keep: 'all' }
  miniMaxThinking?: { type: 'adaptive' | 'disabled' }
  miniMaxReasoningSplit: boolean
  openAIReasoningEffort?: string
  mimoThinking?: { type: 'enabled' | 'disabled' }
  omitSampling: boolean
}

export interface OpenAIChatRequestBodyBuilderDependencies<
  Request extends OpenAIChatRequestShape,
  Attachment,
> {
  selectAttachments(request: Request): readonly Attachment[]
  buildAttachmentPart(request: Request, attachment: Attachment): Record<string, unknown>
  resolveReasoningReplayField(
    request: Request,
    message: OpenAIChatRequestMessage,
  ): OpenAIChatReasoningReplayField | undefined
  resolveDeclaredTools(request: Request): readonly unknown[] | undefined
  resolveNativeSearchTool(request: Request): Record<string, unknown> | undefined
  includeStreamUsage(request: Request): boolean
  resolveResponseFormat(request: Request): Record<string, unknown> | undefined
  resolveReasoningPolicy(request: Request): OpenAIChatReasoningPolicy
  resolveMaxTokensField(request: Request): OpenAIChatMaxTokensField
  resolveRequestParameters(
    request: Request,
    options: { omitSampling: boolean; maxTokensField: OpenAIChatMaxTokensField },
  ): OpenAIChatRequestParameters
}

export interface OpenAIChatRequestBodyBuilder<Request extends OpenAIChatRequestShape> {
  build(request: Request): Record<string, unknown>
}

/**
 * Owns OpenAI Chat-compatible message and request-body assembly while
 * provider/model capability and reasoning decisions remain injected.
 */
export function createOpenAIChatRequestBodyBuilder<
  Request extends OpenAIChatRequestShape,
  Attachment,
>(
  dependencies: OpenAIChatRequestBodyBuilderDependencies<Request, Attachment>,
): OpenAIChatRequestBodyBuilder<Request> {
  return {
    build(request) {
      const messages: Record<string, unknown>[] = []
      const systemPrompt = [request.systemPrompt, request.contextPrompt].filter(Boolean).join('\n\n')
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })

      for (const message of request.messages) {
        const content = toTextContent(message.content)
        if (message.role === 'tool') {
          messages.push({
            role: 'tool',
            tool_call_id: message.toolCallId,
            ...(message.name ? { name: message.name } : {}),
            content,
          })
          continue
        }
        const reasoningReplayField = message.role === 'assistant' && message.reasoningContent
          ? dependencies.resolveReasoningReplayField(request, message)
          : undefined
        messages.push({
          role: message.role,
          content,
          ...(reasoningReplayField ? { [reasoningReplayField]: message.reasoningContent } : {}),
          ...(message.toolCalls?.length ? { tool_calls: message.toolCalls.map(toOpenAIChatToolCall) } : {}),
        })
      }

      const attachments = dependencies.selectAttachments(request)
      if (attachments.length) {
        const lastMessage = messages[messages.length - 1]
        if (lastMessage && lastMessage.role === 'user') {
          const content = lastMessage.content
          const textContent = typeof content === 'string'
            ? content
            : Array.isArray(content)
              ? content.map((part) => asText(part)).join('\n')
              : ''
          lastMessage.content = [
            { type: 'text', text: textContent },
            ...attachments.map((attachment) => dependencies.buildAttachmentPart(request, attachment)),
          ]
        }
      }

      const body: Record<string, unknown> = {
        model: request.model,
        messages,
        stream: request.stream ?? true,
      }
      const nativeSearchTool = dependencies.resolveNativeSearchTool(request)
      const tools = mergeProviderToolDeclarations(
        dependencies.resolveDeclaredTools(request),
        nativeSearchTool ? [nativeSearchTool] : [],
      )
      if (tools) body.tools = tools
      if (nativeSearchTool) body.tool_choice = 'auto'
      if ((request.stream ?? true) !== false && dependencies.includeStreamUsage(request)) {
        body.stream_options = { include_usage: true }
      }
      const responseFormat = dependencies.resolveResponseFormat(request)
      if (responseFormat) body.response_format = responseFormat

      const reasoning = dependencies.resolveReasoningPolicy(request)
      const maxTokensField = dependencies.resolveMaxTokensField(request)
      const requestParameters = dependencies.resolveRequestParameters(request, {
        omitSampling: reasoning.omitSampling,
        maxTokensField,
      })
      if (requestParameters.temperature !== undefined) body.temperature = requestParameters.temperature
      if (requestParameters.topP !== undefined) body.top_p = requestParameters.topP
      if (requestParameters.topK !== undefined) body.top_k = requestParameters.topK

      if (reasoning.deepSeekThinking) {
        body.thinking = { type: reasoning.deepSeekThinking.type }
        if (reasoning.deepSeekThinking.effort) body.reasoning_effort = reasoning.deepSeekThinking.effort
      } else {
        if (reasoning.dashScopeThinking) {
          body.enable_thinking = reasoning.dashScopeThinking.enabled
          if (reasoning.dashScopeThinking.budget !== undefined) body.thinking_budget = reasoning.dashScopeThinking.budget
        }
        if (reasoning.siliconFlowThinking) body.thinking_budget = reasoning.siliconFlowThinking.budget
        if (reasoning.kimiPreservedThinking) body.thinking = reasoning.kimiPreservedThinking
        else if (reasoning.kimiThinking) body.thinking = reasoning.kimiThinking
        if (reasoning.miniMaxThinking) body.thinking = reasoning.miniMaxThinking
        if (reasoning.miniMaxReasoningSplit) body.reasoning_split = true
        if (reasoning.openAIReasoningEffort) body.reasoning_effort = reasoning.openAIReasoningEffort
        if (reasoning.mimoThinking) body.thinking = reasoning.mimoThinking
      }

      if (requestParameters.maxTokens !== undefined) body[maxTokensField] = requestParameters.maxTokens
      return body
    },
  }
}

function asText(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  return typeof (value as Record<string, unknown>).text === 'string'
    ? (value as Record<string, unknown>).text as string
    : ''
}
