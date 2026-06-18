import { stringValue } from '@/services/ai/providerJsonUtils'

export function extractOpenAIText(json: any): string {
  return [
    stringValue(json?.output_text),
    stringValue(json?.choices?.[0]?.delta?.content),
    stringValue(json?.choices?.[0]?.message?.content),
    extractOpenAIOutputText(json?.output),
  ].filter(Boolean).join('')
}

export function extractResponseId(json: any): string | undefined {
  return stringValue(json?.response?.id) || stringValue(json?.id) || stringValue(json?.response_id)
}

export function extractOpenAIOutputText(output: unknown): string {
  if (!Array.isArray(output)) return ''
  const parts: string[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const value = item as Record<string, unknown>
    parts.push(stringValue(value.text))
    const content = value.content
    if (typeof content === 'string') {
      parts.push(content)
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (!part || typeof part !== 'object') continue
        const contentPart = part as Record<string, unknown>
        parts.push(stringValue(contentPart.text))
      }
    }
  }
  return parts.filter(Boolean).join('')
}

export function extractAnthropicText(json: any): string {
  const content = Array.isArray(json.content) ? json.content : []
  return content.map((part: { type?: string; text?: string }) => part.type === 'text' || part.text ? part.text ?? '' : '').join('')
}

export function extractGoogleText(json: any): string {
  const parts = json.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return ''
  return parts.map((part: { text?: string; thought?: boolean; functionCall?: unknown }) => part.thought || part.functionCall ? '' : part.text ?? '').join('')
}

export function stringifyOpenAIReasoningItem(item: Record<string, unknown>): string {
  const summary = item.summary
  if (Array.isArray(summary)) {
    return summary.map((part) => typeof part === 'string' ? part : stringValue((part as Record<string, unknown>)?.text)).filter(Boolean).join('\n')
  }
  return stringValue(item.text) || stringValue(item.content)
}
