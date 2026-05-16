import { useEffect, useMemo, useState } from 'react'
import { Linking, ScrollView, Text, View } from 'react-native'
import type { WebViewProps } from 'react-native-webview'
import * as Clipboard from 'expo-clipboard'
import { router, useLocalSearchParams } from 'expo-router'
import { BookOpen, ChevronLeft, Copy, ExternalLink, Globe2, ListChecks, RefreshCw } from 'lucide-react-native'
import { MotiView } from 'moti'
import { Screen } from '@/components/ui/Screen'
import { IslandPanel } from '@/components/ui/IslandPanel'
import { IslandButton } from '@/components/ui/IslandButton'
import { IslandChip } from '@/components/ui/IslandChip'
import { IslandHeader, IslandIconButton, IslandSection } from '@/components/ui/IslandPrimitives'
import { RenderGuard } from '@/components/ui/RenderGuard'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useChatStore } from '@/store/chatStore'
import { useIslandDialog } from '@/components/ui/IslandDialog'
import type { MessageCitation, ProcessTrace } from '@/types'
import { collectMessageTraces, formatDuration, metadataSummary, normalizeTraceStatuses, traceStatusLabel } from '@/components/chat/tracePresentation'

export default function SourceScreen() {
  const { colors } = useAppTheme()
  const dialog = useIslandDialog()
  const params = useLocalSearchParams<{ conversationId?: string; messageId?: string; citationId?: string; kind?: string; url?: string }>()
  const conversations = useChatStore((state) => state.conversations)
  const conversation = conversations.find((item) => item.id === params.conversationId)
  const message = conversation?.messages.find((item) => item.id === params.messageId)
  const citations = message?.citations ?? []
  const traces = useMemo(() => normalizeTraceStatuses(message ? collectMessageTraces(message) : [], message?.status ?? 'done'), [message])
  const citation = citations.find((item) => item.id === params.citationId) ?? citations[0]
  const explicitUrl = firstParam(params.url)
  const [webKey, setWebKey] = useState(0)

  const mode = params.kind === 'process' ? 'process' : 'source'
  const webUrl = mode === 'source' ? explicitUrl ?? citation?.url : undefined
  const title = mode === 'process' ? '生成过程' : citation?.title ?? '来源'
  const subtitle = mode === 'process'
    ? `${traces.filter((trace) => trace.status === 'done').length} 完成 · ${traces.filter((trace) => trace.status === 'error').length} 异常 · ${traces.filter((trace) => trace.status === 'skipped').length} 跳过`
    : getSourceSubtitle(citation, webUrl)

  async function copyCurrent() {
    try {
      const content = mode === 'process'
        ? traces.map((trace) => `${trace.title}: ${trace.content ?? traceStatusLabel(trace.status)}`).join('\n\n')
        : [citation?.title, citation?.url, citation?.excerpt].filter(Boolean).join('\n\n')
      await Clipboard.setStringAsync(content || webUrl || '')
      dialog.toast({ title: '已复制', message: mode === 'process' ? '过程摘要已复制。' : '来源信息已复制。', tone: 'mint' })
    } catch {
      dialog.toast({ title: '复制失败', message: '系统剪贴板暂时不可用。', tone: 'danger' })
    }
  }

  async function openExternal() {
    if (!webUrl) return
    const supported = await Linking.canOpenURL(webUrl)
    if (supported) {
      await Linking.openURL(webUrl)
    } else {
      dialog.toast({ title: '无法打开', message: '系统浏览器无法打开这个链接。', tone: 'danger' })
    }
  }

  return (
    <Screen padded={false}>
      <View style={{ flex: 1 }}>
        <View pointerEvents="box-none" style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: 8 }}>
          <IslandHeader
            title={title}
            subtitle={subtitle}
            leading={
              <IslandIconButton label="返回聊天" onPress={() => router.back()}>
                <ChevronLeft color={colors.text} size={22} strokeWidth={1.9} />
              </IslandIconButton>
            }
            trailing={
              <View style={{ flexDirection: 'row', gap: 7 }}>
                <IslandIconButton label="复制" size="sm" onPress={() => void copyCurrent()}>
                  <Copy color={colors.textSecondary} size={17} strokeWidth={1.9} />
                </IslandIconButton>
                {webUrl ? (
                  <>
                    <IslandIconButton label="刷新" size="sm" onPress={() => setWebKey((value) => value + 1)}>
                      <RefreshCw color={colors.textSecondary} size={17} strokeWidth={1.9} />
                    </IslandIconButton>
                    <IslandIconButton label="外部打开" size="sm" onPress={() => void openExternal()}>
                      <ExternalLink color={colors.textSecondary} size={17} strokeWidth={1.9} />
                    </IslandIconButton>
                  </>
                ) : null}
              </View>
            }
          />
        </View>

        <RenderGuard label={mode === 'process' ? '生成过程' : '来源'}>
          {mode === 'process' ? (
            <ProcessReader traces={traces} />
          ) : webUrl ? (
            <WebReader key={webKey} url={webUrl} citation={citation} onOpenExternal={openExternal} />
          ) : (
            <LocalSourceReader citation={citation} citations={citations} />
          )}
        </RenderGuard>
      </View>
    </Screen>
  )
}

function WebReader({ url, citation, onOpenExternal }: { url: string; citation?: MessageCitation; onOpenExternal: () => Promise<void> }) {
  const { colors } = useAppTheme()
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [WebViewComponent, setWebViewComponent] = useState<React.ComponentType<WebViewProps> | null>(null)

  useEffect(() => {
    let mounted = true
    try {
      const webviewModule = require('react-native-webview') as typeof import('react-native-webview')
      if (mounted) {
        setWebViewComponent(() => webviewModule.WebView)
      }
    } catch {
      if (mounted) {
        setLoading(false)
        setFailed(true)
      }
    }
    return () => {
      mounted = false
    }
  }, [])

  return (
    <View style={{ flex: 1 }}>
      <IslandPanel material="raised" elevated={false} style={{ marginHorizontal: 12, marginTop: 10, marginBottom: 8 }} radius={24}>
      <View style={{ paddingHorizontal: 14, paddingVertical: 11 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          <View style={{ width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mintSoft }}>
            <Globe2 color={colors.primary} size={15} strokeWidth={2.1} />
          </View>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ color: colors.text, fontSize: 14, fontWeight: '900' }}>{citation?.title ?? hostFromUrl(url)}</Text>
            <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, marginTop: 1 }}>{hostFromUrl(url)}</Text>
          </View>
        </View>
        {citation?.excerpt ? (
          <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 6 }}>{citation.excerpt}</Text>
        ) : null}
      </View>
      </IslandPanel>
      {failed ? (
        <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
          <Text style={{ color: colors.text, fontSize: 19, fontWeight: '900' }}>预览不可用</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 8 }}>
            这个网页拒绝了内置预览，或者当前网络无法加载。你仍然可以用系统浏览器打开它。
          </Text>
          <IslandButton label="在浏览器打开" tone="primary" onPress={() => void onOpenExternal()} style={{ marginTop: 16 }} />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {loading || !WebViewComponent ? <ReaderSkeleton label="载入网页预览" /> : null}
          {WebViewComponent ? (
            <WebViewComponent
              source={{ uri: url }}
              startInLoadingState={false}
              onLoadEnd={() => setLoading(false)}
              onError={() => {
                setLoading(false)
                setFailed(true)
              }}
              onHttpError={() => {
                setLoading(false)
                setFailed(true)
              }}
              setSupportMultipleWindows={false}
              style={{ flex: 1, backgroundColor: colors.surface }}
            />
          ) : null}
        </View>
      )}
    </View>
  )
}

function LocalSourceReader({ citation, citations }: { citation?: MessageCitation; citations: MessageCitation[] }) {
  const { colors } = useAppTheme()
  const sources = citation ? [citation, ...citations.filter((item) => item.id !== citation.id)] : citations
  if (!sources.length) {
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
        <Text style={{ color: colors.text, fontSize: 19, fontWeight: '900' }}>没有来源</Text>
        <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 8 }}>这条消息没有记录可打开的来源。</Text>
      </View>
    )
  }
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 12, paddingBottom: 42 }}>
      {sources.map((source, index) => (
        <MotiView
          key={`${source.id}-${index}`}
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', damping: 20, stiffness: 180, delay: index * 35 }}
          style={{ marginBottom: 10 }}
        >
          <IslandSection
            elevated
            title={source.title || source.type}
            subtitle={formatCitationMeta(source)}
            action={<View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mintSoft }}><BookOpen color={colors.primary} size={15} strokeWidth={2.1} /></View>}
          >
            {source.excerpt ? <Text selectable style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 20 }}>{source.excerpt}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <SourceMetaChip label={source.type === 'memory' ? '长期记忆' : source.type === 'knowledge' ? '本机知识' : '网页'} />
              {source.score !== undefined ? <SourceMetaChip label={`分数 ${source.score.toFixed(2)}`} /> : null}
              {source.documentId ? <SourceMetaChip label={`doc ${source.documentId.slice(0, 8)}`} /> : null}
              {source.chunkId ? <SourceMetaChip label={`chunk ${source.chunkId.slice(0, 8)}`} /> : null}
            </View>
          </IslandSection>
        </MotiView>
      ))}
    </ScrollView>
  )
}

function ProcessReader({ traces }: { traces: ProcessTrace[] }) {
  const { colors } = useAppTheme()
  const groups = [
    { key: 'context', title: '上下文', traces: traces.filter((trace) => trace.type === 'retrieval' || trace.type === 'memory' || trace.type === 'knowledge') },
    { key: 'search', title: '搜索', traces: traces.filter((trace) => trace.type === 'search') },
    { key: 'model', title: '模型与工具', traces: traces.filter((trace) => trace.type === 'reasoning' || trace.type === 'tool' || trace.type === 'system') },
  ].filter((group) => group.traces.length)

  if (!traces.length) {
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
        <Text style={{ color: colors.text, fontSize: 19, fontWeight: '900' }}>没有过程记录</Text>
        <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 8 }}>这条消息没有记录检索、搜索或工具过程。</Text>
      </View>
    )
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 18, paddingBottom: 42 }}>
      {groups.map((group) => (
        <View key={group.key} style={{ marginBottom: 20 }}>
          <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '900', letterSpacing: 0.7, marginBottom: 6 }}>{group.title}</Text>
          {group.traces.map((trace, index) => (
          <TraceRow key={trace.id} trace={trace} isLast={index === group.traces.length - 1} />
          ))}
        </View>
      ))}
    </ScrollView>
  )
}

function TraceRow({ trace, isLast }: { trace: ProcessTrace; isLast: boolean }) {
  const { colors } = useAppTheme()
  const tone = trace.status === 'done' ? colors.success : trace.status === 'error' ? colors.error : trace.status === 'skipped' ? colors.textTertiary : colors.primary
  const meta = [
    traceStatusLabel(trace.status),
    trace.durationMs ? formatDuration(trace.durationMs) : '',
    metadataSummary(trace.metadata),
  ].filter(Boolean).join(' · ')
  return (
    <View style={{ flexDirection: 'row', gap: 11 }}>
      <View style={{ alignItems: 'center' }}>
        <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: tone, marginTop: 8 }} />
        {!isLast ? <View style={{ flex: 1, width: 1, backgroundColor: colors.border, marginTop: 4 }} /> : null}
      </View>
      <View style={{ flex: 1, paddingBottom: isLast ? 2 : 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <ListChecks color={tone} size={15} strokeWidth={2} />
          <Text style={{ color: colors.text, fontSize: 14, fontWeight: '900', flex: 1 }}>{trace.title}</Text>
        </View>
        <Text style={{ color: tone, fontSize: 11, fontWeight: '900', marginTop: 3 }}>{meta}</Text>
        {trace.content ? (
          <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 7 }}>{trace.content}</Text>
        ) : null}
      </View>
    </View>
  )
}

function ReaderSkeleton({ label }: { label: string }) {
  const { colors } = useAppTheme()
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 5, padding: 18, backgroundColor: colors.surface }}>
      <MotiView
        from={{ opacity: 0.38 }}
        animate={{ opacity: 0.9 }}
        transition={{ loop: true, type: 'timing', duration: 860 }}
        style={{ gap: 12 }}
      >
        <View style={{ width: '42%', height: 14, borderRadius: 7, backgroundColor: colors.islandRaised }} />
        <View style={{ width: '92%', height: 10, borderRadius: 5, backgroundColor: colors.islandRaised }} />
        <View style={{ width: '84%', height: 10, borderRadius: 5, backgroundColor: colors.islandRaised }} />
        <View style={{ width: '96%', height: 220, borderRadius: 22, backgroundColor: colors.islandRaised, marginTop: 8 }} />
      </MotiView>
      <View style={{ position: 'absolute', top: 12, alignSelf: 'center', minHeight: 30, borderRadius: 15, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: colors.islandRaised, borderWidth: 1, borderColor: colors.border }}>
        <MotiView
          from={{ opacity: 0.4, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ loop: true, type: 'timing', duration: 760 }}
          style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary }}
        />
        <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900' }}>{label}</Text>
      </View>
    </View>
  )
}

function SourceMetaChip({ label }: { label: string }) {
  const { colors } = useAppTheme()
  return (
    <IslandChip>{label}</IslandChip>
  )
}

function getSourceSubtitle(citation?: MessageCitation, url?: string): string {
  if (url) return hostFromUrl(url)
  if (!citation) return '未找到来源'
  const type = citation.type === 'memory' ? '长期记忆' : citation.type === 'knowledge' ? '本机知识库' : '网页来源'
  return `${type}${citation.score !== undefined ? ` · 分数 ${citation.score.toFixed(2)}` : ''}`
}

function formatCitationMeta(citation: MessageCitation): string {
  const type = citation.type === 'memory' ? '长期记忆' : citation.type === 'knowledge' ? '本机知识库' : '网页'
  const parts = [
    type,
    citation.retrievalMode ? citation.retrievalMode.toUpperCase() : '',
    citation.score !== undefined ? `score ${citation.score.toFixed(2)}` : '',
    citation.ftsScore !== undefined ? `FTS ${citation.ftsScore.toFixed(2)}` : '',
    citation.vectorScore !== undefined ? `Vector ${citation.vectorScore.toFixed(2)}` : '',
    citation.documentId ? `doc ${citation.documentId.slice(0, 8)}` : '',
    citation.chunkId ? `chunk ${citation.chunkId.slice(0, 8)}` : '',
  ].filter(Boolean)
  return parts.join(' · ')
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}
