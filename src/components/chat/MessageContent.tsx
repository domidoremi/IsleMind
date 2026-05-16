import { useMemo, useState, type ReactNode } from 'react'
import { ScrollView, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import Markdown from 'react-native-markdown-display'
import { BarChart3, Braces, ChevronDown, Copy, Table2, Workflow } from 'lucide-react-native'
import { MotiView } from 'moti'
import { useAppTheme } from '@/hooks/useAppTheme'
import { PressableScale } from '@/components/ui/PressableScale'
import { IslandPanel } from '@/components/ui/IslandPanel'

interface MessageContentProps {
  content: string
  isUser?: boolean
}

type RichSegment =
  | { id: string; type: 'markdown'; content: string }
  | { id: string; type: 'code'; content: string; language?: string }
  | { id: string; type: 'diagram'; content: string; language?: string }
  | { id: string; type: 'table'; rows: string[][]; title?: string }
  | { id: string; type: 'data'; content: string; language?: string; title: string }

const DIAGRAM_LANGUAGES = new Set(['mermaid', 'flowchart', 'graphviz', 'dot', 'plantuml'])
const DATA_LANGUAGES = new Set(['json', 'jsonc', 'yaml', 'yml', 'csv', 'tsv', 'chart', 'vega', 'vega-lite', 'echarts'])

export function MessageContent({ content, isUser = false }: MessageContentProps) {
  const segments = useMemo(() => safeParseRichContent(content), [content])

  return (
    <View style={{ gap: 8, maxWidth: '100%', overflow: 'hidden' }}>
      {segments.map((segment) => {
        if (segment.type === 'markdown') return <RichMarkdown key={segment.id} content={segment.content} isUser={isUser} />
        if (segment.type === 'table') return <TableBlockCard key={segment.id} rows={segment.rows} title={segment.title} isUser={isUser} />
        if (segment.type === 'diagram') return <DiagramBlockCard key={segment.id} content={segment.content} language={segment.language} isUser={isUser} />
        if (segment.type === 'data') return <DataBlockCard key={segment.id} content={segment.content} language={segment.language} title={segment.title} isUser={isUser} />
        return <CodeBlockCard key={segment.id} content={segment.content} language={segment.language} isUser={isUser} />
      })}
    </View>
  )
}

function safeParseRichContent(content: string): RichSegment[] {
  try {
    const segments = parseRichContent(content)
    return segments.length ? segments : [{ id: 'markdown-empty', type: 'markdown', content }]
  } catch {
    return [{ id: 'markdown-fallback', type: 'markdown', content }]
  }
}

function RichMarkdown({ content, isUser }: { content: string; isUser: boolean }) {
  const { colors, isDark } = useAppTheme()
  return (
    <View style={{ maxWidth: '100%', overflow: 'hidden' }}>
      <Markdown
        style={{
          body: { color: isUser ? colors.surface : colors.text, fontSize: 15, lineHeight: 23 },
          heading1: { color: isUser ? colors.surface : colors.text, fontSize: 20, lineHeight: 26, marginTop: 4, marginBottom: 8, fontWeight: '900' },
          heading2: { color: isUser ? colors.surface : colors.text, fontSize: 18, lineHeight: 24, marginTop: 4, marginBottom: 8, fontWeight: '900' },
          heading3: { color: isUser ? colors.surface : colors.text, fontSize: 16, lineHeight: 22, marginTop: 4, marginBottom: 7, fontWeight: '900' },
          paragraph: { marginTop: 0, marginBottom: 8 },
          link: { color: isUser ? colors.surface : colors.primary, fontWeight: '900' },
          bullet_list: { marginTop: 2, marginBottom: 8 },
          ordered_list: { marginTop: 2, marginBottom: 8 },
          code_inline: {
            color: isUser ? colors.surface : colors.text,
            backgroundColor: isUser ? 'rgba(255,255,255,0.14)' : isDark ? 'rgba(255,242,221,0.08)' : 'rgba(76,57,35,0.08)',
            borderRadius: 7,
            paddingHorizontal: 5,
          },
          fence: { color: isUser ? colors.surface : colors.text, backgroundColor: 'transparent' },
          table: { borderColor: 'transparent' },
        }}
      >
        {content}
      </Markdown>
    </View>
  )
}

function CodeBlockCard({ content, language, isUser }: { content: string; language?: string; isUser: boolean }) {
  const { colors, isDark } = useAppTheme()
  const [expanded, setExpanded] = useState(false)
  const label = language?.trim() || 'code'
  return (
    <RichCard isUser={isUser} expanded={expanded}>
      <CardHeader
        icon={<Braces color={isUser ? colors.surface : colors.primary} size={14} strokeWidth={2.1} />}
        title={label}
        isUser={isUser}
        actions={[
          { label: '复制', onPress: () => void Clipboard.setStringAsync(content) },
          { label: expanded ? '收起' : '放大', onPress: () => setExpanded((value) => !value) },
        ]}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: expanded ? undefined : 280 }}>
        <Text
          selectable
          style={{
            minWidth: 260,
            color: isUser ? colors.surface : colors.text,
            fontFamily: 'monospace',
            fontSize: 12,
            lineHeight: 18,
            padding: 12,
            borderRadius: 18,
            backgroundColor: isUser ? colors.highlight : isDark ? 'rgba(255,242,221,0.055)' : 'rgba(76,57,35,0.055)',
          }}
        >
          {content.trimEnd()}
        </Text>
      </ScrollView>
    </RichCard>
  )
}

function TableBlockCard({ rows, title = '表格', isUser }: { rows: string[][]; title?: string; isUser: boolean }) {
  const { colors, isDark } = useAppTheme()
  const safeRows = rows.length ? rows : [['']]
  const columnCount = Math.max(...safeRows.map((row) => row.length), 1)
  const normalizedRows = safeRows.map((row) => Array.from({ length: columnCount }, (_, index) => row[index] ?? ''))
  const [expanded, setExpanded] = useState(rows.length <= 6)
  const visibleRows = expanded ? normalizedRows : normalizedRows.slice(0, 6)
  return (
    <RichCard isUser={isUser} expanded={expanded}>
      <CardHeader
        icon={<Table2 color={isUser ? colors.surface : colors.primary} size={14} strokeWidth={2.1} />}
        title={title}
        isUser={isUser}
        actions={[
          { label: '复制', onPress: () => void Clipboard.setStringAsync(rows.map((row) => row.join('\t')).join('\n')) },
          ...(normalizedRows.length > 6 ? [{ label: expanded ? '收起' : '展开', onPress: () => setExpanded((value) => !value) }] : []),
        ]}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: isUser ? 'rgba(255,255,255,0.16)' : colors.border }}>
          {visibleRows.map((row, rowIndex) => (
            <View key={`${rowIndex}-${row.join('|')}`} style={{ flexDirection: 'row', backgroundColor: rowIndex === 0 ? (isUser ? 'rgba(255,255,255,0.13)' : colors.islandRaised) : (isUser ? 'transparent' : colors.island) }}>
              {row.map((cell, cellIndex) => (
                <View
                  key={`${rowIndex}-${cellIndex}`}
                  style={{
                    width: Math.max(116, Math.min(178, 96 + Math.min(cell.length, 28) * 3)),
                    minHeight: 38,
                    paddingHorizontal: 10,
                    paddingVertical: 9,
                    borderRightWidth: cellIndex === row.length - 1 ? 0 : 1,
                    borderBottomWidth: rowIndex === visibleRows.length - 1 ? 0 : 1,
                    borderColor: isUser ? 'rgba(255,255,255,0.14)' : colors.border,
                    backgroundColor: rowIndex > 0 && rowIndex % 2 === 0 && !isUser ? (isDark ? 'rgba(255,242,221,0.025)' : 'rgba(76,57,35,0.026)') : undefined,
                  }}
                >
                  <Text
                    selectable
                    style={{
                      color: isUser ? colors.surface : rowIndex === 0 ? colors.text : colors.textSecondary,
                      fontSize: 12,
                      lineHeight: 17,
                      fontWeight: rowIndex === 0 ? '900' : '700',
                    }}
                  >
                    {cell || ' '}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
      {!expanded && normalizedRows.length > 6 ? (
        <Text style={{ color: isUser ? colors.surface : colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 8, fontWeight: '800' }}>
          已收起 {normalizedRows.length - 6} 行，展开后查看完整表格。
        </Text>
      ) : null}
    </RichCard>
  )
}

function DiagramBlockCard({ content, language, isUser }: { content: string; language?: string; isUser: boolean }) {
  const { colors } = useAppTheme()
  const [expanded, setExpanded] = useState(false)
  return (
    <RichCard isUser={isUser} expanded={expanded}>
      <CardHeader
        icon={<Workflow color={isUser ? colors.surface : colors.primary} size={14} strokeWidth={2.1} />}
        title={`${language || 'diagram'} 源码`}
        isUser={isUser}
        actions={[
          { label: '复制', onPress: () => void Clipboard.setStringAsync(content) },
          { label: expanded ? '收起' : '放大', onPress: () => setExpanded((value) => !value) },
        ]}
      />
      <Text style={{ color: isUser ? colors.surface : colors.textSecondary, fontSize: 11, lineHeight: 16, marginBottom: 8, fontWeight: '800' }}>
        当前版本先保证流程图可读、可复制，不伪造不可用的图形渲染。
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: expanded ? undefined : 220 }}>
        <Text selectable style={{ minWidth: 260, color: isUser ? colors.surface : colors.text, fontFamily: 'monospace', fontSize: 12, lineHeight: 18 }}>
          {content.trimEnd()}
        </Text>
      </ScrollView>
    </RichCard>
  )
}

function DataBlockCard({ content, language, title, isUser }: { content: string; language?: string; title: string; isUser: boolean }) {
  const { colors } = useAppTheme()
  const [expanded, setExpanded] = useState(false)
  const csvRows = language === 'csv' || language === 'tsv' ? parseDelimitedTable(content, language === 'tsv' ? '\t' : ',') : null
  if (csvRows?.length) return <TableBlockCard rows={csvRows} title={title} isUser={isUser} />

  return (
    <RichCard isUser={isUser} expanded={expanded}>
      <CardHeader
        icon={<BarChart3 color={isUser ? colors.surface : colors.primary} size={14} strokeWidth={2.1} />}
        title={title}
        isUser={isUser}
        actions={[
          { label: '复制', onPress: () => void Clipboard.setStringAsync(content) },
          { label: expanded ? '收起' : '放大', onPress: () => setExpanded((value) => !value) },
        ]}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: expanded ? undefined : 260 }}>
        <Text selectable style={{ minWidth: 260, color: isUser ? colors.surface : colors.text, fontFamily: 'monospace', fontSize: 12, lineHeight: 18 }}>
          {formatDataPreview(content, language)}
        </Text>
      </ScrollView>
    </RichCard>
  )
}

function RichCard({ isUser, expanded, children }: { isUser: boolean; expanded?: boolean; children: ReactNode }) {
  const { colors } = useAppTheme()
  return (
    <IslandPanel
      elevated={!isUser}
      material={isUser ? 'transparent' : 'raised'}
      contentStyle={{ padding: 10 }}
      style={{
        borderRadius: expanded ? 24 : 20,
        backgroundColor: isUser ? 'rgba(255,255,255,0.1)' : colors.material.paperRaised,
        borderColor: isUser ? 'rgba(255,255,255,0.14)' : colors.border,
      }}
    >
      {children}
    </IslandPanel>
  )
}

function CardHeader({
  icon,
  title,
  actions,
  isUser,
}: {
  icon: ReactNode
  title: string
  actions: { label: string; onPress: () => void }[]
  isUser: boolean
}) {
  const { colors } = useAppTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 }}>
      <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: isUser ? 'rgba(255,255,255,0.1)' : colors.island }}>
        {icon}
      </View>
      <Text numberOfLines={1} style={{ flex: 1, color: isUser ? colors.surface : colors.text, fontSize: 12, fontWeight: '900' }}>
        {title}
      </Text>
      {actions.map((action) => (
        <PressableScale
          key={action.label}
          haptic
          onPress={action.onPress}
          accessibilityLabel={action.label}
          style={{
            minHeight: 28,
            borderRadius: 14,
            paddingHorizontal: 9,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            backgroundColor: isUser ? 'rgba(255,255,255,0.12)' : colors.island,
          }}
        >
          {action.label === '复制' ? <Copy color={isUser ? colors.surface : colors.textTertiary} size={11} strokeWidth={2.2} /> : null}
          {action.label !== '复制' ? (
            <MotiView animate={{ rotate: action.label === '收起' ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: 160 }}>
              <ChevronDown color={isUser ? colors.surface : colors.textTertiary} size={11} strokeWidth={2.2} />
            </MotiView>
          ) : null}
          <Text style={{ color: isUser ? colors.surface : colors.textTertiary, fontSize: 11, fontWeight: '900' }}>{action.label}</Text>
        </PressableScale>
      ))}
    </View>
  )
}

function parseRichContent(content: string): RichSegment[] {
  const segments: RichSegment[] = []
  const fenceRegex = /```([^\n`]*)\n?([\s\S]*?)```/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let index = 0

  while ((match = fenceRegex.exec(content))) {
    if (match.index > lastIndex) {
      segments.push(...parseTextSegments(content.slice(lastIndex, match.index), index))
      index = segments.length
    }
    const language = normalizeLanguage(match[1])
    const body = match[2] ?? ''
    segments.push(createFencedSegment(index, language, body))
    index = segments.length
    lastIndex = fenceRegex.lastIndex
  }

  if (lastIndex < content.length) {
    segments.push(...parseTextSegments(content.slice(lastIndex), index))
  }

  return segments.filter((segment) => segment.type !== 'markdown' || segment.content.trim())
}

function createFencedSegment(index: number, language: string | undefined, content: string): RichSegment {
  if (language && DIAGRAM_LANGUAGES.has(language)) {
    return { id: `diagram-${index}`, type: 'diagram', content, language }
  }
  if (language && DATA_LANGUAGES.has(language)) {
    if (language === 'csv' || language === 'tsv') {
      return { id: `data-${index}`, type: 'data', content, language, title: language.toUpperCase() }
    }
    if (language === 'json' || language === 'jsonc') {
      return { id: `data-${index}`, type: 'data', content, language, title: 'JSON 数据' }
    }
    return { id: `data-${index}`, type: 'data', content, language, title: '图表数据' }
  }
  return { id: `code-${index}`, type: 'code', content, language }
}

function parseTextSegments(text: string, startIndex: number): RichSegment[] {
  const segments: RichSegment[] = []
  const buffer: string[] = []
  const lines = text.split('\n')
  let index = startIndex

  function flushBuffer() {
    const raw = buffer.join('\n')
    buffer.length = 0
    if (!raw.trim()) return
    const trimmed = raw.trim()
    if (looksLikeJson(trimmed)) {
      segments.push({ id: `data-${index}`, type: 'data', content: trimmed, language: 'json', title: 'JSON 数据' })
    } else if (looksLikeCsv(trimmed)) {
      segments.push({ id: `table-${index}`, type: 'table', rows: parseDelimitedTable(trimmed, ',') ?? [[trimmed]], title: 'CSV 数据' })
    } else {
      segments.push({ id: `markdown-${index}`, type: 'markdown', content: raw })
    }
    index += 1
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if (isMarkdownTableStart(lines, lineIndex)) {
      flushBuffer()
      const tableLines = [lines[lineIndex]]
      lineIndex += 2
      while (lineIndex < lines.length && lines[lineIndex].includes('|') && lines[lineIndex].trim()) {
        tableLines.push(lines[lineIndex])
        lineIndex += 1
      }
      lineIndex -= 1
      segments.push({ id: `table-${index}`, type: 'table', rows: parseMarkdownTable(tableLines), title: 'Markdown 表格' })
      index += 1
    } else {
      buffer.push(lines[lineIndex])
    }
  }
  flushBuffer()
  return segments
}

function normalizeLanguage(language: string | undefined): string | undefined {
  const normalized = language?.trim().toLowerCase().split(/\s+/)[0]
  return normalized || undefined
}

function isMarkdownTableStart(lines: string[], index: number): boolean {
  const current = lines[index]?.trim()
  const next = lines[index + 1]?.trim()
  if (!current || !next || !current.includes('|')) return false
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(next)
}

function parseMarkdownTable(lines: string[]): string[][] {
  const bodyLines = lines.filter((_, index) => index !== 1)
  return bodyLines.map(splitPipeRow).filter((row) => row.length)
}

function splitPipeRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function looksLikeJson(text: string): boolean {
  if (!/^[[{]/.test(text)) return false
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

function looksLikeCsv(text: string): boolean {
  const rows = parseDelimitedTable(text, ',')
  if (!rows || rows.length < 2) return false
  return rows[0].length > 1 && rows.every((row) => Math.abs(row.length - rows[0].length) <= 1)
}

function parseDelimitedTable(text: string, delimiter: ',' | '\t'): string[][] | null {
  const rows = text
    .trim()
    .split(/\r?\n/)
    .map((line) => delimiter === ',' ? parseCsvLine(line) : line.split('\t').map((cell) => cell.trim()))
    .filter((row) => row.some(Boolean))
  return rows.length ? rows : null
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]
    if (char === '"' && quoted && next === '"') {
      cell += '"'
      index += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += char
    }
  }
  cells.push(cell.trim())
  return cells
}

function formatDataPreview(content: string, language?: string): string {
  const trimmed = content.trim()
  if (language === 'json' || language === 'jsonc' || looksLikeJson(trimmed)) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2)
    } catch {
      return trimmed
    }
  }
  return trimmed
}
