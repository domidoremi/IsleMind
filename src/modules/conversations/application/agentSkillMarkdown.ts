import { parseDocument } from 'yaml'

/** Instruction-only Agent Skills import. No filesystem, script, tool, or provider authority. */
export function parseAgentSkillMarkdown(raw: string): { name: string; description: string; systemPrompt: string } {
  if (raw.length > 128 * 1024) throw new Error('SKILL.md exceeds the import limit.')
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const match = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)([\s\S]*)$/.exec(text)
  if (!match || match[1].length > 16 * 1024) throw new Error('Invalid SKILL.md frontmatter.')
  const document = parseDocument(match[1], { schema: 'failsafe', uniqueKeys: true, strict: true })
  if (document.errors.length || document.warnings.length) throw new Error('Invalid SKILL.md YAML.')
  const metadata: unknown = document.toJS({ maxAliasCount: 0 })
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Invalid SKILL.md metadata.')
  const fields = metadata as Record<string, unknown>
  if (typeof fields.name !== 'string' || fields.name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fields.name)) {
    throw new Error('Invalid Agent Skills name.')
  }
  if (typeof fields.description !== 'string' || !fields.description.trim() || fields.description.length > 1024) {
    throw new Error('Invalid Agent Skills description.')
  }
  for (const [key, limit] of [['license', 1024], ['compatibility', 500]] as const) {
    if (fields[key] !== undefined && (typeof fields[key] !== 'string' || fields[key].length > limit)) {
      throw new Error(`Invalid Agent Skills ${key}.`)
    }
  }
  const systemPrompt = match[2].trim()
  if (!systemPrompt) throw new Error('SKILL.md has no instructions.')
  return {
    name: fields.name,
    description: [fields.description.trim(),
      fields.license ? `License: ${fields.license}` : '',
      fields.compatibility ? `Compatibility: ${fields.compatibility}` : '',
    ].filter(Boolean).join('\n'),
    systemPrompt,
  }
}
