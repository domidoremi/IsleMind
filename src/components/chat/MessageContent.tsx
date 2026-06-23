import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import Markdown from 'react-native-markdown-display'
import type { RenderRules } from 'react-native-markdown-display'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { useAppTheme } from '@/hooks/useAppTheme'
import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
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
const CJK_TEXT_PATTERN = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/
const LATEX_FORMULA_COMMAND_PATTERN = /\\(?:to|frac|sqrt|sum|int|lim|prod|Delta|pi|theta|alpha|beta|gamma|lambda|mu|sigma|omega|left|right|cdot|times|leq|geq|neq|approx|infty)\b/
const FORMULA_IDENTIFIER_BASE_PATTERN = /^(?:[A-Za-z]{1,3}|alpha|beta|gamma|theta|lambda|sigma|omega|delta|Delta)$/i
const RICH_BLOCK_ACTION_HIT_SLOP = { top: 8, right: 8, bottom: 8, left: 8 }
const RICH_BLOCK_COPY_FEEDBACK_MS = 1300
const DIAGRAM_PREVIEW_NODE_LIMIT = 8
const DIAGRAM_PREVIEW_EDGE_LIMIT = 6
const STACKED_TABLE_COLUMN_THRESHOLD = 4

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

interface DataSummaryItem {
  label: string
  value: string
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
  kind: 'copy'
  accessibilityHint?: string
  onPress: () => void | Promise<unknown>
}

function resolveAssistantRichSurfaces(colors: ReturnType<typeof useAppTheme>['colors']) {
  return {
    blockSurface: colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.cartoon ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.muted,
    blockRaisedSurface: colors.ui.glass ? colors.ui.semantic.chrome.background : colors.ui.cartoon ? colors.ui.semantic.surface.base : colors.ui.semantic.surface.muted,
    blockBorder: colors.ui.cartoon ? colors.material.stroke : colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border,
    gutterSurface: colors.ui.glass ? colors.ui.semantic.chrome.background : colors.ui.cartoon ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.muted,
    stripeSurface: colors.ui.glass ? colors.ui.actionBar.itemActiveBackground : colors.ui.cartoon ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.overlay,
    headerActionSurface: colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.cartoon ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.muted,
    richCardSurface: colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.cartoon ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.muted,
    nestedPanelSurface: colors.ui.glass ? colors.ui.semantic.chrome.background : colors.ui.cartoon ? colors.ui.semantic.surface.base : 'transparent',
    inlineMetaSurface: colors.ui.glass ? colors.ui.actionBar.itemActiveBackground : colors.ui.cartoon ? colors.ui.semantic.surface.muted : 'transparent',
    inlineMetaBorder: colors.ui.cartoon ? colors.material.stroke : colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border,
    nodeSurface: colors.ui.glass ? colors.ui.actionBar.itemActiveBackground : colors.ui.cartoon ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.muted,
    nestedBorderWidth: colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth,
    chipBorderWidth: colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth,
  }
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

export const MessageContent = memo(function MessageContent({ content, isUser = false, isStreaming = false }: MessageContentProps) {
  const { t } = useTranslation()
  const segments = useMemo(() => safeParseRichContent(content, t, isStreaming), [content, isStreaming, t])

  return (
    <View style={{ gap: 5, width: '100%', maxWidth: '100%', overflow: 'hidden' }}>
      {segments.map((segment) => {
        if (segment.type === 'markdown') return <RichMarkdown key={segment.id} content={segment.content} isUser={isUser} isStreaming={isStreaming} />
        if (segment.type === 'table') return <TableBlockCard key={segment.id} rows={segment.rows} title={segment.title} isUser={isUser} />
        if (segment.type === 'formula') return <FormulaBlockCard key={segment.id} content={segment.content} isUser={isUser} />
        if (segment.type === 'diagram') return <DiagramBlockCard key={segment.id} content={segment.content} language={segment.language} isUser={isUser} />
        if (segment.type === 'data') return <DataBlockCard key={segment.id} content={segment.content} language={segment.language} title={segment.title} isUser={isUser} />
        return <CodeBlockCard key={segment.id} content={segment.content} language={segment.language} isUser={isUser} />
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

function safeParseRichContent(content: string, t: TFunction, isStreaming: boolean): RichSegment[] {
  try {
    const input = isStreaming ? normalizeStreamingMarkdown(content, true) : content
    const segments = parseRichContent(input, t)
    return segments.length ? segments : [{ id: 'markdown-empty', type: 'markdown', content }]
  } catch {
    return [{ id: 'markdown-fallback', type: 'markdown', content }]
  }
}

function RichMarkdown({ content, isUser, isStreaming }: { content: string; isUser: boolean; isStreaming: boolean }) {
  const { colors } = useAppTheme()
  const userMessage = colors.ui.message
  const assistantSurfaces = resolveAssistantRichSurfaces(colors)
  const inlineCodeBackground = isUser ? userMessage.userActionBackground : assistantSurfaces.blockSurface
  const blockSurface = isUser ? userMessage.userActionBackground : assistantSurfaces.blockSurface
  const blockBorder = isUser ? userMessage.userActionBackground : assistantSurfaces.blockBorder
  const codeSurface = isUser ? userMessage.userActionBackground : colors.ui.code.background
  const mutedForeground = isUser ? userMessage.userForeground : colors.textTertiary

  const normalizedContent = useMemo(
    () => normalizeStreamingMarkdown(content, isStreaming),
    [content, isStreaming]
  )

  return (
    <View style={{ maxWidth: '100%', overflow: 'hidden' }}>
      <Markdown
        rules={SELECTABLE_MARKDOWN_RULES}
        style={{
          body: { color: isUser ? userMessage.userForeground : colors.text, fontSize: 15, lineHeight: 23, includeFontPadding: !isUser },
          heading1: { color: isUser ? userMessage.userForeground : colors.text, fontSize: 20, lineHeight: 26, marginTop: 4, marginBottom: 8, fontWeight: '900' },
          heading2: { color: isUser ? userMessage.userForeground : colors.text, fontSize: 18, lineHeight: 24, marginTop: 4, marginBottom: 8, fontWeight: '900' },
          heading3: { color: isUser ? userMessage.userForeground : colors.text, fontSize: 16, lineHeight: 22, marginTop: 4, marginBottom: 7, fontWeight: '900' },
          paragraph: { marginTop: 0, marginBottom: isUser ? 0 : 5 },
          link: { color: isUser ? userMessage.userForeground : colors.ui.control.link, fontWeight: '900' },
          bullet_list: {
            marginTop: 2,
            marginBottom: 6,
            paddingVertical: 0,
            paddingHorizontal: 0,
            borderLeftWidth: 0,
            borderLeftColor: 'transparent',
          },
          ordered_list: {
            marginTop: 2,
            marginBottom: 6,
            paddingVertical: 0,
            paddingHorizontal: 0,
            borderLeftWidth: 0,
            borderLeftColor: 'transparent',
          },
          list_item: {
            marginBottom: 2,
          },
          bullet_list_icon: {
            color: isUser ? userMessage.userForeground : colors.ui.icon.accentForeground,
            fontWeight: '900',
            lineHeight: 23,
            marginRight: 5,
          },
          ordered_list_icon: {
            color: isUser ? userMessage.userForeground : colors.ui.icon.accentForeground,
            fontWeight: '900',
            lineHeight: 23,
            marginRight: 5,
            minWidth: 18,
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
            borderLeftWidth: isUser ? 0 : colors.ui.cartoon ? 2 : 1,
            borderLeftColor: isUser ? userMessage.userForeground : colors.ui.icon.accentForeground,
            borderRadius: colors.ui.radius.controlSmall,
            paddingHorizontal: 8,
            paddingVertical: 6,
            marginBottom: 6,
          },
          hr: {
            backgroundColor: blockBorder,
            height: 1,
            marginTop: 6,
            marginBottom: 8,
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
            borderWidth: isUser ? 0 : colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth,
            borderRadius: colors.ui.radius.card,
            padding: 8,
          },
          fence: {
            color: isUser ? userMessage.userForeground : colors.ui.code.text,
            backgroundColor: codeSurface,
            borderColor: isUser ? 'transparent' : colors.ui.code.border,
            borderWidth: isUser ? 0 : colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth,
            borderRadius: colors.ui.radius.card,
            padding: 8,
          },
          table: { borderColor: blockBorder, borderWidth: colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth, borderRadius: colors.ui.radius.card, backgroundColor: blockSurface },
          thead: { backgroundColor: isUser ? userMessage.userActionBackground : colors.ui.table.headerBackground },
          tbody: { backgroundColor: blockSurface },
          th: { borderColor: blockBorder, backgroundColor: isUser ? userMessage.userActionBackground : colors.ui.table.headerBackground },
          tr: { borderColor: blockBorder },
          td: { borderColor: blockBorder, backgroundColor: blockSurface },
        }}
      >
        {normalizedContent}
      </Markdown>
    </View>
  )
}

function CodeBlockCard({ content, language, isUser }: { content: string; language?: string; isUser: boolean }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const label = language?.trim() || 'code'
  const userMessage = colors.ui.message
  const assistantSurfaces = resolveAssistantRichSurfaces(colors)
  const codeSurface = isUser ? userMessage.userActionBackground : colors.ui.code.background
  const lineCount = countContentLines(content)
  const codeLines = useMemo(() => splitSourceLines(content), [content])

  return (
    <RichCard isUser={isUser}>
      <CardHeader
        icon={<AppIcon name="code" color={isUser ? userMessage.userForeground : colors.ui.icon.accentForeground} size={14} strokeWidth={appIconStroke.strong} />}
        title={t('messageContent.codeBlockTitle', { language: label, count: lineCount })}
        isUser={isUser}
        actions={isUser ? [] : [
          { label: t('common.copy'), kind: 'copy', onPress: () => Clipboard.setStringAsync(content) },
        ]}
      />
      <SourceLineRows
        lines={codeLines}
        isUser={isUser}
        surface={codeSurface}
        borderColor={colors.ui.code.border}
        textColor={isUser ? userMessage.userForeground : colors.ui.code.text}
        numberColor={isUser ? userMessage.userForeground : colors.textTertiary}
        gutterBackground={isUser ? userMessage.userActionBackground : assistantSurfaces.gutterSurface}
      />
    </RichCard>
  )
}

function SourceLineRows({
  lines,
  isUser,
  surface,
  borderColor,
  textColor,
  numberColor,
  gutterBackground,
}: {
  lines: string[]
  isUser: boolean
  surface: string
  borderColor: string
  textColor: string
  numberColor: string
  gutterBackground: string
}) {
  const { colors } = useAppTheme()
  const lineNumberWidth = Math.max(34, String(lines.length).length * 8 + 18)
  const assistantSurfaces = resolveAssistantRichSurfaces(colors)
  return (
    <View
      style={{
        width: '100%',
        minWidth: 0,
        borderRadius: colors.ui.radius.card,
        overflow: 'hidden',
        backgroundColor: surface,
        borderWidth: isUser ? 0 : assistantSurfaces.nestedBorderWidth,
        borderColor,
      }}
    >
      {lines.map((line, index) => (
        <View
          key={`${index}-${line.slice(0, 12)}`}
          style={{
            flexDirection: 'row',
            alignItems: 'stretch',
            backgroundColor: !isUser && index % 2 === 1 && !colors.ui.minimal ? assistantSurfaces.stripeSurface : undefined,
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
              minWidth: 0,
              flexShrink: 1,
              flexBasis: 0,
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

function FormulaBlockCard({ content, isUser }: { content: string; isUser: boolean }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const userMessage = colors.ui.message
  const assistantSurfaces = resolveAssistantRichSurfaces(colors)
  const formula = normalizeFormulaContent(content)
  const formulaTokens = useMemo(() => tokenizeFormula(formula), [formula])
  const lineCount = countContentLines(formula)
  const formulaSurface = isUser ? userMessage.userActionBackground : assistantSurfaces.blockSurface
  const tokenColors: Record<FormulaTokenKind, string> = {
    plain: isUser ? userMessage.userForeground : colors.text,
    operator: isUser ? userMessage.userForeground : colors.ui.icon.accentForeground,
    function: isUser ? userMessage.userForeground : colors.ui.control.link,
    number: isUser ? userMessage.userForeground : colors.ui.tone.warning.foreground,
    symbol: isUser ? userMessage.userForeground : colors.textSecondary,
  }

  return (
    <RichCard isUser={isUser}>
      <CardHeader
        icon={<AppIcon name="sigma" color={isUser ? userMessage.userForeground : colors.ui.icon.accentForeground} size={14} strokeWidth={appIconStroke.strong} />}
        title={t('messageContent.formulaBlockTitle', { count: lineCount })}
        isUser={isUser}
        actions={isUser ? [] : [
          { label: t('common.copy'), kind: 'copy', onPress: () => Clipboard.setStringAsync(formula) },
        ]}
      />
      <View
        style={{
          width: '100%',
          paddingHorizontal: 13,
          paddingVertical: 12,
          borderRadius: colors.ui.radius.card,
          backgroundColor: formulaSurface,
          borderWidth: isUser ? 0 : assistantSurfaces.nestedBorderWidth,
          borderColor: assistantSurfaces.blockBorder,
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
    </RichCard>
  )
}

function TableBlockCard({ rows, title, isUser }: { rows: string[][]; title?: string; isUser: boolean }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const { width } = useWindowDimensions()
  const safeRows = rows.length ? rows : [['']]
  const columnCount = Math.max(...safeRows.map((row) => row.length), 1)
  const normalizedRows = safeRows.map((row) => Array.from({ length: columnCount }, (_, index) => row[index] ?? ''))
  const displayTitle = t('messageContent.tableTitleWithShape', { title: title ?? t('messageContent.table'), rows: normalizedRows.length, columns: columnCount })
  const userMessage = colors.ui.message
  const assistantSurfaces = resolveAssistantRichSurfaces(colors)
  const userDivider = userMessage.userActionBackground
  const tableBorder = isUser ? userDivider : assistantSurfaces.blockBorder
  const tableHeaderBackground = isUser ? userMessage.userActionBackground : colors.ui.table.headerBackground
  const tableRowBackground = isUser ? 'transparent' : assistantSurfaces.blockSurface
  const tableStripeBackground = isUser ? undefined : colors.ui.glass ? assistantSurfaces.stripeSurface : colors.ui.cartoon ? assistantSurfaces.blockRaisedSurface : undefined
  const cellMetrics = tableCellMetrics(width)
  const columnWidths = Array.from({ length: columnCount }, (_, columnIndex) => {
    const maxCellLength = Math.max(...normalizedRows.map((row) => visualTextLength(row[columnIndex] ?? '')))
    return Math.max(
      cellMetrics.minWidth,
      Math.min(cellMetrics.maxWidth, cellMetrics.baseWidth + Math.min(maxCellLength, 30) * cellMetrics.charWidth)
    )
  })
  const tableMinWidth = columnWidths.reduce((total, columnWidth) => total + columnWidth, 0)
  const shouldStackRows = columnCount > STACKED_TABLE_COLUMN_THRESHOLD || width < 420 || tableMinWidth > width - 32
  const headers = normalizedRows[0] ?? []
  const bodyRows = normalizedRows.slice(1)

  return (
    <RichCard isUser={isUser}>
      <CardHeader
        icon={<AppIcon name="table" color={isUser ? userMessage.userForeground : colors.ui.icon.accentForeground} size={14} strokeWidth={appIconStroke.strong} />}
        title={displayTitle}
        isUser={isUser}
        actions={isUser ? [] : [
          { label: t('common.copy'), kind: 'copy', onPress: () => Clipboard.setStringAsync(rows.map((row) => row.join('\t')).join('\n')) },
        ]}
      />
      {shouldStackRows ? (
        <StackedTableRows
          headers={headers}
          rows={bodyRows}
          isUser={isUser}
        />
      ) : (
        <View style={{ minWidth: tableMinWidth, borderRadius: colors.ui.radius.card, overflow: 'hidden', borderWidth: isUser ? 0 : assistantSurfaces.nestedBorderWidth, borderColor: tableBorder }}>
          {normalizedRows.map((row, rowIndex) => (
            <View key={`${rowIndex}-${row.join('|')}`} style={{ flexDirection: 'row', alignItems: 'stretch', backgroundColor: rowIndex === 0 ? tableHeaderBackground : tableRowBackground }}>
              {row.map((cell, cellIndex) => (
                <View
                  key={`${rowIndex}-${cellIndex}`}
                  style={{
                    flexBasis: columnWidths[cellIndex] ?? cellMetrics.minWidth,
                    width: columnWidths[cellIndex] ?? cellMetrics.minWidth,
                    minHeight: 38,
                    paddingHorizontal: 10,
                    paddingVertical: 9,
                    borderRightWidth: cellIndex === row.length - 1 ? 0 : assistantSurfaces.nestedBorderWidth,
                    borderBottomWidth: rowIndex === normalizedRows.length - 1 ? 0 : assistantSurfaces.nestedBorderWidth,
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
      )}
    </RichCard>
  )
}

function DiagramBlockCard({ content, language, isUser }: { content: string; language?: string; isUser: boolean }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const userMessage = colors.ui.message
  const assistantSurfaces = resolveAssistantRichSurfaces(colors)
  const sourceLines = useMemo(() => splitSourceLines(content), [content])
  const diagramPreview = useMemo(() => buildDiagramPreview(content), [content])
  const hasDiagramPreview = diagramPreview.nodes.length > 0 || diagramPreview.edges.length > 0

  return (
    <RichCard isUser={isUser}>
      <CardHeader
        icon={<AppIcon name="workflow" color={isUser ? userMessage.userForeground : colors.ui.icon.accentForeground} size={14} strokeWidth={appIconStroke.strong} />}
        title={t('messageContent.sourceCode', { language: language || 'diagram' })}
        isUser={isUser}
        actions={isUser ? [] : [
          { label: t('common.copy'), kind: 'copy', onPress: () => Clipboard.setStringAsync(content) },
        ]}
      />
      {hasDiagramPreview ? (
        <DiagramPreviewPanel preview={diagramPreview} isUser={isUser} />
      ) : (
        <Text style={{ color: isUser ? userMessage.userForeground : colors.textSecondary, fontSize: 11, lineHeight: 16, marginBottom: 8, fontWeight: '800' }}>
          {t('messageContent.diagramFallback')}
        </Text>
      )}
      <SourceLineRows
        lines={sourceLines}
        isUser={isUser}
        surface={isUser ? userMessage.userActionBackground : assistantSurfaces.blockSurface}
        borderColor={assistantSurfaces.blockBorder}
        textColor={isUser ? userMessage.userForeground : colors.text}
        numberColor={isUser ? userMessage.userForeground : colors.textTertiary}
        gutterBackground={isUser ? userMessage.userActionBackground : assistantSurfaces.gutterSurface}
      />
    </RichCard>
  )
}

function DataBlockCard({ content, language, title, isUser }: { content: string; language?: string; title: string; isUser: boolean }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const userMessage = colors.ui.message
  const assistantSurfaces = resolveAssistantRichSurfaces(colors)
  const formattedContent = formatDataPreview(content, language)
  const dataLines = useMemo(() => splitSourceLines(formattedContent), [formattedContent])
  const csvRows = language === 'csv' || language === 'tsv' ? parseDelimitedTable(content, language === 'tsv' ? '\t' : ',') : null
  const summaryItems = useMemo(() => summarizeDataPreview(content, language, t), [content, language, t])

  if (csvRows?.length) return <TableBlockCard rows={csvRows} title={title} isUser={isUser} />

  return (
    <RichCard isUser={isUser}>
      <CardHeader
        icon={<AppIcon name="chart" color={isUser ? userMessage.userForeground : colors.ui.icon.accentForeground} size={14} strokeWidth={appIconStroke.strong} />}
        title={title}
        isUser={isUser}
        actions={isUser ? [] : [
          { label: t('common.copy'), kind: 'copy', onPress: () => Clipboard.setStringAsync(content) },
        ]}
      />
      {summaryItems.length ? <DataSummaryPanel items={summaryItems} isUser={isUser} /> : null}
      <SourceLineRows
        lines={dataLines}
        isUser={isUser}
        surface={isUser ? userMessage.userActionBackground : assistantSurfaces.blockSurface}
        borderColor={assistantSurfaces.blockBorder}
        textColor={isUser ? userMessage.userForeground : colors.text}
        numberColor={isUser ? userMessage.userForeground : colors.textTertiary}
        gutterBackground={isUser ? userMessage.userActionBackground : assistantSurfaces.gutterSurface}
      />
    </RichCard>
  )
}

function DataSummaryPanel({ items, isUser }: { items: DataSummaryItem[]; isUser: boolean }) {
  const { colors } = useAppTheme()
  const userMessage = colors.ui.message
  const assistantSurfaces = resolveAssistantRichSurfaces(colors)
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
      {items.map((item) => (
        <View
          key={`${item.label}:${item.value}`}
          style={{
            minHeight: 30,
            maxWidth: 180,
            justifyContent: 'center',
            borderRadius: colors.ui.radius.chip,
            paddingHorizontal: 9,
            paddingVertical: 5,
            backgroundColor: isUser ? userMessage.userActionBackground : assistantSurfaces.inlineMetaSurface,
            borderWidth: isUser ? 0 : assistantSurfaces.chipBorderWidth,
            borderColor: assistantSurfaces.inlineMetaBorder,
          }}
        >
          <Text numberOfLines={1} style={{ color: isUser ? userMessage.userForeground : colors.textSecondary, fontSize: 11, lineHeight: 15, fontWeight: '900' }}>
            {item.label}: {item.value}
          </Text>
        </View>
      ))}
    </View>
  )
}

function StackedTableRows({
  headers,
  rows,
  isUser,
}: {
  headers: string[]
  rows: string[][]
  isUser: boolean
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const userMessage = colors.ui.message
  const assistantSurfaces = resolveAssistantRichSurfaces(colors)
  const labelColor = isUser ? userMessage.userForeground : colors.textTertiary
  const valueColor = isUser ? userMessage.userForeground : colors.text
  const fallbackRows = rows.length ? rows : [headers]

  return (
    <View style={{ gap: 8 }}>
      {fallbackRows.map((row, rowIndex) => (
        <View
          key={`${rowIndex}-${row.join('|')}`}
          style={{
            borderRadius: colors.ui.radius.card,
            padding: 9,
            backgroundColor: isUser ? userMessage.userActionBackground : assistantSurfaces.nestedPanelSurface,
            borderWidth: isUser ? 0 : assistantSurfaces.nestedBorderWidth,
            borderColor: assistantSurfaces.blockBorder,
            gap: 6,
          }}
        >
          <Text style={{ color: labelColor, fontSize: 11, lineHeight: 15, fontWeight: '900' }}>
            {t('messageContent.recordLabel', { index: rowIndex + 1 })}
          </Text>
          <View style={{ gap: 6 }}>
            {row.map((cell, cellIndex) => (
              <View
                key={`${rowIndex}-${cellIndex}`}
                style={{
                  borderRadius: colors.ui.radius.controlSmall,
                  paddingHorizontal: 10,
                  paddingVertical: 7,
                  backgroundColor: isUser ? userMessage.userActionBackground : colors.ui.cartoon ? assistantSurfaces.blockSurface : 'transparent',
                  borderTopWidth: cellIndex === 0 || isUser ? 0 : assistantSurfaces.nestedBorderWidth,
                  borderTopColor: assistantSurfaces.blockBorder,
                }}
              >
                <Text style={{ color: labelColor, fontSize: 11, lineHeight: 15, fontWeight: '800', marginBottom: 2 }}>
                  {(headers[cellIndex] || `C${cellIndex + 1}`).trim() || `C${cellIndex + 1}`}
                </Text>
                <Text selectable style={{ color: valueColor, fontSize: 12, lineHeight: 18, fontWeight: '700' }}>
                  {cell || ' '}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  )
}

function DiagramPreviewPanel({ preview, isUser }: { preview: DiagramPreview; isUser: boolean }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const userMessage = colors.ui.message
  const assistantSurfaces = resolveAssistantRichSurfaces(colors)
  const foreground = isUser ? userMessage.userForeground : colors.textSecondary
  const nodeForeground = isUser ? userMessage.userForeground : colors.text
  const nodeSurface = isUser ? userMessage.userActionBackground : assistantSurfaces.nodeSurface
  const connectorColor = isUser ? userMessage.userForeground : colors.ui.icon.accentForeground
  const nodeBorderWidth = colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth

  return (
    <View
      style={{
        gap: 8,
        marginBottom: 10,
        padding: 10,
        borderRadius: colors.ui.radius.card,
        backgroundColor: isUser ? userMessage.userActionBackground : assistantSurfaces.nestedPanelSurface,
        borderWidth: isUser ? 0 : assistantSurfaces.nestedBorderWidth,
        borderColor: assistantSurfaces.blockBorder,
      }}
    >
      {preview.edges.length ? (
        <View style={{ gap: 7 }}>
          {preview.edges.map((edge, index) => (
            <View key={`${index}-${edge.from}-${edge.to}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 30 }}>
              <DiagramNodePill label={edge.from} foreground={nodeForeground} surface={nodeSurface} border={assistantSurfaces.blockBorder} borderWidth={nodeBorderWidth} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                <View style={{ width: 18, height: 1, backgroundColor: connectorColor, opacity: 0.75 }} />
                <Text style={{ color: connectorColor, fontSize: 13, fontWeight: '900' }}>›</Text>
              </View>
              <DiagramNodePill label={edge.to} foreground={nodeForeground} surface={nodeSurface} border={assistantSurfaces.blockBorder} borderWidth={nodeBorderWidth} />
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
            <DiagramNodePill key={node} label={node} foreground={nodeForeground} surface={nodeSurface} border={assistantSurfaces.blockBorder} borderWidth={nodeBorderWidth} />
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

function DiagramNodePill({ label, foreground, surface, border, borderWidth }: { label: string; foreground: string; surface: string; border: string; borderWidth: number }) {
  return (
    <View
      style={{
        maxWidth: 160,
        minHeight: 30,
        justifyContent: 'center',
        paddingHorizontal: 10,
        borderRadius: 999,
        backgroundColor: surface,
        borderWidth,
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

function RichCard({ isUser, children }: { isUser: boolean; children: ReactNode }) {
  const { colors } = useAppTheme()
  const userMessage = colors.ui.message
  const assistantSurfaces = resolveAssistantRichSurfaces(colors)
  return (
    <IslePanel
      elevated={!isUser && colors.ui.cartoon}
      material={isUser ? 'transparent' : colors.ui.cartoon ? 'raised' : 'paper'}
      contentStyle={{ padding: 8, width: '100%' }}
      style={{
        alignSelf: 'stretch',
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        borderRadius: colors.ui.radius.card,
        backgroundColor: isUser ? userMessage.userActionBackground : assistantSurfaces.richCardSurface,
        borderColor: isUser ? userMessage.userActionBackground : assistantSurfaces.blockBorder,
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
  const assistantSurfaces = resolveAssistantRichSurfaces(colors)
  const actionSurface = isUser ? userMessage.userActionBackground : assistantSurfaces.headerActionSurface

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
      <View style={{ width: 22, height: 22, borderRadius: colors.ui.radius.controlSmall, alignItems: 'center', justifyContent: 'center', backgroundColor: actionSurface }}>
        {icon}
      </View>
      <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: isUser ? userMessage.userForeground : colors.text, fontSize: 12, fontWeight: '900' }}>
        {title}
      </Text>
      {actions.map((action) => {
        const key = actionKey(action)
        const feedback = actionFeedback?.key === key ? actionFeedback : null
        const displayLabel = feedback?.label ?? action.label
        const accessibilityHint = action.accessibilityHint ?? t('messageContent.copyBlockHint')
        const foreground = feedback?.failed ? colors.ui.tone.danger.foreground : isUser ? userMessage.userForeground : colors.textTertiary
        return (
          <IslePressable
            key={key}
            haptic
            accessibilityRole="button"
            onPress={runAction(action)}
            accessibilityLabel={displayLabel}
            accessibilityHint={accessibilityHint}
            hitSlop={RICH_BLOCK_ACTION_HIT_SLOP}
            style={{
              minHeight: 36,
              borderRadius: colors.ui.radius.chip,
              paddingHorizontal: 9,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              backgroundColor: feedback?.failed ? colors.ui.tone.danger.background : actionSurface,
              borderWidth: feedback?.failed ? 1 : 0,
              borderColor: feedback?.failed ? colors.ui.tone.danger.border : 'transparent',
            }}
          >
            <AppIcon name="copy" color={foreground} size={11} strokeWidth={appIconStroke.strong} />
              <Text numberOfLines={1} accessibilityLiveRegion={feedback ? 'polite' : undefined} style={{ color: foreground, fontSize: 10.5, fontWeight: '900', maxWidth: 84 }}>
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
    if (looksLikeJson(trimmed) && shouldPromotePlainJson(trimmed)) {
      segments.push({ id: `data-${index}`, type: 'data', content: trimmed, language: 'json', title: t('messageContent.jsonData') })
    } else if (looksLikeTsv(trimmed) && shouldPromotePlainDelimitedTable(trimmed, '\t')) {
      segments.push({ id: `table-${index}`, type: 'table', rows: parseDelimitedTable(trimmed, '\t') ?? [[trimmed]], title: t('messageContent.tsvData') })
    } else if (looksLikeCsv(trimmed) && shouldPromotePlainDelimitedTable(trimmed, ',')) {
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
    } else if (looksLikeStandaloneFormulaLine(lines[lineIndex], lines)) {
      flushBuffer()
      const formulaLines = [lines[lineIndex]]
      lineIndex += 1
      while (lineIndex < lines.length && looksLikeStandaloneFormulaLine(lines[lineIndex], lines)) {
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
  if (hasNaturalLanguageScript(value) && !hasExplicitLatexFormulaCommand(value)) return false
  if (/^[A-Za-z]$/.test(value)) return true
  if (looksLikeFormulaIdentifierWithAffixes(value)) return true
  return hasInlineFormulaSyntax(value)
}

function looksLikeStandaloneFormulaLine(line: string | undefined, allLines?: string[]): boolean {
  const trimmed = line?.trim() ?? ''
  if (!trimmed || trimmed.length > 220) return false
  if (allLines && countNonEmptyLines(allLines) > 1 && !/^\s*(?:\$\$|\\\[)/.test(trimmed)) return false
  if (looksLikeMarkdownOrNaturalLanguageListMarker(trimmed)) return false
  if (looksLikeToolCallMarkupLine(trimmed)) return false
  if (/^(const|let|var|function|return|if|for|while|class|import|export|type|interface)\b/.test(trimmed)) return false
  if (/;$/.test(trimmed)) return false
  if (hasNaturalLanguageScript(trimmed)) return false
  if (!looksLikeInlineFormula(trimmed)) return false
  if (!hasStandaloneFormulaSyntax(trimmed)) return false
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length
  return wordCount <= 18 || /[\\^_{}]/.test(trimmed)
}

function hasNaturalLanguageScript(value: string): boolean {
  return CJK_TEXT_PATTERN.test(value)
}

function hasExplicitLatexFormulaCommand(value: string): boolean {
  return LATEX_FORMULA_COMMAND_PATTERN.test(value)
}

function hasInlineFormulaSyntax(value: string): boolean {
  if (hasExplicitLatexFormulaCommand(value)) return true
  if (looksLikeFormulaIdentifierWithAffixes(value)) return true
  return /(?:<=|>=|=|->|=>|\\to|\^|[+\-*/<>])/.test(value) && /[A-Za-z0-9\\]/.test(value)
}

function hasStandaloneFormulaSyntax(value: string): boolean {
  if (hasExplicitLatexFormulaCommand(value)) return true
  if (looksLikeFormulaIdentifierWithAffixes(value)) return true
  return /(?:<=|>=|=|->|=>|\\to|\^)/.test(value) && /[A-Za-z0-9\\]/.test(value)
}

function looksLikeToolCallMarkupLine(value: string): boolean {
  return /^<\/?\s*(?:tool_call|function|parameter)(?:\s*=\s*[^>]*)?>$/i.test(value) ||
    /^<\s*parameter\s*=\s*[^>]+>[\s\S]*<\/\s*parameter\s*>$/i.test(value)
}

function looksLikeFormulaIdentifierWithAffixes(value: string): boolean {
  if (!/[_^]/.test(value) || /\s/.test(value)) return false
  const match = value.match(/^([A-Za-z][A-Za-z0-9]*)(?:[_^](?:\{[A-Za-z0-9+\-]{1,12}\}|[A-Za-z0-9]{1,8})){1,3}$/)
  if (!match) return false
  if (value.includes('_') && !FORMULA_IDENTIFIER_BASE_PATTERN.test(match[1] ?? '')) return false
  return true
}

function looksLikeMarkdownOrNaturalLanguageListMarker(trimmed: string): boolean {
  return /^(#{1,6}\s|[-*+]\s|(?:\d+|[一二三四五六七八九十百千]+)\s*[.)）、．](?!\d)\s*|第[一二三四五六七八九十百千\d]+[点項项]\s*|>|\||```|~~~)/.test(trimmed)
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

function looksLikeTsv(text: string): boolean {
  const rows = parseDelimitedTable(text, '\t')
  if (!rows || rows.length < 2) return false
  return rows[0].length > 1 && rows.every((row) => Math.abs(row.length - rows[0].length) <= 1)
}

function shouldPromotePlainJson(text: string): boolean {
  const trimmed = text.trim()
  const lineCount = countNonEmptyLines(trimmed.split(/\r?\n/))
  if (lineCount < 3) return false
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) return parsed.length > 1 || parsed.some((item) => item && typeof item === 'object')
    if (!parsed || typeof parsed !== 'object') return false
    return Object.keys(parsed as Record<string, unknown>).length >= 2
  } catch {
    return false
  }
}

function shouldPromotePlainDelimitedTable(text: string, delimiter: ',' | '\t'): boolean {
  const rows = parseDelimitedTable(text, delimiter)
  if (!rows || rows.length < 3) return false
  const columnCount = rows[0].length
  if (columnCount < 2 || columnCount > 8) return false
  const consistentRows = rows.filter((row) => Math.abs(row.length - columnCount) <= 1).length
  if (consistentRows < 3) return false
  return rows.some((row) => row.some((cell) => cell.length > 0 && cell.length <= 80))
}

function countNonEmptyLines(lines: string[]): number {
  return lines.reduce((total, line) => total + (line.trim() ? 1 : 0), 0)
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

function summarizeDataPreview(content: string, language: string | undefined, t: TFunction): DataSummaryItem[] {
  const trimmed = content.trim()
  if (!(language === 'json' || language === 'jsonc' || language === 'chart' || language === 'vega' || language === 'vega-lite' || language === 'echarts' || looksLikeJson(trimmed))) {
    return []
  }

  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      const firstObject = parsed.find((item) => item && typeof item === 'object' && !Array.isArray(item)) as Record<string, unknown> | undefined
      return [
        { label: t('messageContent.dataSummaryType'), value: t('messageContent.dataSummaryArray') },
        { label: t('messageContent.dataSummaryItems'), value: String(parsed.length) },
        ...(firstObject ? [{ label: t('messageContent.dataSummaryKeys'), value: String(Object.keys(firstObject).length) }] : []),
      ]
    }

    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      const keys = Object.keys(record)
      const chartKind = detectChartKind(record, language)
      return [
        { label: t('messageContent.dataSummaryType'), value: chartKind ?? t('messageContent.dataSummaryObject') },
        { label: t('messageContent.dataSummaryKeys'), value: String(keys.length) },
        ...summarizeNestedDataShape(record, t),
      ].slice(0, 4)
    }
  } catch {
    return []
  }

  return []
}

function summarizeNestedDataShape(record: Record<string, unknown>, t: TFunction): DataSummaryItem[] {
  const items: DataSummaryItem[] = []
  const data = record.data
  const series = record.series
  const encoding = record.encoding
  if (Array.isArray(data)) items.push({ label: t('messageContent.dataSummaryItems'), value: String(data.length) })
  if (Array.isArray(series)) items.push({ label: t('messageContent.dataSummarySeries'), value: String(series.length) })
  if (encoding && typeof encoding === 'object' && !Array.isArray(encoding)) items.push({ label: t('messageContent.dataSummaryEncoding'), value: String(Object.keys(encoding as Record<string, unknown>).length) })
  return items
}

function detectChartKind(record: Record<string, unknown>, language?: string): string | null {
  if (language === 'vega-lite' || 'mark' in record || 'encoding' in record) return 'Vega-Lite'
  if (language === 'vega' || '$schema' in record && String(record.$schema).toLowerCase().includes('vega')) return 'Vega'
  if (language === 'echarts' || 'series' in record && ('xAxis' in record || 'yAxis' in record || 'legend' in record)) return 'ECharts'
  if (language === 'chart') return 'Chart'
  return null
}

function visualTextLength(value: string): number {
  return Array.from(value).reduce((total, char) => total + (char.charCodeAt(0) > 255 ? 1.7 : 1), 0)
}
