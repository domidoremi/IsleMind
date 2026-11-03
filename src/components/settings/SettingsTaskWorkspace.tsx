import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { StyleSheet, View, type GestureResponderEvent } from 'react-native'
import { Text } from '@/components/ui/AppText'
import { useTranslation } from 'react-i18next'
import { AppIcon, type AppIconName } from '@/components/ui/AppIcon'
import { IslePressable } from '@/components/ui/isle'
import { IsleMotionFrame } from '@/components/ui/isle/ThemeMotion'
import { MotiView } from 'moti'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useThemeMotion } from '@/hooks/useThemeMotion'
import { useSettingsLeave } from './SettingsEditBoundary'
import { SettingsSectionContext, useSettingsTarget } from './SettingsSection'
import { restoreAccessibilityFocus } from '@/platform/native/restoreAccessibilityFocus'
import { SettingsNavigationRow } from './SettingsNavigationRow'

export interface SettingsTask {
  id: string
  title: string
  description: string
  summary?: string
  icon: AppIconName
  targets?: readonly string[]
  content: ReactNode
}

/** Complex editors mount on demand; small related tasks can stay visible inline. */
export function SettingsTaskWorkspace({ tasks, value, onTaskChange, overview, inline = false, alwaysVisible = [] }: { inline?: boolean; alwaysVisible?: readonly string[]; tasks: SettingsTask[]; value?: string | null; onTaskChange?: (id: string | undefined) => void; overview?: ReactNode }) {
  const { colors, canonicalThemeId } = useAppTheme()
  const disclosureMotion = useThemeMotion('accent')
  const entranceMotion = disclosureMotion.intensity === 'full' ? 'full' : 'none'
  const { t } = useTranslation()
  const target = useSettingsTarget()
  const { resetScroll, setTaskNavigation } = useContext(SettingsSectionContext)
  const heading = useRef<View>(null)
  const navigating = useRef(false)
  const leave = useSettingsLeave()
  const matched = tasks.find(task => task.id === target || task.targets?.includes(target ?? ''))?.id
  const [localSelection, setLocalSelection] = useState<string | undefined>(matched)
  const selected = value === undefined ? localSelection : value ?? undefined
  function select(id: string | undefined, focus = true) {
    if (!inline && focus) resetScroll?.(!id)
    navigating.current = focus
    if (value === undefined) setLocalSelection(id)
    else changeRef.current?.(id)
  }
  const changeRef = useRef(onTaskChange)
  changeRef.current = onTaskChange
  useEffect(() => {
    if (inline || !navigating.current) return
    navigating.current = false
    if (heading.current) return restoreAccessibilityFocus(heading.current as unknown as GestureResponderEvent['currentTarget'])
  }, [selected])
  useEffect(() => { if (value === undefined) changeRef.current?.(localSelection) }, [localSelection, value])
  const previousTarget = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (target === previousTarget.current) return
    previousTarget.current = target
    if (matched && matched !== selected) void leave(() => select(matched, false))
  }, [target, matched, leave])
  const current = tasks.find(task => task.id === selected)
  const selectRef = useRef(select)
  selectRef.current = select
  const back = useCallback(() => { void leave(() => selectRef.current(undefined)) }, [leave])
  useEffect(() => {
    setTaskNavigation?.(!inline && current ? { title: current.title, onBack: back } : undefined)
    return () => setTaskNavigation?.(undefined)
  }, [current?.id, current?.title, back, setTaskNavigation, inline])
  if (inline) return <View testID="settings-inline-workspace" style={{ gap: canonicalThemeId === 'monet' ? 28 : 22 }}>
    {tasks.map((task, index) => {
      const pinned = alwaysVisible.includes(task.id)
      const expanded = pinned || selected === task.id
      const TaskHeading = pinned ? View : IslePressable
      const open = canonicalThemeId === 'minimal' || canonicalThemeId === 'monet' || canonicalThemeId === 'material'
      const journal = canonicalThemeId === 'animal-island-ui'
      const glass = canonicalThemeId === 'liquid-glass'
      return <IsleMotionFrame key={task.id} role="section" layout enter={false} motion={entranceMotion} style={{ minWidth: 0, borderRadius: open ? 0 : journal ? 4 : glass ? 24 : 16,
        padding: open ? 0 : 12, backgroundColor: open ? 'transparent' : glass ? colors.ui.semantic.chrome.background : colors.ui.semantic.surface.raised,
        borderTopWidth: open ? StyleSheet.hairlineWidth : 0, borderTopColor: colors.ui.section.divider,
        borderLeftWidth: journal ? 3 : 0, borderLeftColor: colors.ui.icon.accentForeground }}>
        <TaskHeading testID={`settings-task-${task.id}`} accessible={pinned ? true : undefined}
          accessibilityRole={pinned ? 'header' : 'button'} accessibilityLabel={task.title}
          accessibilityState={pinned ? undefined : { expanded }}
          onPress={pinned ? undefined : () => void leave(() => select(expanded ? undefined : task.id, false))}
          style={{ minHeight: 52, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {canonicalThemeId === 'monet' ? <Text style={{ color: colors.textTertiary }}>{String(index + 1).padStart(2, '0')}</Text> : canonicalThemeId === 'minimal' ? null : <AppIcon name={task.icon} size={18} color={expanded ? colors.ui.icon.accentForeground : colors.textSecondary} />}
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            <Text style={{ color: colors.text, fontSize: canonicalThemeId === 'monet' ? 20 : 16, lineHeight: 26, fontWeight: '700' }}>{task.title}</Text>
            {!expanded && (task.summary || task.description) ? <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 18 }}>{task.summary || task.description}</Text> : null}
          </View>
          {!pinned ? <MotiView pointerEvents="none" accessible={false} animate={{ rotate: expanded ? '180deg' : '0deg' }} transition={disclosureMotion.intensity === 'full' ? disclosureMotion.transition : { type: 'timing', duration: 0 }}>
            <AppIcon name="collapse" size={18} color={expanded ? colors.ui.icon.accentForeground : colors.textTertiary} />
          </MotiView> : null}
        </TaskHeading>
        {expanded ? <IsleMotionFrame role="section" motion={entranceMotion} direction="forward" testID={`settings-task-editor-${task.id}`} style={{ gap: 12, paddingBottom: 12 }}>{task.content}</IsleMotionFrame> : null}
      </IsleMotionFrame>
    })}
    {overview}
  </View>
  if (current) return <IsleMotionFrame key={current.id} role="section" motion={entranceMotion} direction="forward" testID={`settings-task-editor-${current.id}`} style={{ gap: 16 }}>
    {!setTaskNavigation ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <IslePressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={back}
        style={{ minHeight: 44, minWidth: 44, justifyContent: 'center' }}>
        <AppIcon name="back-previous" size={20} color={colors.text} />
      </IslePressable>
      <View ref={heading} accessible accessibilityRole="header" tabIndex={-1}><Text style={{ color: colors.text, fontSize: 21, lineHeight: 29, fontWeight: '700' }}>{current.title}</Text></View>
    </View> : null}
    {current.content}
  </IsleMotionFrame>
  return <IsleMotionFrame key="task-list" role="section" motion={entranceMotion} testID="settings-task-list" style={{ gap: 20 }}>
    <View style={{ padding: canonicalThemeId === 'liquid-glass' || canonicalThemeId === 'animal-island-ui' ? 4 : 0,
      borderRadius: canonicalThemeId === 'liquid-glass' ? colors.ui.radius.panel : canonicalThemeId === 'animal-island-ui' ? 4 : 0,
      backgroundColor: canonicalThemeId === 'liquid-glass' ? colors.ui.semantic.chrome.background : 'transparent',
      borderLeftWidth: canonicalThemeId === 'animal-island-ui' ? 3 : 0, borderLeftColor: colors.ui.icon.accentForeground }}>
      {tasks.map((task, index) => <SettingsNavigationRow key={task.id} id={`settings-task-${task.id}`}
        title={task.title} status={task.summary} detail={task.description} icon={task.icon} last={index === tasks.length - 1} onPress={() => select(task.id)} />)}
    </View>
    {overview}
  </IsleMotionFrame>
}
