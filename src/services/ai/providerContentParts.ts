import type { ContentPart } from '@/services/ai/base'

export function toTextContent(content: string | ContentPart[]): string {
  return typeof content === 'string' ? content : content.map((part) => part.text).filter(Boolean).join('\n')
}

export function toAnthropicContentBlocks(content: string | ContentPart[]): Record<string, unknown>[] {
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

export function toGoogleContentParts(content: string | ContentPart[]): Record<string, unknown>[] {
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
