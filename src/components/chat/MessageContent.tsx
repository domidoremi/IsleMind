import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Platform, ScrollView, Text, View, useWindowDimensions } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import Markdown from 'react-native-markdown-display'
import type { RenderRules } from 'react-native-markdown-display'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { BarChart3, Braces, ChevronDown, Copy, Sigma, Table2, Workflow } from 'lucide-react-native'
import { MotiView } from 'moti'
import { useAppTheme } from '@/hooks/useAppTheme'
import { IslePressable } from '@/components/ui/isle'
import { IslePanel } from '@/components/ui/isle'
import { normalizeStreamingMarkdown } from '@/utils/streamingMarkdown'

interface MessageContentProps {
  content: string
  isUser?: boolean
  isStreaming?: boolean
  onLayoutChangeRequest?: () => void
}

type RichSegment =
  | { id: string; type: 'markdown'; content: string }
  | { id: string; type: 'code'; content: string; language?: string }
  | { id: string; type: 'formula'; content: string }
  | { id: string; type: 'diagram'; content: string; language?: string }
  | { id: string; type: 'table'; rows: string[][]; title?: string }
  | { id: string; type: 'data'; content: string; language?: string; title: string }

const FORMULA_LANGUAGES = new Set(['math', 'latex', 'tex', 'formula', 'equation'])
const DIAGRAM_LANGUAGES = new Set(['mermaid', 'flowchart', 'graphviz', 'dot', 'plantuml'])
const DATA_LANGUAGES = new Set(['json', 'jsonc', 'yaml', 'yml', 'csv', 'tsv', 'chart', 'vega', 'vega-lite', 'echarts'])
const MARKDOWN_COLLAPSE_CHAR_LIMIT = 4200
const MARKDOWN_COLLAPSE_LINE_LIMIT = 90
const MARKDOWN_PREVIEW_CHAR_LIMIT = 3000
const MARKDOWN_PREVIEW_LINE_LIMIT = 64
const MARKDOWN_PREVIEW_MIN_BOUNDARY_RATIO = 0.45
const CODE_BLOCK_COLLAPSED_MAX_HEIGHT = 280
const FORMULA_BLOCK_COLLAPSED_MAX_HEIGHT = 220
const DIAGRAM_BLOCK_COLLAPSED_MAX_HEIGHT = 220
const DATA_BLOCK_COLLAPSED_MAX_HEIGHT = 260
const RICH_BLOCK_TEXT_LINE_HEIGHT = 18
const RICH_BLOCK_TEXT_VERTICAL_PADDING = 24
const RICH_BLOCK_ACTION_HIT_SLOP = { top: 8, right: 8, bottom: 8, left: 8 }
const RICH_BLOCK_SCROLL_INDICATOR_PERSISTENT = Platform.OS === 'android'
const RICH_BLOCK_COPY_FEEDBACK_MS = 1300
const RICH_BLOCK_SOURCE_MAX_WIDTH = 980
const DIAGRAM_PREVIEW_NODE_LIMIT = 8
const DIAGRAM_PREVIEW_EDGE_LIMIT = 6

type FormulaTokenKind = 'plain' | 'operator' | 'function' | 'number' | 'symbol'

interface FormulaToken {
  content: string
  kind: FormulaTokenKind
}

interface DiagramEdgePreview {
  from: string
  to: string
  label?: string
}

interface DiagramPreview {
  nodes: string[]
  edges: DiagramEdgePreview[]
  hiddenNodeCount: number
  hiddenEdgeCount: number
}
const SELECTABLE_MARKDOWN_RULES: RenderRules = {
  text: (node, _children, _parent, styles, inheritedStyles = {}) => (
    <Text key={node.key} selectable style={[inheritedStyles, styles.text]}>
      {node.content}
    </Text>
  ),
  textgroup: (node, children, _parent, styles) => (
    <Text key={node.key} selectable style={styles.textgroup}>
      {children}
    </Text>
  ),
  code_inline: (node, _children, _parent, styles, inheritedStyles = {}) => (
    <Text key={node.key} selectable style={[inheritedStyles, styles.code_inline]}>
      {node.content}
    </Text>
  ),
}

interface RichCardAction {
  label: string
  kind?: 'copy' | 'toggle'
  accessibilityHint?: string
  accessibilityState?: {
    expanded?: boolean
  }
  onPress: () => void | Promise<unknown>
}

interface MarkdownPreview {
  collapsible: boolean
  content: string
  hiddenLineCount: number
  hiddenCharacterCount: number
}

function richTextBlockMinWidth(windowWidth: number): number {
  return Math.max(180, Math.min(260, windowWidth - 120))
}

function tableCellMetrics(windowWidth: number) {
  const compact = windowWidth < 380
  return {
    minWidth: compact ? 92 : 116,
    maxWidth: compact ? 148 : 178,
    baseWidth: compact ? 80 : 96,
    charWidth: compact ? 2.4 : 3,
  }
}

export const MessageContent = memo(function MessageContent({ content, isUser = false, isStreaming = false, onLayoutChangeRequest }: MessageContentProps) {
  const { t } = useTranslation()
  const segments = useMemo(() => safeParseRichContent(content, t), [content, t])

  return (
    <View style={{ gap: 8, maxWidth: '100%', overflow: 'hidden' }}>
      {segments.map((segment) => {
        if (segment.type === 'markdown') return <RichMarkdown key={segment.id} content={segment.content} isUser={isUser} isStreaming={isStreaming} onLayoutChangeRequest={onLayoutChangeRequest} />
        if (segment.type === 'table') return <TableBlockCard key={segment.id} rows={segment.rows} title={segment.title} isUser={isUser} isStreaming={isStreaming} onLayoutChangeRequest={onLayoutChangeRequest} />
        if (segment.type === 'formula') return <FormulaBlockCard key={segment.id} content={segment.content} isUser={isUser} isStreaming={isStreaming} onLayoutChangeRequest={onLayoutChangeRequest} />
        if (segment.type === 'diagram') return <DiagramBlockCard key={segment.id} content={segment.content} language={segment.language} isUser={isUser} isStreaming={isStreaming} onLayoutChangeRequest={onLayoutChangeRequest} />
        if (segment.type === 'data') return <DataBlockCard key={segment.id} content={segment.content} language={segment.language} title={segment.title} isUser={isUser} isStreaming={isStreaming} onLayoutChangeRequest={onLayoutChangeRequest} />
        return <CodeBlockCard key={segment.id} content={segment.content} language={segment.language} isUser={isUser} isStreaming={isStreaming} onLayoutChangeRequest={onLayoutChangeRequest} />
      })}
    </View>
  )
}, areMessageContentPropsEqual)

function areMessageContentPropsEqual(previous: MessageContentProps, next: MessageContentProps): boolean {
  return previous.content === next.content &&
    previous.isUser === next.isUser &&
    previous.isStreaming === next.isStreaming &&
    previous.onLayoutChangeRequest === next.onLayoutChangeRequest
}

function safeParseRichContent(content: string, t: TFunction): RichSegment[] {
  try {
    const segments = parseRichContent(content, t)
    return segments.length ? segments : [{ id: 'markdown-empty', type: 'markdown', content }]
  } catch {
    return [{ id: 'markdown-fallback', type: 'markdown', content }]
  }
}

function RichMarkdown({ content, isUser, isStreaming, onLayoutChangeRequest }: { content: string; isUser: boolean; isStreaming: boolean; onLayoutChangeRequest?: () => void }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(isUser || isStreaming)
  const userMessage = colors.ui.message
  const inlineCodeBackground = isUser ? userMessage.userActionBackground : colors.ui.card.mutedBackground
  const blockSurface = isUser ? userMessage.userActionBackground : colors.ui.card.mutedBackground
  const blockBorder = isUser ? userMessage.userActionBackground : colors.material.stroke
  const codeSurface = isUser ? userMessage.userActionBackground : colors.ui.code.background
  const mutedForeground = isUser ? userMessage.userForeground : colors.textTertiary
  const preview = useMemo(() => buildMarkdownPreview(content), [content])
  const markdownCollapsible = !isUser && !isStreaming && preview.collapsible

  // 流式内容标准化，修复未闭合的代码块、列表等
  const normalizedContent = useMemo(
    () => normalizeStreamingMarkdown(content, isStreaming),
    [content, isStreaming]
  )

  const visibleContent = markdownCollapsible && !expanded ? preview.content : normalizedContent
  const collapsedSummary = markdownCollapsible && !expanded
    ? preview.hiddenLineCount > 0
      ? t('messageContent.collapsedMarkdownLines', { count: preview.hiddenLineCount })
      : t('messageContent.collapsedMarkdownCharacters', { count: preview.hiddenCharacterCount })
    : ''
  const markdownToggleLabel = expanded ? t('messageContent.collapseLongReply') : t('messageContent.expandLongReply')
  useEffect(() => {
    if (!isStreaming) return
    setExpanded(true)
  }, [isStreaming])

  return (
    <View style={{ maxWidth: '100%', overflow: 'hidden' }}>
      <Markdown
        rules={SELECTABLE_MARKDOWN_RULES}
        style={{
          body: { color: isUser ? userMessage.userForeground : colors.text, fontSize: 15, lineHeight: 23, includeFontPadding: !isUser },
          heading1: { color: isUser ? userMessage.userForeground : colors.text, fontSize: 20, lineHeight: 26, marginTop: 4, marginBottom: 8, fontWeight: '900' },
          heading2: { color: isUser ? userMessage.userForeground : colors.text, fontSize: 18, lineHeight: 24, marginTop: 4, marginBottom: 8, fontWeight: '900' },
          heading3: { color: isUser ? userMessage.userForeground : colors.text, fontSize: 16, lineHeight: 22, marginTop: 4, marginBottom: 7, fontWeight: '900' },
          paragraph: { marginTop: 0, marginBottom: isUser ? 0 : 8 },
          link: { color: isUser ? userMessage.userForeground : colors.ui.control.link, fontWeight: '900' },
          bullet_list: {
            marginTop: 4,
            marginBottom: 10,
            paddingVertical: 4,
            paddingHorizontal: 2,
            borderLeftWidth: isUser ? 0 : 2,
            borderLeftColor: isUser ? 'transparent' : colors.ui.icon.accentBackground,
          },
          ordered_list: {
            marginTop: 4,
            marginBottom: 10,
            paddingVertical: 4,
            paddingHorizontal: 2,
            borderLeftWidth: isUser ? 0 : 2,
            borderLeftColor: isUser ? 'transparent' : colors.ui.icon.accentBackground,
          },
          list_item: {
            marginBottom: 5,
          },
          bullet_list_icon: {
            color: isUser ? userMessage.userForeground : colors.ui.icon.accentForeground,
            fontWeight: '900',
            lineHeight: 23,
            marginRight: 7,
          },
          ordered_list_icon: {
            color: isUser ? userMessage.userForeground : colors.ui.icon.accentForeground,
            fontWeight: '900',
            lineHeight: 23,
            marginRight: 7,
            minWidth: 21,
            textAlign: 'right',
          },
          bullet_list_content: {
            flex: 1,
            paddingLeft: 1,
          },
          ordered_list_content: {
            flex: 1,
            paddingLeft: 1,
          },
          blockquote: {
            backgroundColor: blockSurface,
            borderLeftWidth: 3,
            borderLeftColor: isUser ? userMessage.userForeground : colors.ui.icon.accentForeground,
            borderRadius: 10,
            paddingHorizontal: 10,
            paddingVertical: 8,
            marginBottom: 8,
          },
          hr: {
            backgroundColor: blockBorder,
            height: 1,
            marginTop: 8,
            marginBottom: 12,
          },
          strong: { color: isUser ? userMessage.userForeground : colors.text, fontWeight: '900' },
          em: { color: isUser ? userMessage.userForeground : colors.textSecondary, fontStyle: 'italic' },
          s: { color: mutedForeground, textDecorationLine: 'line-through' },
          code_inline: {
            color: isUser ? userMessage.userForeground : colors.ui.code.text,
            backgroundColor: inlineCodeBackground,
            borderRadius: 7,
            paddingHorizontal: 5,
            paddingVertical: 1,
            fontSize: 13,
            lineHeight: 20,
          },
          code_block: {
            color: isUser ? userMessage.userForeground : colors.ui.code.text,
            backgroundColor: codeSurface,
            borderColor: isUser ? 'transparent' : colors.ui.code.border,
            borderWidth: isUser ? 0 : 1,
            borderRadius: colors.ui.radius.card,
            padding: 10,
          },
          fence: {
            color: isUser ? userMessage.userForeground : colors.ui.code.text,
            backgroundColor: codeSurface,
            borderColor: isUser ? 'transparent' : colors.ui.code.border,
            borderWidth: isUser ? 0 : 1,
            borderRadius: colors.ui.radius.card,
            padding: 10,
          },
          table: { borderColor: blockBorder, borderWidth: 1, borderRadius: colors.ui.radius.card, backgroundColor: blockSurface },
          thead: { backgroundColor: isUser ? userMessage.userActionBackground : colors.ui.table.headerBackground },
          tbody: { backgroundColor: blockSurface },
          th: { borderColor: blockBorder, backgroundColor: isUser ? userMessage.userActionBackground : colors.ui.table.headerBackground },
          tr: { borderColor: blockBorder },
          td: { borderColor: blockBorder, backgroundColor: blockSurface },
        }}
      >
        {visibleContent}
      </Markdown>
      {markdownCollapsible ? (
        <View style={{ alignItems: 'flex-start', gap: 6, marginTop: 2 }}>
          {collapsedSummary ? (
            <Text
              accessibilityLiveRegion="polite"
              style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, fontWeight: '800' }}
            >
              {collapsedSummary}
            </Text>
          ) : null}
          <IslePressable
            haptic
            hitSlop={{ top: 8, right: 10, bottom: 8, left: 10 }}
            onPress={() => {
              setExpanded((value) => !value)
              requestContentLayoutChange(onLayoutChangeRequest)
            }}
            accessibilityLabel={markdownToggleLabel}
            accessibilityHint={expanded ? t('messageContent.collapseLongReplyHint') : t('messageContent.expandLongReplyHint')}
            accessibilityState={{ expanded }}
            accessibilityValue={collapsedSummary ? { text: collapsedSummary } : undefined}
            style={{
              alignSelf: 'flex-start',
              minHeight: 36,
              borderRadius: colors.ui.radius.chip,
              paddingHorizontal: 11,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
              zIndex: 2,
              backgroundColor: isUser ? userMessage.userActionBackground : colors.ui.card.mutedBackground,
            }}
          >
            <MotiView animate={{ rotate: expanded ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: 160 }}>
              <ChevronDown color={isUser ? userMessage.userForeground : colors.textTertiary} size={12} strokeWidth={2.2} />
            </MotiView>
            <Text style={{ color: isUser ? userMessage.userForeground : colors.textTertiary, fontSize: 11, fontWeight: '900' }}>
              {markdownToggleLabel}
            </Text>
          </IslePressable>
        </View>
      ) : null}
    </View>
  )
}

function buildMarkdownPreview(content: string): MarkdownPreview {
  const lines = content.split('\n')
  const shouldCollapse = content.length > MARKDOWN_COLLAPSE_CHAR_LIMIT || lines.length > MARKDOWN_COLLAPSE_LINE_LIMIT
  if (!shouldCollapse) return { collapsible: false, content, hiddenLineCount: 0, hiddenCharacterCount: 0 }

  const lineBounded = lines.slice(0, MARKDOWN_PREVIEW_LINE_LIMIT).join('\n')
  const bounded = lineBounded.length > MARKDOWN_PREVIEW_CHAR_LIMIT
    ? lineBounded.slice(0, MARKDOWN_PREVIEW_CHAR_LIMIT)
    : lineBounded
  const paragraphBreak = bounded.lastIndexOf('\n\n')
  const sentenceBreak = Math.max(bounded.lastIndexOf('。'), bounded.lastIndexOf('. '), bounded.lastIndexOf('\n'))
  const minBoundary = MARKDOWN_PREVIEW_CHAR_LIMIT * MARKDOWN_PREVIEW_MIN_BOUNDARY_RATIO
  const cutAt = paragraphBreak > minBoundary
    ? paragraphBreak
    : sentenceBreak > minBoundary
      ? sentenceBreak + 1
      : bounded.length
  const stableCutAt = getStableMarkdownPreviewCut(content, bounded, cutAt, minBoundary)
  const preview = bounded.slice(0, stableCutAt).trimEnd()
  const previewContent = preview || bounded.trimEnd()
  return {
    collapsible: true,
    content: previewContent,
    hiddenLineCount: Math.max(0, lines.length - previewContent.split('\n').length),
    hiddenCharacterCount: Math.max(0, content.length - previewContent.length),
  }
}

function getStableMarkdownPreviewCut(source: string, bounded: string, preferredCutAt: number, minBoundary: number): number {
  const boundedCutAt = Math.max(0, Math.min(bounded.length, preferredCutAt))
  const openFenceStart = getOpenMarkdownFenceStart(bounded.slice(0, boundedCutAt))
  if (openFenceStart < minBoundary) return boundedCutAt

  const remainingSource = source.slice(openFenceStart)
  const fence = remainingSource.match(/^(```+|~~~+)/)?.[1]
  if (fence && remainingSource.slice(fence.length).includes(fence)) return openFenceStart
  return boundedCutAt
}

function getOpenMarkdownFenceStart(value: string): number {
  const fenceRegex = /(^|\n)(```+|~~~+)/g
  let openFence: { marker: string; index: number } | null = null
  let match: RegExpExecArray | null
  while ((match = fenceRegex.exec(value)) !== null) {
    const marker = match[2] ?? ''
    const markerIndex = match.index + (match[1]?.length ?? 0)
    if (!openFence) {
      openFence = { marker, index: markerIndex }
      continue
    }
    if (marker.startsWith(openFence.marker[0] ?? '') && marker.length >= openFence.marker.length) {
      openFence = null
    }
  }
  return openFence?.index ?? -1
}

function CodeBlockCard({ content, language, isUser, isStreaming, onLayoutChangeRequest }: { content: string; language?: string; isUser: boolean; isStreaming: boolean; onLayoutChangeRequest?: () => void }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const { width } = useWindowDimensions()
  const [expanded, setExpanded] = useState(isUser || isStreaming)
  const label = language?.trim() || 'code'
  const userMessage = colors.ui.message
  const codeSurface = isUser ? userMessage.userActionBackground : colors.ui.code.background
  const blockMinWidth = richTextBlockMinWidth(width)
  const lineCount = countContentLines(content)
  const codeLines = useMemo(() => splitSourceLines(content), [content])
  const collapsedLineCount = !expanded ? getHiddenRichBlockLineCount(content, CODE_BLOCK_COLLAPSED_MAX_HEIGHT, true) : 0
  function toggleExpanded() {
    setExpanded((value) => !value)
    requestContentLayoutChange(onLayoutChangeRequest)
  }
  useEffect(() => {
    if (!isStreaming) return
    setExpanded(true)
  }, [isStreaming])

  return (
    <RichCard isUser={isUser} expanded={expanded}>
      <CardHeader
        icon={<Braces color={isUser ? userMessage.userForeground : colors.ui.icon.accentForeground} size={14} strokeWidth={2.1} />}
        title={t('messageContent.codeBlockTitle', { language: label, count: lineCount })}
        isUser={isUser}
        actions={isUser ? [] : [
          { label: t('common.copy'), kind: 'copy', onPress: () => Clipboard.setStringAsync(content) },
          {
            label: expanded ? t('common.collapse') : t('common.expand'),
            kind: 'toggle',
            accessibilityHint: expanded ? t('messageContent.collapseBlockHint') : t('messageContent.expandBlockHint'),
            accessibilityState: { expanded },
            onPress: toggleExpanded,
          },
        ]}
      />
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator
        persistentScrollbar={RICH_BLOCK_SCROLL_INDICATOR_PERSISTENT}
        accessibilityLabel={t('messageContent.horizontalScrollLabel')}
        accessibilityHint={t('messageContent.horizontalScrollHint')}
        style={{ maxHeight: expanded ? undefined : CODE_BLOCK_COLLAPSED_MAX_HEIGHT }}
      >
        <SourceLineRows
          lines={codeLines}
          isUser={isUser}
          minWidth={blockMinWidth}
          surface={codeSurface}
          borderColor={colors.ui.code.border}
          textColor={isUser ? userMessage.userForeground : colors.ui.code.text}
          numberColor={isUser ? userMessage.userForeground : colors.textTertiary}
          gutterBackground={isUser ? userMessage.userActionBackground : colors.ui.card.defaultBackground}
        />
      </ScrollView>
      <CollapsedRichBlockNotice count={collapsedLineCount} isUser={isUser} />
    </RichCard>
  )
}

function SourceLineRows({
  lines,
  isUser,
  minWidth,
  surface,
  borderColor,
  textColor,
  numberColor,
  gutterBackground,
}: {
  lines: string[]
  isUser: boolean
  minWidth: number
  surface: string
  borderColor: string
  textColor: string
  numberColor: string
  gutterBackground: string
}) {
  const { colors } = useAppTheme()
  const lineNumberWidth = Math.max(34, String(lines.length).length * 8 + 18)
  const sourceMinWidth = Math.max(minWidth, Math.min(RICH_BLOCK_SOURCE_MAX_WIDTH, lineNumberWidth + longestLineLength(lines) * 7.2 + 28))
  return (
    <View
      style={{
        minWidth: sourceMinWidth,
        borderRadius: colors.ui.radius.card,
        overflow: 'hidden',
        backgroundColor: surface,
        borderWidth: isUser ? 0 : 1,
        borderColor,
      }}
    >
      {lines.map((line, index) => (
        <View
          key={`${index}-${line.slice(0, 12)}`}
          style={{
            flexDirection: 'row',
            alignItems: 'stretch',
            backgroundColor: !isUser && index % 2 === 1 ? colors.ui.card.mutedBackground : undefined,
          }}
        >
          <Text
            selectable={false}
            style={{
              width: lineNumberWidth,
              paddingTop: index === 0 ? 12 : 2,
              paddingBottom: index === lines.length - 1 ? 12 : 2,
              paddingRight: 9,
              paddingLeft: 8,
              textAlign: 'right',
              color: numberColor,
              fontFamily: 'monospace',
              fontSize: 11,
              lineHeight: 18,
              backgroundColor: gutterBackground,
              opacity: isUser ? 0.78 : 1,
            }}
          >
            {index + 1}
          </Text>
          <Text
            selectable
            style={{
              flex: 1,
              minWidth: Math.max(80, sourceMinWidth - lineNumberWidth),
              paddingTop: index === 0 ? 12 : 2,
              paddingBottom: index === lines.length - 1 ? 12 : 2,
              paddingHorizontal: 10,
              color: textColor,
              fontFamily: 'monospace',
              fontSize: 12,
              lineHeight: 18,
            }}
          >
            {line || ' '}
          </Text>
        </View>
      ))}
    </View>
  )
}

function FormulaBlockCard({ content, isUser, isStreaming, onLayoutChangeRequest }: { content: string; isUser: boolean; isStreaming: boolean; onLayoutChangeRequest?: () => void }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const { width } = useWindowDimensions()
  const [expanded, setExpanded] = useState(isUser || isStreaming)
  const userMessage = colors.ui.message
  const formula = normalizeFormulaContent(content)
  const formulaTokens = useMemo(() => tokenizeFormula(formula), [formula])
  const blockMinWidth = Math.max(richTextBlockMinWidth(width), Math.min(420, width - 78))
  const lineCount = countContentLines(formula)
  const collapsedLineCount = !expanded ? getHiddenRichBlockLineCount(formula, FORMULA_BLOCK_COLLAPSED_MAX_HEIGHT, true) : 0
  const formulaSurface = isUser ? userMessage.userActionBackground : colors.ui.card.mutedBackground
  const tokenColors: Record<FormulaTokenKind, string> = {
    plain: isUser ? userMessage.userForeground : colors.text,
    operator: isUser ? userMessage.userForeground : colors.ui.icon.accentForeground,
    function: isUser ? userMessage.userForeground : colors.ui.control.link,
    number: isUser ? userMessage.userForeground : colors.ui.tone.warning.foreground,
    symbol: isUser ? userMessage.userForeground : colors.textSecondary,
  }
  function toggleExpanded() {
    setExpanded((value) => !value)
    requestContentLayoutChange(onLayoutChangeRequest)
  }
  useEffect(() => {
    if (!isStreaming) return
    setExpanded(true)
  }, [isStreaming])

  return (
    <RichCard isUser={isUser} expanded={expanded}>
      <CardHeader
        icon={<Sigma color={isUser ? userMessage.userForeground : colors.ui.icon.accentForeground} size={14} strokeWidth={2.1} />}
        title={t('messageContent.formulaBlockTitle', { count: lineCount })}
        isUser={isUser}
        actions={isUser ? [] : [
          { label: t('common.copy'), kind: 'copy', onPress: () => Clipboard.setStringAsync(formula) },
          {
            label: expanded ? t('common.collapse') : t('common.expand'),
            kind: 'toggle',
            accessibilityHint: expanded ? t('messageContent.collapseBlockHint') : t('messageContent.expandBlockHint'),
            accessibilityState: { expanded },
            onPress: toggleExpanded,
          },
        ]}
      />
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator
        persistentScrollbar={RICH_BLOCK_SCROLL_INDICATOR_PERSISTENT}
        accessibilityLabel={t('messageContent.formulaScrollLabel')}
        accessibilityHint={t('messageContent.formulaScrollHint')}
        style={{ maxHeight: expanded ? undefined : FORMULA_BLOCK_COLLAPSED_MAX_HEIGHT }}
      >
        <View
          style={{
            minWidth: blockMinWidth,
            paddingHorizontal: 13,
            paddingVertical: 12,
            borderRadius: colors.ui.radius.card,
            backgroundColor: formulaSurface,
            borderWidth: isUser ? 0 : 1,
            borderColor: colors.material.stroke,
          }}
        >
          <Text
            selectable
            style={{
              color: isUser ? userMessage.userForeground : colors.text,
              fontFamily: 'monospace',
              fontSize: 14,
              lineHeight: 22,
            }}
          >
            {formulaTokens.map((token, index) => (
              <Text key={`${index}-${token.kind}-${token.content}`} style={{ color: tokenColors[token.kind], fontWeight: token.kind === 'operator' || token.kind === 'function' ? '900' : '700' }}>
                {token.content}
              </Text>
            ))}
          </Text>
        </View>
      </ScrollView>
      <CollapsedRichBlockNotice count={collapsedLineCount} isUser={isUser} />
    </RichCard>
  )
}

function TableBlockCard({ rows, title, isUser, isStreaming, onLayoutChangeRequest }: { rows: string[][]; title?: string; isUser: boolean; isStreaming: boolean; onLayoutChangeRequest?: () => void }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const { width } = useWindowDimensions()
  const safeRows = rows.length ? rows : [['']]
  const columnCount = Math.max(...safeRows.map((row) => row.length), 1)
  const normalizedRows = safeRows.map((row) => Array.from({ length: columnCount }, (_, index) => row[index] ?? ''))
  const displayTitle = t('messageContent.tableTitleWithShape', { title: title ?? t('messageContent.table'), rows: normalizedRows.length, columns: columnCount })
  const [expanded, setExpanded] = useState(isUser || isStreaming || rows.length <= 6)
  const visibleRows = expanded ? normalizedRows : normalizedRows.slice(0, 6)
  const tableScrollValue = t('messageContent.tableScrollValue', { rows: normalizedRows.length, columns: columnCount })
  const userMessage = colors.ui.message
  const userDivider = userMessage.userActionBackground
  const tableBorder = isUser ? userDivider : colors.material.stroke
  const tableHeaderBackground = isUser ? userMessage.userActionBackground : colors.ui.table.headerBackground
  const tableRowBackground = isUser ? 'transparent' : colors.ui.card.defaultBackground
  const tableStripeBackground = isUser ? undefined : colors.ui.card.mutedBackground
  const cellMetrics = tableCellMetrics(width)
  const columnWidths = Array.from({ length: columnCount }, (_, columnIndex) => {
    const maxCellLength = Math.max(...normalizedRows.map((row) => row[columnIndex]?.length ?? 0))
    return Math.max(
      cellMetrics.minWidth,
      Math.min(cellMetrics.maxWidth, cellMetrics.baseWidth + Math.min(maxCellLength, 28) * cellMetrics.charWidth)
    )
  })
  function toggleExpanded() {
    setExpanded((value) => !value)
    requestContentLayoutChange(onLayoutChangeRequest)
  }
  useEffect(() => {
    if (!isStreaming) return
    setExpanded(true)
  }, [isStreaming])

  return (
    <RichCard isUser={isUser} expanded={expanded}>
      <CardHeader
        icon={<Table2 color={isUser ? userMessage.userForeground : colors.ui.icon.accentForeground} size={14} strokeWidth={2.1} />}
        title={displayTitle}
        isUser={isUser}
        actions={isUser ? [] : [
          { label: t('common.copy'), kind: 'copy', onPress: () => Clipboard.setStringAsync(rows.map((row) => row.join('\t')).join('\n')) },
          ...(normalizedRows.length > 6 ? [{
            label: expanded ? t('common.collapse') : t('common.expand'),
            kind: 'toggle' as const,
            accessibilityHint: expanded ? t('messageContent.collapseBlockHint') : t('messageContent.expandBlockHint'),
            accessibilityState: { expanded },
            onPress: toggleExpanded,
          }] : []),
        ]}
      />
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator
        persistentScrollbar={RICH_BLOCK_SCROLL_INDICATOR_PERSISTENT}
        accessibilityLabel={t('messageContent.tableScrollLabel')}
        accessibilityHint={t('messageContent.tableScrollHint')}
        accessibilityValue={{ text: tableScrollValue }}
      >
        <View style={{ borderRadius: colors.ui.radius.card, overflow: 'hidden', borderWidth: 1, borderColor: tableBorder }}>
          {visibleRows.map((row, rowIndex) => (
            <View key={`${rowIndex}-${row.join('|')}`} style={{ flexDirection: 'row', alignItems: 'stretch', backgroundColor: rowIndex === 0 ? tableHeaderBackground : tableRowBackground }}>
              {row.map((cell, cellIndex) => (
                <View
                  key={`${rowIndex}-${cellIndex}`}
                  style={{
                    width: columnWidths[cellIndex] ?? cellMetrics.minWidth,
                    minHeight: 38,
                    paddingHorizontal: 10,
                    paddingVertical: 9,
                    borderRightWidth: cellIndex === row.length - 1 ? 0 : 1,
                    borderBottomWidth: rowIndex === visibleRows.length - 1 ? 0 : 1,
                    borderColor: tableBorder,
                    backgroundColor: rowIndex > 0 && rowIndex % 2 === 0 ? tableStripeBackground : undefined,
                  }}
                >
                  <Text
                    selectable
                    style={{
                      color: isUser ? userMessage.userForeground : rowIndex === 0 ? colors.text : colors.textSecondary,
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
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: isUser ? userMessage.userForeground : colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 8, fontWeight: '800' }}
        >
          {t('messageContent.collapsedRows', { count: normalizedRows.length - 6 })}
        </Text>
      ) : null}
    </RichCard>
  )
}

function DiagramBlockCard({ content, language, isUser, isStreaming, onLayoutChangeRequest }: { content: string; language?: string; isUser: boolean; isStreaming: boolean; onLayoutChangeRequest?: () => void }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const { width } = useWindowDimensions()
  const [expanded, setExpanded] = useState(isUser || isStreaming)
  const userMessage = colors.ui.message
  const blockMinWidth = richTextBlockMinWidth(width)
  const sourceLines = useMemo(() => splitSourceLines(content), [content])
  const diagramPreview = useMemo(() => buildDiagramPreview(content), [content])
  const hasDiagramPreview = diagramPreview.nodes.length > 0 || diagramPreview.edges.length > 0
  const collapsedLineCount = !expanded ? getHiddenRichBlockLineCount(content, DIAGRAM_BLOCK_COLLAPSED_MAX_HEIGHT) : 0
  function toggleExpanded() {
    setExpanded((value) => !value)
    requestContentLayoutChange(onLayoutChangeRequest)
  }
  useEffect(() => {
    if (!isStreaming) return
    setExpanded(true)
  }, [isStreaming])

  return (
    <RichCard isUser={isUser} expanded={expanded}>
      <CardHeader
        icon={<Workflow color={isUser ? userMessage.userForeground : colors.ui.icon.accentForeground} size={14} strokeWidth={2.1} />}
        title={t('messageContent.sourceCode', { language: language || 'diagram' })}
        isUser={isUser}
        actions={isUser ? [] : [
          { label: t('common.copy'), kind: 'copy', onPress: () => Clipboard.setStringAsync(content) },
          {
            label: expanded ? t('common.collapse') : t('common.expand'),
            kind: 'toggle',
            accessibilityHint: expanded ? t('messageContent.collapseBlockHint') : t('messageContent.expandBlockHint'),
            accessibilityState: { expanded },
            onPress: toggleExpanded,
          },
        ]}
      />
      {hasDiagramPreview ? (
        <DiagramPreviewPanel preview={diagramPreview} isUser={isUser} />
      ) : (
        <Text style={{ color: isUser ? userMessage.userForeground : colors.textSecondary, fontSize: 11, lineHeight: 16, marginBottom: 8, fontWeight: '800' }}>
          {t('messageContent.diagramFallback')}
        </Text>
      )}
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator
        persistentScrollbar={RICH_BLOCK_SCROLL_INDICATOR_PERSISTENT}
        accessibilityLabel={t('messageContent.horizontalScrollLabel')}
        accessibilityHint={t('messageContent.horizontalScrollHint')}
        style={{ maxHeight: expanded ? undefined : DIAGRAM_BLOCK_COLLAPSED_MAX_HEIGHT }}
      >
        <SourceLineRows
          lines={sourceLines}
          isUser={isUser}
          minWidth={blockMinWidth}
          surface={isUser ? userMessage.userActionBackground : colors.ui.card.mutedBackground}
          borderColor={colors.material.stroke}
          textColor={isUser ? userMessage.userForeground : colors.text}
          numberColor={isUser ? userMessage.userForeground : colors.textTertiary}
          gutterBackground={isUser ? userMessage.userActionBackground : colors.ui.card.defaultBackground}
        />
      </ScrollView>
      <CollapsedRichBlockNotice count={collapsedLineCount} isUser={isUser} />
    </RichCard>
  )
}

function DataBlockCard({ content, language, title, isUser, isStreaming, onLayoutChangeRequest }: { content: string; language?: string; title: string; isUser: boolean; isStreaming: boolean; onLayoutChangeRequest?: () => void }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const { width } = useWindowDimensions()
  const [expanded, setExpanded] = useState(isUser || isStreaming)
  const userMessage = colors.ui.message
  const blockMinWidth = richTextBlockMinWidth(width)
  const formattedContent = formatDataPreview(content, language)
  const dataLines = useMemo(() => splitSourceLines(formattedContent), [formattedContent])
  const collapsedLineCount = !expanded ? getHiddenRichBlockLineCount(formattedContent, DATA_BLOCK_COLLAPSED_MAX_HEIGHT) : 0
  const csvRows = language === 'csv' || language === 'tsv' ? parseDelimitedTable(content, language === 'tsv' ? '\t' : ',') : null
  useEffect(() => {
    if (!isStreaming) return
    setExpanded(true)
  }, [isStreaming])

  if (csvRows?.length) return <TableBlockCard rows={csvRows} title={title} isUser={isUser} isStreaming={isStreaming} onLayoutChangeRequest={onLayoutChangeRequest} />

  function toggleExpanded() {
    setExpanded((value) => !value)
    requestContentLayoutChange(onLayoutChangeRequest)
  }

  return (
    <RichCard isUser={isUser} expanded={expanded}>
      <CardHeader
        icon={<BarChart3 color={isUser ? userMessage.userForeground : colors.ui.icon.accentForeground} size={14} strokeWidth={2.1} />}
        title={title}
        isUser={isUser}
        actions={isUser ? [] : [
          { label: t('common.copy'), kind: 'copy', onPress: () => Clipboard.setStringAsync(content) },
          {
            label: expanded ? t('common.collapse') : t('common.expand'),
            kind: 'toggle',
            accessibilityHint: expanded ? t('messageContent.collapseBlockHint') : t('messageContent.expandBlockHint'),
            accessibilityState: { expanded },
            onPress: toggleExpanded,
          },
        ]}
      />
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator
        persistentScrollbar={RICH_BLOCK_SCROLL_INDICATOR_PERSISTENT}
        accessibilityLabel={t('messageContent.horizontalScrollLabel')}
        accessibilityHint={t('messageContent.horizontalScrollHint')}
        style={{ maxHeight: expanded ? undefined : DATA_BLOCK_COLLAPSED_MAX_HEIGHT }}
      >
        <SourceLineRows
          lines={dataLines}
          isUser={isUser}
          minWidth={blockMinWidth}
          surface={isUser ? userMessage.userActionBackground : colors.ui.card.mutedBackground}
          borderColor={colors.material.stroke}
          textColor={isUser ? userMessage.userForeground : colors.text}
          numberColor={isUser ? userMessage.userForeground : colors.textTertiary}
          gutterBackground={isUser ? userMessage.userActionBackground : colors.ui.card.defaultBackground}
        />
      </ScrollView>
      <CollapsedRichBlockNotice count={collapsedLineCount} isUser={isUser} />
    </RichCard>
  )
}

function DiagramPreviewPanel({ preview, isUser }: { preview: DiagramPreview; isUser: boolean }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const userMessage = colors.ui.message
  const foreground = isUser ? userMessage.userForeground : colors.textSecondary
  const nodeForeground = isUser ? userMessage.userForeground : colors.text
  const nodeSurface = isUser ? userMessage.userActionBackground : colors.ui.card.mutedBackground
  const connectorColor = isUser ? userMessage.userForeground : colors.ui.icon.accentForeground

  return (
    <View
      style={{
        gap: 8,
        marginBottom: 10,
        padding: 10,
        borderRadius: colors.ui.radius.card,
        backgroundColor: isUser ? userMessage.userActionBackground : colors.ui.card.defaultBackground,
        borderWidth: isUser ? 0 : 1,
        borderColor: colors.material.stroke,
      }}
    >
      {preview.edges.length ? (
        <View style={{ gap: 7 }}>
          {preview.edges.map((edge, index) => (
            <View key={`${index}-${edge.from}-${edge.to}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 30 }}>
              <DiagramNodePill label={edge.from} foreground={nodeForeground} surface={nodeSurface} border={colors.material.stroke} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                <View style={{ width: 18, height: 1, backgroundColor: connectorColor, opacity: 0.75 }} />
                <Text style={{ color: connectorColor, fontSize: 13, fontWeight: '900' }}>›</Text>
              </View>
              <DiagramNodePill label={edge.to} foreground={nodeForeground} surface={nodeSurface} border={colors.material.stroke} />
              {edge.label ? (
                <Text numberOfLines={1} style={{ flex: 1, color: foreground, fontSize: 11, lineHeight: 15, fontWeight: '800' }}>
                  {edge.label}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      {preview.nodes.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {preview.nodes.map((node) => (
            <DiagramNodePill key={node} label={node} foreground={nodeForeground} surface={nodeSurface} border={colors.material.stroke} />
          ))}
        </View>
      ) : null}
      {preview.hiddenNodeCount > 0 || preview.hiddenEdgeCount > 0 ? (
        <Text style={{ color: foreground, fontSize: 11, lineHeight: 15, fontWeight: '800' }}>
          {t('messageContent.diagramPreviewHidden', { nodes: preview.hiddenNodeCount, edges: preview.hiddenEdgeCount })}
        </Text>
      ) : null}
    </View>
  )
}

function DiagramNodePill({ label, foreground, surface, border }: { label: string; foreground: string; surface: string; border: string }) {
  return (
    <View
      style={{
        maxWidth: 160,
        minHeight: 30,
        justifyContent: 'center',
        paddingHorizontal: 10,
        borderRadius: 999,
        backgroundColor: surface,
        borderWidth: 1,
        borderColor: border,
      }}
    >
      <Text numberOfLines={1} style={{ color: foreground, fontSize: 11, lineHeight: 15, fontWeight: '900' }}>
        {label}
      </Text>
    </View>
  )
}

function countContentLines(content: string): number {
  const trimmed = content.trimEnd()
  if (!trimmed) return 1
  return trimmed.split(/\r?\n/).length
}

function normalizeFormulaContent(content: string): string {
  const trimmed = content.trim()
  return trimmed
    .replace(/^\$\$\s*/, '')
    .replace(/\s*\$\$$/, '')
    .replace(/^\\\[\s*/, '')
    .replace(/\s*\\\]$/, '')
    .trim() || trimmed
}

function splitSourceLines(content: string): string[] {
  const trimmed = content.trimEnd()
  return (trimmed || content || ' ').split(/\r?\n/)
}

function longestLineLength(lines: string[]): number {
  return Math.max(1, ...lines.map((line) => line.length))
}

function tokenizeFormula(formula: string): FormulaToken[] {
  const tokens: FormulaToken[] = []
  const regex = /(\\[A-Za-z]+|\d+(?:\.\d+)?|[A-Za-z][A-Za-z0-9_]*|[=+\-*/^_<>()[\]{}|,.:;]|[\s]+|.)/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(formula)) !== null) {
    const content = match[0]
    if (!content) continue
    tokens.push({ content, kind: classifyFormulaToken(content) })
  }
  return tokens.length ? tokens : [{ content: formula, kind: 'plain' }]
}

function classifyFormulaToken(token: string): FormulaTokenKind {
  if (/^\s+$/.test(token)) return 'plain'
  if (/^\\[A-Za-z]+$/.test(token)) return 'function'
  if (/^\d+(?:\.\d+)?$/.test(token)) return 'number'
  if (/^[=+\-*/^_<>()[\]{}|,.:;]$/.test(token)) return 'operator'
  if (/^[A-Za-z][A-Za-z0-9_]*$/.test(token)) return 'symbol'
  return 'plain'
}

function buildDiagramPreview(content: string): DiagramPreview {
  const allEdges: DiagramEdgePreview[] = []
  const allNodes: string[] = []
  const addNode = (label: string) => {
    const normalized = normalizeDiagramNodeLabel(label)
    if (normalized && !allNodes.includes(normalized)) allNodes.push(normalized)
    return normalized
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = stripDiagramLine(rawLine)
    if (!line) continue
    const edge = parseDiagramEdge(line)
    if (edge) {
      const from = addNode(edge.from)
      const to = addNode(edge.to)
      if (from && to) allEdges.push({ from, to, label: edge.label })
      continue
    }
    const standalone = parseDiagramStandaloneNode(line)
    if (standalone) addNode(standalone)
  }

  return {
    nodes: allNodes.slice(0, DIAGRAM_PREVIEW_NODE_LIMIT),
    edges: allEdges.slice(0, DIAGRAM_PREVIEW_EDGE_LIMIT),
    hiddenNodeCount: Math.max(0, allNodes.length - DIAGRAM_PREVIEW_NODE_LIMIT),
    hiddenEdgeCount: Math.max(0, allEdges.length - DIAGRAM_PREVIEW_EDGE_LIMIT),
  }
}

function stripDiagramLine(line: string): string {
  return line
    .trim()
    .replace(/^\s*(graph|flowchart|sequenceDiagram|stateDiagram-v2|classDiagram|digraph)\b.*$/i, '')
    .replace(/;$/, '')
    .trim()
}

function parseDiagramEdge(line: string): DiagramEdgePreview | null {
  const normalized = line.replace(/\s+/g, ' ')
  const edgeMatch = normalized.match(/^(.+?)\s*(?:-{1,2}>|={1,2}>|--|->|=>)\s*(.+)$/)
  if (!edgeMatch) return null
  const from = edgeMatch[1] ?? ''
  const rawTo = edgeMatch[2] ?? ''
  const labelMatch = rawTo.match(/^(.*?)\s*[:|]\s*(.+)$/)
  return {
    from,
    to: labelMatch?.[1] ?? rawTo,
    label: labelMatch?.[2]?.trim(),
  }
}

function parseDiagramStandaloneNode(line: string): string | null {
  if (/^(subgraph|end|style|classDef|class|linkStyle|click)\b/i.test(line)) return null
  const match = line.match(/^([A-Za-z0-9_.-]+)(?:\s*[\[{(].*[\]})])?$/)
  return match?.[1] ?? null
}

function normalizeDiagramNodeLabel(label: string): string {
  return label
    .replace(/^\s*["']?/, '')
    .replace(/["']?\s*$/, '')
    .replace(/^([A-Za-z0-9_.-]+)\s*[\[{(]\s*["']?/, '$1 ')
    .replace(/["']?\s*[\]})]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

function getHiddenRichBlockLineCount(content: string, maxHeight: number, includesVerticalPadding = false): number {
  const visibleHeight = Math.max(RICH_BLOCK_TEXT_LINE_HEIGHT, maxHeight - (includesVerticalPadding ? RICH_BLOCK_TEXT_VERTICAL_PADDING : 0))
  const visibleLineCount = Math.max(1, Math.floor(visibleHeight / RICH_BLOCK_TEXT_LINE_HEIGHT))
  const lineCount = content.trimEnd().split('\n').length
  return Math.max(0, lineCount - visibleLineCount)
}

function CollapsedRichBlockNotice({ count, isUser }: { count: number; isUser: boolean }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  if (count <= 0) return null
  return (
    <Text
      accessibilityLiveRegion="polite"
      style={{
        color: isUser ? colors.ui.message.userForeground : colors.textTertiary,
        fontSize: 11,
        lineHeight: 16,
        marginTop: 8,
        fontWeight: '800',
      }}
    >
      {t('messageContent.collapsedBlockLines', { count })}
    </Text>
  )
}

function requestContentLayoutChange(onLayoutChangeRequest?: () => void) {
  requestAnimationFrame(() => onLayoutChangeRequest?.())
  setTimeout(() => onLayoutChangeRequest?.(), 80)
}

function RichCard({ isUser, expanded, children }: { isUser: boolean; expanded?: boolean; children: ReactNode }) {
  const { colors } = useAppTheme()
  const userMessage = colors.ui.message
  return (
    <IslePanel
      elevated={!isUser}
      material={isUser ? 'transparent' : 'raised'}
      contentStyle={{ padding: 10 }}
      style={{
        borderRadius: expanded ? 24 : 20,
        backgroundColor: isUser ? userMessage.userActionBackground : colors.ui.card.defaultBackground,
        borderColor: isUser ? userMessage.userActionBackground : colors.material.stroke,
      }}
    >
      {children}
    </IslePanel>
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
  actions: RichCardAction[]
  isUser: boolean
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [actionFeedback, setActionFeedback] = useState<{ key: string; label: string; failed: boolean } | null>(null)
  const userMessage = colors.ui.message
  const actionSurface = isUser ? userMessage.userActionBackground : colors.ui.card.mutedBackground

  useEffect(() => {
    return () => {
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
      feedbackTimer.current = null
    }
  }, [])

  function actionKey(action: RichCardAction) {
    return `${action.kind ?? 'action'}:${action.label}`
  }

  function showActionFeedback(action: RichCardAction, label: string, failed = false) {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
    setActionFeedback({ key: actionKey(action), label, failed })
    feedbackTimer.current = setTimeout(() => {
      feedbackTimer.current = null
      setActionFeedback(null)
    }, RICH_BLOCK_COPY_FEEDBACK_MS)
  }

  function runAction(action: RichCardAction) {
    return () => {
      const result = action.onPress()
      if (action.kind !== 'copy') return
      void Promise.resolve(result)
        .then(() => showActionFeedback(action, t('common.copied')))
        .catch(() => showActionFeedback(action, t('common.copyFailed'), true))
    }
  }

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 }}>
      <View style={{ width: 24, height: 24, borderRadius: colors.ui.radius.controlSmall, alignItems: 'center', justifyContent: 'center', backgroundColor: actionSurface }}>
        {icon}
      </View>
      <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: isUser ? userMessage.userForeground : colors.text, fontSize: 12, fontWeight: '900' }}>
        {title}
      </Text>
      {actions.map((action) => {
        const key = actionKey(action)
        const feedback = actionFeedback?.key === key ? actionFeedback : null
        const displayLabel = feedback?.label ?? action.label
        const accessibilityHint = action.accessibilityHint ?? (action.kind === 'copy' ? t('messageContent.copyBlockHint') : undefined)
        const foreground = feedback?.failed ? colors.ui.tone.danger.foreground : isUser ? userMessage.userForeground : colors.textTertiary
        return (
          <IslePressable
            key={key}
            haptic
            accessibilityRole="button"
            onPress={runAction(action)}
            accessibilityLabel={displayLabel}
            accessibilityHint={accessibilityHint}
            accessibilityState={action.accessibilityState}
            hitSlop={RICH_BLOCK_ACTION_HIT_SLOP}
            style={{
              minHeight: 36,
              borderRadius: colors.ui.radius.chip,
              paddingHorizontal: 10,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              backgroundColor: feedback?.failed ? colors.ui.tone.danger.background : actionSurface,
              borderWidth: feedback?.failed ? 1 : 0,
              borderColor: feedback?.failed ? colors.ui.tone.danger.border : 'transparent',
            }}
          >
            {action.kind === 'copy' ? <Copy color={foreground} size={11} strokeWidth={2.2} /> : null}
            {action.kind !== 'copy' ? (
              <MotiView animate={{ rotate: action.accessibilityState?.expanded ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: 160 }}>
                <ChevronDown color={foreground} size={11} strokeWidth={2.2} />
              </MotiView>
            ) : null}
            <Text
              numberOfLines={1}
              accessibilityLiveRegion={feedback ? 'polite' : undefined}
              style={{ color: foreground, fontSize: 11, fontWeight: '900', maxWidth: 88 }}
            >
              {displayLabel}
            </Text>
          </IslePressable>
        )
      })}
    </View>
  )
}

function parseRichContent(content: string, t: TFunction): RichSegment[] {
  const segments: RichSegment[] = []
  const fenceRegex = /```([^\n`]*)\n?([\s\S]*?)```/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let index = 0

  while ((match = fenceRegex.exec(content))) {
    if (match.index > lastIndex) {
      segments.push(...parseTextSegments(content.slice(lastIndex, match.index), index, t))
      index = segments.length
    }
    const language = normalizeLanguage(match[1])
    const body = match[2] ?? ''
    segments.push(createFencedSegment(index, language, body, t))
    index = segments.length
    lastIndex = fenceRegex.lastIndex
  }

  if (lastIndex < content.length) {
    segments.push(...parseTextSegments(content.slice(lastIndex), index, t))
  }

  return segments.filter((segment) => segment.type !== 'markdown' || segment.content.trim())
}

function createFencedSegment(index: number, language: string | undefined, content: string, t: TFunction): RichSegment {
  if (language && FORMULA_LANGUAGES.has(language)) {
    return { id: `formula-${index}`, type: 'formula', content }
  }
  if (language && DIAGRAM_LANGUAGES.has(language)) {
    return { id: `diagram-${index}`, type: 'diagram', content, language }
  }
  if (language && DATA_LANGUAGES.has(language)) {
    if (language === 'csv' || language === 'tsv') {
      return { id: `data-${index}`, type: 'data', content, language, title: language.toUpperCase() }
    }
    if (language === 'json' || language === 'jsonc') {
      return { id: `data-${index}`, type: 'data', content, language, title: t('messageContent.jsonData') }
    }
    return { id: `data-${index}`, type: 'data', content, language, title: t('messageContent.chartData') }
  }
  return { id: `code-${index}`, type: 'code', content, language }
}

type FormulaTextChunk =
  | { type: 'text'; content: string }
  | { type: 'formula'; content: string }

function parseTextSegments(text: string, startIndex: number, t: TFunction): RichSegment[] {
  const chunks = splitFormulaBlocks(text)
  const segments: RichSegment[] = []
  let index = startIndex
  for (const chunk of chunks) {
    if (chunk.type === 'formula') {
      const content = normalizeFormulaContent(chunk.content)
      if (content) {
        segments.push({ id: `formula-${index}`, type: 'formula', content })
        index += 1
      }
      continue
    }
    const parsed = parsePlainTextSegments(chunk.content, index, t)
    segments.push(...parsed)
    index += parsed.length
  }
  return segments
}

function splitFormulaBlocks(text: string): FormulaTextChunk[] {
  const chunks: FormulaTextChunk[] = []
  const formulaRegex = /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\])/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = formulaRegex.exec(text)) !== null) {
    if (match.index > lastIndex) chunks.push({ type: 'text', content: text.slice(lastIndex, match.index) })
    chunks.push({ type: 'formula', content: match[0] ?? '' })
    lastIndex = formulaRegex.lastIndex
  }
  if (lastIndex < text.length) chunks.push({ type: 'text', content: text.slice(lastIndex) })
  return chunks
}

function parsePlainTextSegments(text: string, startIndex: number, t: TFunction): RichSegment[] {
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
      segments.push({ id: `data-${index}`, type: 'data', content: trimmed, language: 'json', title: t('messageContent.jsonData') })
    } else if (looksLikeCsv(trimmed)) {
      segments.push({ id: `table-${index}`, type: 'table', rows: parseDelimitedTable(trimmed, ',') ?? [[trimmed]], title: t('messageContent.csvData') })
    } else {
      segments.push({ id: `markdown-${index}`, type: 'markdown', content: normalizeInlineFormulaForMarkdown(raw) })
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
      segments.push({ id: `table-${index}`, type: 'table', rows: parseMarkdownTable(tableLines), title: t('messageContent.markdownTable') })
      index += 1
    } else if (looksLikeStandaloneFormulaLine(lines[lineIndex])) {
      flushBuffer()
      const formulaLines = [lines[lineIndex]]
      lineIndex += 1
      while (lineIndex < lines.length && looksLikeStandaloneFormulaLine(lines[lineIndex])) {
        formulaLines.push(lines[lineIndex])
        lineIndex += 1
      }
      lineIndex -= 1
      segments.push({ id: `formula-${index}`, type: 'formula', content: formulaLines.join('\n') })
      index += 1
    } else {
      buffer.push(lines[lineIndex])
    }
  }
  flushBuffer()
  return segments
}

function normalizeInlineFormulaForMarkdown(content: string): string {
  return content
    .replace(/\\\(([\s\S]*?)\\\)/g, (match: string, formula: string) => {
      const normalized = normalizeInlineFormula(formula)
      return normalized ?? match
    })
    .replace(/(^|[\s([{:;])\$([^$\n]{1,180})\$([\s)\]},.;:!?]|$)/g, (match: string, before: string, formula: string, after: string) => {
      const normalized = normalizeInlineFormula(formula)
      return normalized ? `${before}${normalized}${after}` : match
    })
}

function normalizeInlineFormula(formula: string): string | null {
  const trimmed = formula.trim()
  if (!looksLikeInlineFormula(trimmed) || trimmed.includes('`')) return null
  return `\`${trimmed}\``
}

function looksLikeInlineFormula(value: string): boolean {
  if (!value || value.length > 180 || value.includes('\n')) return false
  if (/^\d+(?:[.,]\d+)?$/.test(value)) return false
  if (/^[A-Za-z][A-Za-z0-9_{}^\\ ]{0,32}$/.test(value)) return true
  return /(?:=|<=|>=|->|\\to|\\frac|\\sqrt|\\sum|\\int|\\lim|\\Delta|\\pi|\\theta|\\alpha|\\beta|\^|_|[+\-*/<>])/.test(value)
}

function looksLikeStandaloneFormulaLine(line: string | undefined): boolean {
  const trimmed = line?.trim() ?? ''
  if (!trimmed || trimmed.length > 220) return false
  if (/^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```|~~~)/.test(trimmed)) return false
  if (/^(const|let|var|function|return|if|for|while|class|import|export|type|interface)\b/.test(trimmed)) return false
  if (/[{};]$/.test(trimmed)) return false
  if (!looksLikeInlineFormula(trimmed)) return false
  if (!/(?:=|<=|>=|->|\\to|\\frac|\\sqrt|\\sum|\\int|\\lim|\^|_)/.test(trimmed)) return false
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length
  return wordCount <= 18 || /[\\^_{}]/.test(trimmed)
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
