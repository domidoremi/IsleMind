/** Conservative per-image upper bounds, not a character estimate of Base64 or a bill.
 * Rules checked against official docs on 2026-09-23:
 * https://developers.openai.com/api/docs/guides/images-vision
 * https://platform.claude.com/docs/en/build-with-claude/vision
 * https://ai.google.dev/gemini-api/docs/media-resolution
 * Unknown model/media rules require an adapter-supplied measurement; never guess zero.
 */
export function providerImageTokenUpperBound(input: {
  providerType?: string
  model?: string
  detail?: unknown
  resolution?: unknown
}): number | undefined {
  const model = input.model?.toLowerCase() ?? ''
  const detail = typeof input.detail === 'string' ? input.detail.toLowerCase() : 'auto'
  if (input.providerType === 'openai' || input.providerType === 'openai-compatible') {
    const matches = (name: string) => model === name || new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d{4}-\\d{2}-\\d{2}$`).test(model)
    // OpenAI-compatible unknown models do not inherit OpenAI vision metering.
    if (['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'].some(matches)) {
      return detail === 'low' ? 308 : detail === 'high' ? 3000 : 36_000
    }
    if (matches('gpt-5.5')) return detail === 'low' ? 308 : detail === 'high' ? 3000 : 12_000
    if (['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano'].some(matches)) {
      return detail === 'low' ? 7373 : detail === 'original' ? 12_000 : 3000
    }
    if (matches('gpt-5.2')) return 7373
    if (matches('gpt-4.1-mini')) return 9954
    if (matches('gpt-4o-mini')) return detail === 'low' ? 2833 : 48_169
    if (matches('gpt-4o') || matches('gpt-4.1')) return detail === 'low' ? 85 : 1445
    if (matches('gpt-5.1') || matches('gpt-5')) return detail === 'low' ? 70 : 1190
    if (matches('o1') || matches('o1-pro') || matches('o3')) return detail === 'low' ? 75 : 1275
  }
  if (input.providerType === 'anthropic' && /^claude-/.test(model)) {
    // The documented high-resolution tier caps at 4784, standard at 1568.
    // Use the larger bound for any named Claude version rather than infer a
    // cheaper tier from aliases that a provider may update in place.
    return 4784
  }
  if (input.providerType === 'google' && /^gemini-3(?:\.|-)/.test(model)) {
    const resolution = typeof input.resolution === 'string' ? input.resolution.toLowerCase().replace(/^media_resolution_/, '') : 'unspecified'
    if (resolution === 'low') return 280
    if (resolution === 'medium') return 560
    if (resolution === 'high' || resolution === 'unspecified') return 1120
    if (resolution === 'ultra_high') return 2240
  }
  return undefined
}
