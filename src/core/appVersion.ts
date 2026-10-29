export interface AppVersion {
  version: string
  numbers: readonly [number, number, number]
  prerelease: readonly string[]
}

export interface AppReleaseNotes {
  /** Stable release identity supplied by the transport, not a text similarity key. */
  sourceId?: string
  version: string
  versionCode?: number
  notes: string
}

const VERSION_PATTERN = /^[vV]?(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:\.(0|[1-9]\d*))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

/** Accept shortened app versions as well as SemVer; never extract digits from malformed input. */
export function parseAppVersion(value: unknown): AppVersion | undefined {
  if (typeof value !== 'string') return undefined
  const match = value.trim().match(VERSION_PATTERN)
  if (!match) return undefined
  const numbers = [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)] as const
  if (numbers.some((number) => !Number.isSafeInteger(number))) return undefined
  const prerelease = match[4]?.split('.') ?? []
  if (prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) return undefined
  return {
    version: `${numbers.join('.')}${match[4] ? `-${match[4]}` : ''}${match[5] ? `+${match[5]}` : ''}`,
    numbers,
    prerelease,
  }
}

export function compareAppVersions(left: string, right: string): number {
  const a = parseAppVersion(left)
  const b = parseAppVersion(right)
  if (!a || !b) throw new TypeError('A valid app version is required.')
  for (let index = 0; index < a.numbers.length; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] > b.numbers[index] ? 1 : -1
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length ? -1 : 1
  }
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const first = a.prerelease[index]
    const second = b.prerelease[index]
    if (first === second) continue
    if (first === undefined || second === undefined) return first === undefined ? -1 : 1
    const firstNumeric = /^\d+$/.test(first)
    const secondNumeric = /^\d+$/.test(second)
    if (firstNumeric !== secondNumeric) return firstNumeric ? -1 : 1
    if (firstNumeric && first.length !== second.length) return first.length > second.length ? 1 : -1
    return first > second ? 1 : -1
  }
  return 0
}

export function mergeAppReleaseNotes(
  installedVersion: string,
  targetVersion: string,
  entries: readonly AppReleaseNotes[],
): AppReleaseNotes[] {
  if (!parseAppVersion(installedVersion) || !parseAppVersion(targetVersion)) return []
  const pending = entries
    .filter((entry) => parseAppVersion(entry.version)
      && typeof entry.notes === 'string' && entry.notes.trim()
      && compareAppVersions(entry.version, installedVersion) > 0
      && compareAppVersions(entry.version, targetVersion) <= 0)
    .map((entry) => ({ ...entry, version: entry.version.trim().replace(/^v/i, ''), notes: entry.notes.trim() }))
    .sort((a, b) => compareAppVersions(a.version, b.version) || (a.versionCode ?? 0) - (b.versionCode ?? 0))
  const merged: AppReleaseNotes[] = []
  let seenNotes = new Set<string>()
  for (const entry of pending) {
    const previous = merged[merged.length - 1]
    if (previous && compareAppVersions(previous.version, entry.version) === 0) {
      if (!seenNotes.has(entry.notes)) previous.notes += `\n\n${entry.notes}`
    } else {
      merged.push({ ...entry })
      seenNotes = new Set()
    }
    seenNotes.add(entry.notes)
  }
  return merged
}
