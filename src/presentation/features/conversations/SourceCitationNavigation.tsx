import { useEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, StyleSheet, View, type LayoutRectangle } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Text } from '@/components/ui/AppText'
import { IslePressable } from '@/components/ui/isle'
import { AppIcon } from '@/components/ui/AppIcon'
import { useAppTheme } from '@/hooks/useAppTheme'
import type { MessageCitation } from '@/types/contextContracts'
import { buildSourceCitationNavigation } from './sourceCitationSelection'

export function SourceCitationNavigation({ citations, selectedId, wide, onSelect }: {
  citations: readonly MessageCitation[]
  selectedId?: string
  wide: boolean
  onSelect: (id: string) => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const scroll = useRef<ScrollView>(null)
  const positions = useRef(new Map<number, LayoutRectangle>())
  const [focused, setFocused] = useState<number | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const { selected, selectedIndex, selectable, previous, next } = useMemo(() => buildSourceCitationNavigation(citations, selectedId), [citations, selectedId])
  const listVisible = wide || pickerOpen
  const scrollToSelected = () => {
    const position = positions.current.get(selectedIndex)
    if (position && listVisible) scroll.current?.scrollTo({ x: 0, y: Math.max(0, position.y - 8), animated: false })
  }
  useEffect(() => setPickerOpen(false), [selectedId])
  useEffect(() => {
    const frame = requestAnimationFrame(scrollToSelected)
    return () => cancelAnimationFrame(frame)
  }, [selectedIndex, listVisible])

  const choose = (id: string | undefined) => {
    if (id && selectable.has(id) && id !== selectedId) onSelect(id)
    setPickerOpen(false)
  }
  return <View testID="source-citation-navigation" style={{ minWidth: 0, minHeight: 0, flex: wide ? 1 : undefined, gap: 8 }}>
    <View testID="source-citation-commands" style={styles.commands}>
      <IslePressable testID="source-citation-previous" accessibilityRole="button" accessibilityLabel={t('taskWorkspace.source.previous')}
        accessibilityState={{ disabled: !previous }} disabled={!previous} onPress={() => choose(previous?.id)} style={styles.step}>
        <AppIcon name="back-previous" size={18} color={previous ? colors.text : colors.textTertiary} />
      </IslePressable>
      <IslePressable testID="source-citation-picker" accessibilityRole="button" accessibilityLabel={t('taskWorkspace.source.browse')}
        accessibilityState={{ expanded: listVisible }} haptic onPress={() => wide ? scrollToSelected() : setPickerOpen(value => !value)}
        style={[styles.picker, { borderRadius: colors.design!.semantic.radius.medium, backgroundColor: colors.ui.icon.accentBackground }]}>
        <Text numberOfLines={1} style={[colors.design!.semantic.typography.label, { color: colors.text, flex: 1 }]}>
          {t(selectedIndex < 0 ? 'taskWorkspace.source.choose' : 'taskWorkspace.source.position', { index: selectedIndex + 1, count: citations.length })}
        </Text>
        <View pointerEvents="none" style={{ transform: [{ rotate: listVisible ? '180deg' : '0deg' }] }}>
          <AppIcon name="collapse" size={16} color={colors.textSecondary} />
        </View>
      </IslePressable>
      <IslePressable testID="source-citation-next" accessibilityRole="button" accessibilityLabel={t('taskWorkspace.source.next')}
        accessibilityState={{ disabled: !next }} disabled={!next} onPress={() => choose(next?.id)} style={styles.step}>
        <AppIcon name="back-next" size={18} color={next ? colors.text : colors.textTertiary} />
      </IslePressable>
    </View>
    <ScrollView ref={scroll} testID="source-citation-list" keyboardShouldPersistTaps="handled"
      style={{ minWidth: 0, flex: wide ? 1 : undefined, maxHeight: wide ? undefined : 240, display: listVisible ? 'flex' : 'none' }}
      accessibilityElementsHidden={!listVisible} importantForAccessibility={listVisible ? 'auto' : 'no-hide-descendants'}
      contentContainerStyle={styles.choices}>
    {citations.map((citation, index) => {
      const active = selected === citation
      const disabled = !selectable.has(citation.id)
      return <IslePressable key={`${citation.id}:${index}`} testID={`source-citation-${index}`}
        accessibilityRole="button" accessibilityLabel={`${index + 1}. ${citation.title}`} accessibilityState={{ selected: active, disabled }}
        disabled={disabled} haptic onFocus={() => setFocused(index)} onBlur={() => setFocused(null)}
        onLayout={event => { positions.current.set(index, event.nativeEvent.layout); if (index === selectedIndex) scrollToSelected() }}
        onPress={() => { if (!disabled) choose(citation.id) }}
        style={[styles.choice, { width: '100%', borderRadius: colors.design!.semantic.radius.medium,
          borderColor: focused === index ? colors.ui.semantic.control.focus : 'transparent',
          backgroundColor: active ? colors.ui.icon.accentBackground : 'transparent' }]}>
        <Text accessible={false} importantForAccessibility="no" style={[colors.design!.semantic.typography.caption, { color: active ? colors.ui.icon.accentForeground : colors.textTertiary }]}>{String(index + 1).padStart(2, '0')}</Text>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text numberOfLines={2} style={[colors.design!.semantic.typography.label, { color: active ? colors.text : colors.textSecondary }]}>{citation.title}</Text>
          <Text style={[colors.design!.semantic.typography.caption, { color: colors.textSecondary }]}>{t(`source.${citation.type}`)}</Text>
        </View>
      </IslePressable>
    })}
    </ScrollView>
  </View>
}

const styles = StyleSheet.create({
  choices: { minWidth: 0, gap: 4 },
  commands: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 4 },
  step: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  picker: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  choice: { minWidth: 0, minHeight: 56, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: StyleSheet.hairlineWidth },
})
