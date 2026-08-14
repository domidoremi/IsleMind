export interface ProviderContentPart {
  type: 'text' | 'function_call' | 'function_response' | 'tool_use' | 'tool_result'
  text: string
  functionCall?: Record<string, unknown>
  functionResponse?: Record<string, unknown>
  toolUse?: Record<string, unknown>
  toolResult?: Record<string, unknown>
  thoughtSignature?: string
}

export function toTextContent(content: string | readonly ProviderContentPart[]): string {
  return typeof content === 'string' ? content : content.map((part) => part.text).filter(Boolean).join('\n')
}

export function toAnthropicContentBlocks(content: string | readonly ProviderContentPart[]): Record<string, unknown>[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  const blocks: Record<string, unknown>[] = []
  for (const part of content) {
    if (part.toolUse) {
      blocks.push({
        type: 'tool_use',
        ...part.toolUse,
      })
      continue
    }
    if (part.toolResult) {
      blocks.push({
        type: 'tool_result',
        ...part.toolResult,
      })
      continue
    }
    if (part.text) blocks.push({ type: 'text', text: part.text })
  }
  return blocks.length ? blocks : [{ type: 'text', text: '' }]
}

export function toGoogleContentParts(content: string | readonly ProviderContentPart[]): Record<string, unknown>[] {
  if (typeof content === 'string') return [{ text: content }]
  const parts: Record<string, unknown>[] = []
  for (const part of content) {
    if (part.functionCall) {
      parts.push({
        functionCall: part.functionCall,
        ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
      })
      continue
    }
    if (part.functionResponse) {
      parts.push({ functionResponse: part.functionResponse })
      continue
    }
    if (part.text) parts.push({ text: part.text })
  }
  return parts.length ? parts : [{ text: '' }]
}
