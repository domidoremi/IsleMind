export function normalizeModelId(model: string): string {
  const lower = model.toLowerCase()
  const lastSegment = lower.includes('/') ? lower.split('/').at(-1) ?? lower : lower
  const normalized = lastSegment
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[()]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return normalizeKnownModelAlias(normalized)
}

function normalizeKnownModelAlias(model: string): string {
  if (!/^grok-4\.20(?:-|$)/.test(model)) return model
  if (/(?:^|-)non-reasoning(?:-|$)|(?:^|-)nonreasoning(?:-|$)/.test(model)) return 'grok-4.20-non-reasoning'
  if (/(?:^|-)multi-agent(?:-|$)|(?:^|-)multiagent(?:-|$)/.test(model)) return 'grok-4.20-multi-agent'
  if (/(?:^|-)reasoning(?:-|$)/.test(model)) return 'grok-4.20'
  const suffix = model.slice('grok-4.20'.length)
  if (!suffix || /^-(?:0309|console|beta|preview|latest)(?:-(?:0309|console|beta|preview|latest))*$/.test(suffix)) return 'grok-4.20'
  return model
}
