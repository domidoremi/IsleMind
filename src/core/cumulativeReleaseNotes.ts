import { compareAppVersions, parseAppVersion, type AppReleaseNotes } from './appVersion'

export const RELEASE_CHANGE_CATEGORIES = ['features', 'improvements', 'fixes', 'privacy', 'other'] as const
export type ReleaseChangeCategory = typeof RELEASE_CHANGE_CATEGORIES[number]

export interface ReleaseNotesBoundary {
  version: string
  versionCode?: number
}

export interface CumulativeReleaseChange {
  id: string
  sourceId: string
  version: string
  versionCode?: number
  text: string
}

export interface CumulativeReleaseNotes {
  releaseCount: number
  changeCount: number
  firstVersion?: string
  lastVersion?: string
  complete: boolean
  missingVersions: string[]
  fallbackVersions: string[]
  groups: { category: ReleaseChangeCategory; items: CumulativeReleaseChange[] }[]
}

type NotesLanguage = 'zh' | 'en' | 'ja'
type ParsedChange = { category: ReleaseChangeCategory; text: string; line: number }

/** Source versions own the delivered span; build codes distinguish equal-version rebuilds. */
export function compareReleaseNotesVersions(left: ReleaseNotesBoundary, right: ReleaseNotesBoundary): number {
  const version = compareAppVersions(left.version, right.version)
  if (version) return version
  if (positiveCode(left.versionCode) && positiveCode(right.versionCode)) {
    return Math.sign(left.versionCode! - right.versionCode!)
  }
  return 0
}

/** Keep empty releases and independent source records: neither counts nor identity come from prose. */
export function selectReleaseNotesRange(
  installed: ReleaseNotesBoundary,
  target: ReleaseNotesBoundary,
  entries: readonly AppReleaseNotes[],
): AppReleaseNotes[] {
  if (!parseAppVersion(installed.version) || !parseAppVersion(target.version)) return []
  return entries.flatMap((entry) => {
    if (!entry || !parseAppVersion(entry.version)) return []
    if (positiveCode(entry.versionCode) && positiveCode(target.versionCode) && entry.versionCode > target.versionCode) return []
    if (positiveCode(entry.versionCode) && positiveCode(installed.versionCode) && entry.versionCode < installed.versionCode) return []
    if (compareReleaseNotesVersions(entry, installed) <= 0 || compareReleaseNotesVersions(entry, target) > 0) return []
    return [{ ...entry, version: parseAppVersion(entry.version)!.version, notes: typeof entry.notes === 'string' ? entry.notes.trim() : '' }]
  }).sort((a, b) => compareReleaseNotesVersions(a, b) || compareAppVersions(a.version, b.version)
    || releaseNotesSourceId(a).localeCompare(releaseNotesSourceId(b))
    || a.notes.localeCompare(b.notes))
}

export function releaseNotesSourceId(entry: AppReleaseNotes): string {
  if (typeof entry.sourceId === 'string' && entry.sourceId.trim()) return entry.sourceId.trim()
  const parsed = parseAppVersion(entry.version)!
  const version = `${parsed.numbers.join('.')}${parsed.prerelease.length ? `-${parsed.prerelease.join('.')}` : ''}`
  return `legacy:${version}:${positiveCode(entry.versionCode) ? entry.versionCode : ''}`
}

export function collectCumulativeReleaseNotes(input: {
  installed: ReleaseNotesBoundary
  target: ReleaseNotesBoundary
  entries: readonly AppReleaseNotes[]
  language: string
  complete?: boolean
}): CumulativeReleaseNotes {
  const pending = selectReleaseNotesRange(input.installed, input.target, input.entries)
  const records = new Map<string, AppReleaseNotes[]>()
  for (const entry of pending) {
    const id = releaseNotesSourceId(entry)
    const versions = records.get(id) ?? []
    // Exact repeated transport snapshots are duplicates; repeated changes are not.
    if (!versions.some((previous) => previous.notes === entry.notes
      && compareReleaseNotesVersions(previous, entry) === 0)) versions.push(entry)
    records.set(id, versions)
  }
  const groups = RELEASE_CHANGE_CATEGORIES.map((category) => ({ category, items: [] as CumulativeReleaseChange[] }))
  const missingVersions = new Set<string>()
  const fallbackVersions = new Set<string>()
  const validRange = !!parseAppVersion(input.installed.version) && !!parseAppVersion(input.target.version)
    && compareReleaseNotesVersions(input.installed, input.target) <= 0
  let complete = input.complete === true && validRange
    && input.entries.every((entry) => !!entry && !!parseAppVersion(entry.version) && typeof entry.notes === 'string')
  if (validRange && compareReleaseNotesVersions(input.installed, input.target) < 0
    && !pending.some((entry) => compareReleaseNotesVersions(entry, input.target) === 0
      && compareAppVersions(entry.version, input.target.version) === 0)) complete = false

  for (const [sourceId, snapshots] of [...records].reverse()) {
    if (snapshots.length > 1) complete = false
    snapshots.forEach((entry, index) => {
      const selected = selectNotesLanguage(entry.notes, input.language)
      const changes = parseReleaseChanges(selected.text)
      if (!changes.length) { missingVersions.add(entry.version); complete = false }
      if (selected.fallback) fallbackVersions.add(entry.version)
      for (const change of changes) {
        groups.find((group) => group.category === change.category)!.items.push({
          id: `${sourceId}:${selected.language}:${index}:${change.line}`,
          sourceId,
          version: entry.version,
          ...(entry.versionCode === undefined ? {} : { versionCode: entry.versionCode }),
          text: change.text,
        })
      }
    })
  }
  return {
    releaseCount: records.size,
    changeCount: groups.reduce((sum, group) => sum + group.items.length, 0),
    firstVersion: pending[0]?.version,
    lastVersion: pending[pending.length - 1]?.version,
    complete,
    missingVersions: [...missingVersions],
    fallbackVersions: [...fallbackVersions],
    groups: groups.filter((group) => group.items.length > 0),
  }
}

function positiveCode(code: unknown): code is number {
  return typeof code === 'number' && Number.isSafeInteger(code) && code > 0
}

function notesLanguage(label: string): NotesLanguage | undefined {
  const value = label.replace(/<[^>]*>/g, '').trim().toLowerCase()
  if (/^(?:zh(?:[-_].*)?|chinese|\u7b80\u4f53\u4e2d\u6587|\u4e2d\u6587|\u7e41\u9ad4\u4e2d\u6587)$/.test(value)) return 'zh'
  if (/^(?:en(?:[-_].*)?|english)$/.test(value)) return 'en'
  if (/^(?:ja(?:[-_].*)?|japanese|\u65e5\u672c\u8a9e)$/.test(value)) return 'ja'
  return undefined
}

function selectNotesLanguage(notes: string, requested: string): { text: string; language: string; fallback: boolean } {
  const language = notesLanguage(requested) ?? 'en'
  const blocks: { language: NotesLanguage; body: string }[] = []
  const outside = notes.replace(/<details\b[^>]*>\s*<summary\b[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi,
    (match, label: string, body: string) => {
      const blockLanguage = notesLanguage(label)
      if (!blockLanguage) return match
      blocks.push({ language: blockLanguage, body })
      return ''
    })
  if (!blocks.length) return { text: notes, language, fallback: false }
  const chosen = blocks.find((block) => block.language === language)
    ?? blocks.find((block) => block.language === 'en') ?? blocks[0]
  return { text: `${outside}\n\n${chosen.body}`, language: chosen.language, fallback: chosen.language !== language }
}

function headingCategory(heading: string): ReleaseChangeCategory | undefined {
  const value = heading.normalize('NFKC').trim().toLowerCase()
    .replace(/[\s:(\uff08]*\d+[\s)\uff09]*$/, '').replace(/[:\uff1a]$/, '').trim()
  if (/^(?:new features?|features?|added|\u65b0\u529f\u80fd|\u65b0\u6a5f\u80fd)$/.test(value)) return 'features'
  if (/^(?:improvements?|improved|changed|\u6539\u8fdb|\u6539\u5584)$/.test(value)) return 'improvements'
  if (/^(?:bug fixes?|fixes|fixed|\u9519\u8bef\u4fee\u590d|\u4fee\u590d|\u4e0d\u5177\u5408\u4fee\u6b63)$/.test(value)) return 'fixes'
  if (/^(?:privacy(?: and security)?|security|\u9690\u79c1|\u9690\u79c1\u4e0e\u5b89\u5168|\u30d7\u30e9\u30a4\u30d0\u30b7\u30fc|\u30bb\u30ad\u30e5\u30ea\u30c6\u30a3)$/.test(value)) return 'privacy'
  return undefined
}

/** Count top-level changes, retaining nested lists, paragraphs, code, and unknown sections verbatim. */
function parseReleaseChanges(notes: string): ParsedChange[] {
  const changes: ParsedChange[] = []
  let category: ReleaseChangeCategory = 'other'
  let current: { lines: string[]; line: number; category: ReleaseChangeCategory; indent?: number } | undefined
  let fence: string | undefined
  const flush = () => {
    if (current) {
      const text = current.lines.join('\n').trim()
      if (text) changes.push({ category: current.category, text, line: current.line })
    }
    current = undefined
  }
  notes.replace(/\r\n?/g, '\n').split('\n').forEach((line, index) => {
    if (!fence) {
      const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/)?.[1]
        ?? line.match(/^\s*\*\*(.+?)\*\*\s*$/)?.[1]
      const knownCategory = heading ? headingCategory(heading) : undefined
      if (knownCategory) { flush(); category = knownCategory; return }
      if (heading && /^#{1,2}\s+.*\bv?\d+(?:\.\d+){1,2}\b/i.test(line)) { flush(); return }
      if (heading) { flush(); category = 'other' }
      const bullet = line.match(/^(\s*)(?:[-*+]|\d+[.)])\s+\S/)
      if (bullet && (current?.indent === undefined || bullet[1].length <= current.indent)) {
        flush()
        current = { lines: [], line: index, category, indent: bullet[1].length }
      } else if (current?.lines.at(-1)?.trim() === '' && line.trim()
        && !/^\s+\S/.test(line)) flush()
    }
    const delimiter = line.trimStart().match(/^(`{3,}|~{3,})/)?.[1]
    if (delimiter) {
      if (!fence) fence = delimiter
      else if (delimiter[0] === fence[0] && delimiter.length >= fence.length) fence = undefined
    }
    if (!current && !line.trim()) return
    current ??= { lines: [], line: index, category: 'other' }
    current.lines.push(line)
  })
  flush()
  return changes
}
