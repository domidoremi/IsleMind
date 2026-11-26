import { APP_FONT_FAMILY } from '@/theme/font'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Keyboard, Linking, Platform, StyleSheet, View, useWindowDimensions, type GestureResponderEvent } from 'react-native'
import { ScrollView } from '@/components/ui/AppScrollView'
import { Modal } from '@/components/ui/AppModal'
import { Text } from '@/components/ui/AppText'
import Markdown, { type RenderFunction } from 'react-native-markdown-display'
import { SvgXml } from 'react-native-svg'
import { useTranslation } from 'react-i18next'
import { IsleButton, IslePressable, IsleScreen, IsleSearchField } from '@/components/ui/isle'
import { AppIcon } from '@/components/ui/AppIcon'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { userGuide } from '@/generated/userGuide'
import { guideSearchText, normalizeGuideSearch } from './guideSearchText'
import { safeHttpUrl } from '@/utils/sourceUrlSafety'
import { restoreAccessibilityFocus } from '@/platform/native/restoreAccessibilityFocus'
import { WorkspaceHeader } from '@/presentation/layout/WorkspaceHeader'
import { useKeyboardViewportInset } from '@/presentation/layout/useKeyboardScrollViewport'

const guideHeading: RenderFunction = (node, children, _parents, styles) => (
  <View key={node.key} accessible accessibilityRole="header" {...(Platform.OS === 'web' ? { 'aria-level': Number(node.type.slice(-1)) } : {})} style={styles[`_VIEW_SAFE_${node.type}`]}>{children}</View>
)
const guideHeadings = { heading1: guideHeading, heading2: guideHeading, heading3: guideHeading, heading4: guideHeading, heading5: guideHeading, heading6: guideHeading }

export function GuideReader({ initialSlug, initialAnchor, onClose }: { initialSlug?: string; initialAnchor?: string; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const { colors } = useAppTheme()
  const typography = colors.design?.semantic.typography
  const spacing = colors.design!.semantic.spacing
  const motion = useMotionPreference(true)
  const { width, height, fontScale } = useWindowDimensions()
  const illustrationWidth = Math.max(120, Math.min(720, width - 32) - 40)
  const language = i18n.language.startsWith('zh') ? 'zh-CN' : i18n.language.startsWith('ja') ? 'ja' : 'en'
  const chapters: readonly { id: string; title: string; body: string; anchors: readonly string[] }[] = userGuide.chapters[language]
  const [slug, setSlug] = useState(initialSlug)
  const [query, setQuery] = useState('')
  const [viewportHeight, setViewportHeight] = useState(height)
  const keyboardViewport = useKeyboardViewportInset()
  const shortIndex = !slug && (keyboardViewport.visibleHeight ?? viewportHeight) / fontScale < 320
  const [contentsExpanded, setContentsExpanded] = useState(false)
  const scroll = useRef<ScrollView>(null)
  const contentRoot = useRef<View>(null)
  const indexOffset = useRef(0)
  const restoreIndex = useRef(false)
  const contentKey = language + ':' + (slug ?? 'index')
  const pendingAnchor = useRef<{ contentKey: string; anchor: string; animated: boolean } | undefined>(undefined)
  const anchorViews = useRef(new Map<string, View>())
  const readyContent = useRef<string | undefined>(undefined)
  const chapter = chapters.find(item => item.id === slug)
  const searchTerm = normalizeGuideSearch(query)
  const results = searchTerm && !slug ? chapters.filter(item => guideSearchText(item).includes(searchTerm)) : chapters
  const blocks = useMemo(() => chapter?.body.split(/<a id="([a-z0-9-]+)"><\/a>/) ?? [], [chapter])
  useEffect(() => {
    readyContent.current = contentKey
    if (pendingAnchor.current?.contentKey !== contentKey) pendingAnchor.current = undefined
    restoreIndex.current = !slug
    scroll.current?.scrollTo({ y: slug ? 0 : indexOffset.current, animated: false })
    measurePendingAnchor()
  }, [slug, language])
  useEffect(() => {
    if (initialAnchor && slug) requestAnchor(slug, initialAnchor, false)
  }, [initialAnchor, slug, language])
  useEffect(() => () => {
    pendingAnchor.current = undefined
    readyContent.current = undefined
    anchorViews.current.clear()
  }, [])
  function cancelAnchor() {
    pendingAnchor.current = undefined
    restoreIndex.current = false
  }
  function measurePendingAnchor() {
    const request = pendingAnchor.current
    const viewport = scroll.current
    const nodeKey = request ? request.contentKey + ':' + request.anchor : ''
    const node = anchorViews.current.get(nodeKey)
    const content = contentRoot.current
    if (!viewport || !request || request.contentKey !== contentKey || readyContent.current !== contentKey || !node || !content) return
    // Measure through all surface wrappers against the actual scroll content.
    node.measureLayout(content, (_x, y) => {
      if (pendingAnchor.current !== request || scroll.current !== viewport || contentRoot.current !== content
        || readyContent.current !== request.contentKey || anchorViews.current.get(nodeKey) !== node || !Number.isFinite(y)) return
      pendingAnchor.current = undefined
      viewport.scrollTo({ y: Math.max(0, y), animated: request.animated })
    })
  }
  function requestAnchor(nextSlug: string, anchor: string, animated: boolean) {
    pendingAnchor.current = { contentKey: language + ':' + nextSlug, anchor, animated }
    measurePendingAnchor()
  }
  function open(nextSlug: string, anchor?: string) {
    cancelAnchor()
    if (anchor) requestAnchor(nextSlug, anchor, nextSlug === slug && motion === 'full')
    if (nextSlug === slug) {
      if (!anchor) scroll.current?.scrollTo({ y: 0, animated: motion === 'full' })
    } else { setContentsExpanded(false); setSlug(nextSlug) }
  }
  function link(href: string) {
    const safe = safeHttpUrl(href)
    if (safe) { void Linking.openURL(safe).catch(() => undefined); return false }
    const [file, anchor] = href.split('#')
    if ((!file || /^[a-z0-9-]+\.md$/.test(file)) && (file || slug)) open(file ? file.replace(/\.md$/, '') : slug!, anchor)
    return false
  }
  const codeStyle = {
    ...typography?.code, color: colors.text, backgroundColor: colors.ui.semantic.surface.muted,
    borderColor: colors.ui.section.divider, borderWidth: StyleSheet.hairlineWidth,
    borderRadius: colors.ui.radius.controlSmall, padding: spacing.md,
  }
  const markdownStyle = {
    body: { fontFamily: APP_FONT_FAMILY, fontSize: 16, lineHeight: 26, ...typography?.body, color: colors.text },
    heading1: { fontSize: 28, lineHeight: 36, ...typography?.headline, marginBottom: 16, color: colors.text },
    heading2: { fontSize: 21, lineHeight: 30, ...typography?.title, marginTop: 20, marginBottom: 8, color: colors.text },
    heading3: { fontSize: 18, lineHeight: 28, ...typography?.body, fontWeight: typography?.title.fontWeight ?? '600' as const, color: colors.text },
    heading4: { fontSize: 16, lineHeight: 26, ...typography?.body, color: colors.text },
    heading5: { fontSize: 16, lineHeight: 26, ...typography?.body, color: colors.text },
    heading6: { fontSize: 16, lineHeight: 26, ...typography?.body, color: colors.text },
    link: { color: colors.primary, textDecorationLine: 'underline' as const },
    paragraph: { marginBottom: 12 },
    code_inline: {
      ...typography?.code, color: colors.text, backgroundColor: colors.ui.semantic.surface.muted,
      borderColor: colors.ui.section.divider, borderWidth: StyleSheet.hairlineWidth,
      borderRadius: colors.ui.radius.controlSmall, paddingHorizontal: spacing.xs, paddingVertical: spacing.xxs,
    },
    code_block: codeStyle,
    fence: codeStyle,
    table: { borderColor: colors.ui.section.divider, borderWidth: StyleSheet.hairlineWidth, borderRadius: colors.ui.radius.controlSmall },
    th: { flex: 1, padding: spacing.md, backgroundColor: colors.ui.semantic.surface.muted },
    td: { flex: 1, padding: spacing.md },
    tr: { borderColor: colors.ui.section.divider, borderBottomWidth: StyleSheet.hairlineWidth },
    blockquote: { backgroundColor: colors.ui.semantic.surface.muted, borderColor: colors.ui.icon.accentForeground },
    hr: { backgroundColor: colors.ui.section.divider },
  }
  return <IsleScreen padded={false}>
    <View testID="guide-frame" ref={keyboardViewport.frameRef} collapsable={false} style={{ flex: 1, minHeight: 0 }} onLayout={keyboardViewport.onFrameLayout}>
    <View testID="guide-viewport" style={{ flex: 1, minHeight: 0, marginBottom: keyboardViewport.bottomInset }} onLayout={event => setViewportHeight(event.nativeEvent.layout.height)}>
    <View style={{ width: '100%', maxWidth: 860, alignSelf: 'center', paddingHorizontal: width / fontScale < 430 ? 14 : 18, paddingTop: shortIndex ? 0 : 8 }}>
      <View style={shortIndex ? { display: 'none' } : undefined} accessibilityElementsHidden={shortIndex} importantForAccessibility={shortIndex ? 'no-hide-descendants' : 'auto'}>
      <WorkspaceHeader title={chapter?.title ?? t('settingsWorkspace.manual')}
        contextLabel={slug ? t('settingsWorkspace.manual') : t('settingsWorkspace.offline')} compact={width / fontScale < 430}
        leading={<IslePressable accessibilityRole="button" accessibilityLabel={t('settingsWorkspace.contents')}
          disabled={!slug} onPress={() => { cancelAnchor(); setSlug(undefined) }}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <AppIcon name="back-previous" size={18} color={slug ? colors.text : colors.textTertiary} />
        </IslePressable>}
        trailing={slug ? <IsleButton tone="soft" compact label={t('settingsWorkspace.closeManual')} onPress={onClose} /> : undefined} />
      </View>
      {!slug ? <View testID="guide-search-toolbar" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, minHeight: 44, paddingBottom: shortIndex ? 0 : 12 }}>
        <IsleSearchField value={query} onChangeText={setQuery} placeholder={t('settingsWorkspace.searchManual')} accessibilityLabel={t('settingsWorkspace.searchManual')} clearAccessibilityLabel={t('common.clearSearch')} onClear={() => setQuery('')} onFocus={keyboardViewport.onFrameLayout} containerStyle={{ flexGrow: 1, flexShrink: 1, flexBasis: 240, minWidth: 0 }} />
        <IsleButton tone="soft" compact label={t('settingsWorkspace.closeManual')} onPress={onClose} />
      </View> : null}
    </View>
    <ScrollView ref={scroll} testID="guide-scroll" keyboardShouldPersistTaps="handled" scrollEventThrottle={64}
      onScroll={event => { if (!slug && !restoreIndex.current) indexOffset.current = event.nativeEvent.contentOffset.y }}
      onContentSizeChange={() => {
        if (slug) { measurePendingAnchor(); return }
        if (!restoreIndex.current) return
        restoreIndex.current = false
        scroll.current?.scrollTo({ y: indexOffset.current, animated: false })
      }}
      onScrollBeginDrag={cancelAnchor} onTouchStart={cancelAnchor}
      {...(Platform.OS === 'web' ? { onWheel: cancelAnchor, onKeyDown: (event: { key: string }) => {
        if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) cancelAnchor()
      } } : {})} >
      <View ref={contentRoot} testID="guide-content" collapsable={false} onLayout={measurePendingAnchor}
        style={{ padding: shortIndex ? 4 : 16, paddingBottom: shortIndex ? 4 : 48 }}>
      <View style={{ maxWidth: 720, width: '100%', alignSelf: 'center', padding: chapter ? 20 : shortIndex ? 0 : 8, borderRadius: 16, backgroundColor: chapter ? colors.ui.semantic.surface.base : 'transparent' }}>
        {!slug ? <>
          <View accessibilityRole="list" style={{ marginTop: shortIndex ? 0 : 12 }}>
            {results.map((item, index) => <IslePressable key={item.id} haptic accessibilityRole="button" accessibilityLabel={item.title} onPress={() => open(item.id)} style={{ minHeight: shortIndex ? 44 : 68, flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: shortIndex ? 8 : 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.section.divider }}>
              <Text accessible={false} importantForAccessibility="no" style={{ fontSize: 12, lineHeight: 18, color: colors.textTertiary }}>{String(index + 1).padStart(2, '0')}</Text>
              <Text style={{ flex: 1, minWidth: 0, ...typography?.title, color: colors.text }}>{item.title}</Text>
              <AppIcon name="arrow-right" size={18} color={colors.textTertiary} />
            </IslePressable>)}
          </View>
          {!results.length ? <Text style={{ fontSize: 16, color: colors.text }}>{t('settingsWorkspace.notFound')}</Text> : null}
        </> : !chapter ? <Text style={{ fontSize: 16, color: colors.text }}>{t('settingsWorkspace.notFound')}</Text> : <>
          <View style={{ marginBottom: 12 }}>
            <IslePressable accessibilityRole="button" accessibilityLabel={t('settingsWorkspace.chapterContents')} accessibilityState={{ expanded: contentsExpanded }} onPress={() => setContentsExpanded(value => !value)} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
              <AppIcon name={contentsExpanded ? 'collapse' : 'back-next'} size={20} color={colors.textSecondary} />
              <Text style={{ flex: 1, fontSize: 16, lineHeight: 24, color: colors.text }}>{t('settingsWorkspace.chapterContents')}</Text>
            </IslePressable>
            {contentsExpanded ? chapter.anchors.map(anchor => {
              const at = blocks.indexOf(anchor)
              const title = blocks[at + 1]?.match(/## ([^\n]+)/)?.[1] ?? anchor
              return <IslePressable key={anchor} accessibilityRole="button" accessibilityLabel={title} onPress={() => open(chapter.id, anchor)} style={{ minHeight: 48, justifyContent: 'center', paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderColor: colors.ui.semantic.chrome.border }}>
                <Text style={{ fontSize: 16, lineHeight: 24, color: colors.primary }}>{title}</Text>
              </IslePressable>
            }) : null}
          </View>
          {blocks.map((body, index) => {
          if (index % 2) return null
          const anchor = index ? blocks[index - 1] : 'title'
          return <View key={`${slug}-${anchor}`} testID={`guide-anchor-${anchor}`} collapsable={false}
            ref={node => {
              const key = contentKey + ':' + anchor
              if (node) anchorViews.current.set(key, node)
              else anchorViews.current.delete(key)
            }} onLayout={measurePendingAnchor}>
            <Markdown style={markdownStyle} onLinkPress={link} rules={{ ...guideHeadings,
              link: (node, children, _parents, styles) => <Text key={node.key} accessibilityRole="link" style={styles.link} onPress={() => link(node.attributes.href)} {...(Platform.OS === 'web' ? { focusable: true, onKeyDown: (event: { key: string; preventDefault: () => void }) => {
                if (event.key === 'Enter') { event.preventDefault(); link(node.attributes.href) }
              } } : {})}>{children}</Text>,
              image: node => {
              const xml = userGuide.assets[node.attributes.src as keyof typeof userGuide.assets]
              return xml ? <View key={node.key} accessible accessibilityLabel={node.content || node.attributes.alt}><SvgXml xml={xml} width={illustrationWidth} height={illustrationWidth * 140 / 640} style={{ width: illustrationWidth, maxWidth: '100%' }} /></View> : null
            } }}>{body}</Markdown>
          </View>
        })}</>}
      </View>
      </View>
    </ScrollView>
    </View>
    </View>
  </IsleScreen>
}

/** The owner stays mounted: reading must never blur-commit or serialize a draft. */
export function SettingsHelpButton({ topic = 'quick-start', compact = false }: { topic?: string; compact?: boolean }) {
  const { t } = useTranslation()
  const { colors } = useAppTheme()
  const [open, setOpen] = useState(false)
  const trigger = useRef<GestureResponderEvent['currentTarget'] | null>(null)
  const historyId = useId()
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open) { wasOpen.current = true; return }
    if (!wasOpen.current) return
    wasOpen.current = false
    const control = trigger.current
    trigger.current = null
    if (!control) return
    return restoreAccessibilityFocus(control)
  }, [open])
  useEffect(() => {
    if (!open || Platform.OS !== 'web') return
    const back = () => { if (window.history.state?.settingsGuide !== historyId) setOpen(false) }
    window.addEventListener('popstate', back)
    return () => window.removeEventListener('popstate', back)
  }, [open, historyId])
  function close() {
    if (Platform.OS === 'web' && window.history.state?.settingsGuide === historyId) window.history.back()
    else setOpen(false)
  }
  function show(event: GestureResponderEvent) {
    trigger.current = event.currentTarget
    Keyboard.dismiss()
    if (Platform.OS === 'web') window.history.pushState({ ...window.history.state, settingsGuide: historyId }, '')
    setOpen(true)
  }
  return <>
    {compact ? <IslePressable accessibilityRole="button" accessibilityLabel={t('settingsWorkspace.openManual')} onPress={show}
      style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><AppIcon name="info" color={colors.textSecondary} size={20} /></IslePressable>
      : <IsleButton tone="soft" label={t('settingsWorkspace.openManual')} onPress={show} />}
    {open ? <Modal visible statusBarTranslucent navigationBarTranslucent animationType="none" presentationStyle="fullScreen" onRequestClose={close}><GuideReader initialSlug={topic} onClose={close} /></Modal> : null}
  </>
}
