import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Keyboard, Linking, Modal, Platform, ScrollView, Text, View, useWindowDimensions, type GestureResponderEvent } from 'react-native'
import Markdown, { type RenderFunction } from 'react-native-markdown-display'
import { SvgXml } from 'react-native-svg'
import { useTranslation } from 'react-i18next'
import { IsleButton, IslePressable, IsleScreen, IsleSearchField } from '@/components/ui/isle'
import { AppIcon } from '@/components/ui/AppIcon'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { userGuide } from '@/generated/userGuide'
import { safeHttpUrl } from '@/utils/sourceUrlSafety'
import { restoreAccessibilityFocus } from '@/platform/native/restoreAccessibilityFocus'

const guideHeading: RenderFunction = (node, children, _parents, styles) => (
  <View key={node.key} accessible accessibilityRole="header" {...(Platform.OS === 'web' ? { 'aria-level': Number(node.type.slice(-1)) } : {})} style={styles[`_VIEW_SAFE_${node.type}`]}>{children}</View>
)
const guideHeadings = { heading1: guideHeading, heading2: guideHeading, heading3: guideHeading, heading4: guideHeading, heading5: guideHeading, heading6: guideHeading }

export function GuideReader({ initialSlug, initialAnchor, onClose }: { initialSlug?: string; initialAnchor?: string; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const { width } = useWindowDimensions()
  const illustrationWidth = Math.max(120, Math.min(720, width - 32) - 40)
  const language = i18n.language.startsWith('zh') ? 'zh-CN' : i18n.language.startsWith('ja') ? 'ja' : 'en'
  const chapters: readonly { id: string; title: string; body: string; anchors: readonly string[] }[] = userGuide.chapters[language]
  const [slug, setSlug] = useState(initialSlug)
  const [query, setQuery] = useState('')
  const [contentsExpanded, setContentsExpanded] = useState(false)
  const scroll = useRef<ScrollView>(null)
  const pendingAnchor = useRef(initialAnchor)
  const positions = useRef(new Map<string, number>())
  const chapter = chapters.find(item => item.id === slug)
  const searchIndex = useMemo(() => chapters.map(item => ({ ...item, search: `${item.title} ${item.body}`.normalize('NFKC').toLocaleLowerCase() })), [chapters])
  const results = searchIndex.filter(item => item.search.includes(query.normalize('NFKC').trim().toLocaleLowerCase()))
  const blocks = useMemo(() => chapter?.body.split(/<a id="([a-z0-9-]+)"><\/a>/) ?? [], [chapter])
  useEffect(() => { positions.current.clear(); scroll.current?.scrollTo({ y: 0, animated: false }) }, [slug, language])
  function open(nextSlug: string, anchor?: string) {
    pendingAnchor.current = anchor
    if (nextSlug === slug && anchor && positions.current.has(anchor)) {
      scroll.current?.scrollTo({ y: positions.current.get(anchor)!, animated: motion === 'full' })
      pendingAnchor.current = undefined
    } else { setQuery(''); setContentsExpanded(false); setSlug(nextSlug) }
  }
  function link(href: string) {
    const safe = safeHttpUrl(href)
    if (safe) { void Linking.openURL(safe).catch(() => undefined); return false }
    const [file, anchor] = href.split('#')
    if ((!file || /^[a-z0-9-]+\.md$/.test(file)) && (file || slug)) open(file ? file.replace(/\.md$/, '') : slug!, anchor)
    return false
  }
  const markdownStyle = {
    body: { fontFamily: Platform.OS === 'web' ? 'system-ui' : undefined, fontSize: 16, lineHeight: 26, color: colors.text },
    heading1: { fontSize: 28, lineHeight: 36, marginBottom: 16, color: colors.text },
    heading2: { fontSize: 21, lineHeight: 30, marginTop: 20, marginBottom: 8, color: colors.text },
    heading3: { fontSize: 18, lineHeight: 28, color: colors.text },
    heading4: { fontSize: 16, lineHeight: 26, color: colors.text },
    heading5: { fontSize: 16, lineHeight: 26, color: colors.text },
    heading6: { fontSize: 16, lineHeight: 26, color: colors.text },
    link: { color: colors.primary, textDecorationLine: 'underline' as const },
    paragraph: { marginBottom: 12 },
  }
  return <IsleScreen padded={false}>
    <View style={{ padding: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
      <IsleButton tone="soft" label={t('settingsWorkspace.contents')} onPress={() => { pendingAnchor.current = undefined; setSlug(undefined) }} />
      <IsleButton tone="soft" label={t('settingsWorkspace.closeManual')} onPress={onClose} />
    </View>
    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" onScrollBeginDrag={() => { pendingAnchor.current = undefined }} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      <View style={{ maxWidth: 720, width: '100%', alignSelf: 'center', padding: 20, borderRadius: 16, backgroundColor: colors.ui.semantic.surface.base }}>
        {!slug ? <>
          <Text accessibilityRole="header" style={{ fontSize: 28, fontWeight: '800', color: colors.text }}>{t('settingsWorkspace.manual')}</Text>
          <Text style={{ fontSize: 14, lineHeight: 24, color: colors.textSecondary, marginBottom: 16 }}>{t('settingsWorkspace.offline')}</Text>
          <IsleSearchField value={query} onChangeText={setQuery} placeholder={t('settingsWorkspace.searchManual')} accessibilityLabel={t('settingsWorkspace.searchManual')} clearAccessibilityLabel={t('common.clearSearch')} onClear={() => setQuery('')} />
          {results.map(item => <IslePressable key={item.id} accessibilityRole="button" onPress={() => open(item.id)} style={{ minHeight: 52, justifyContent: 'center', paddingVertical: 12, borderBottomWidth: 1, borderColor: colors.ui.semantic.chrome.border }}><Text style={{ fontSize: 17, color: colors.text }}>{item.title}</Text></IslePressable>)}
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
          return <View key={`${slug}-${anchor}`} onLayout={event => {
            const y = event.nativeEvent.layout.y + 16
            positions.current.set(anchor, y)
            if (pendingAnchor.current === anchor) {
              scroll.current?.scrollTo({ y, animated: false })
              pendingAnchor.current = undefined
            }
          }}>
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
    </ScrollView>
  </IsleScreen>
}

/** The owner stays mounted: reading must never blur-commit or serialize a draft. */
export function SettingsHelpButton({ topic = 'quick-start' }: { topic?: string }) {
  const { t } = useTranslation()
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
  return <>
    <IsleButton tone="soft" label={t('settingsWorkspace.openManual')} onPress={event => {
      // Keep the actual control, not its label or a non-accessible wrapper.
      // Read currentTarget synchronously: React clears it after dispatch.
      trigger.current = event.currentTarget
      Keyboard.dismiss()
      if (Platform.OS === 'web') window.history.pushState({ ...window.history.state, settingsGuide: historyId }, '')
      setOpen(true)
    }} />
    {open ? <Modal visible statusBarTranslucent navigationBarTranslucent animationType="none" presentationStyle="fullScreen" onRequestClose={close}><GuideReader initialSlug={topic} onClose={close} /></Modal> : null}
  </>
}
