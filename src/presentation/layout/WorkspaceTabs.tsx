import { useState } from 'react'
import { Platform, View, useWindowDimensions } from 'react-native'
import type { AppIconName } from '@/components/ui/AppIcon'
import { WorkspaceChoice } from './WorkspaceChoice'

export function WorkspaceTabs<T extends string>({ value, tabs, onChange, testID, role = 'tab', disabled = false, accessibilityLabel }: {
  value: T
  tabs: readonly { value: T; label: string; icon?: AppIconName; disabled?: boolean }[]
  onChange: (value: T) => void
  testID?: string
  role?: 'tab' | 'radio'
  disabled?: boolean
  accessibilityLabel?: string
}) {
  const { width, fontScale } = useWindowDimensions()
  const [measuredWidth, setMeasuredWidth] = useState(0)
  const compact = Math.min(width, measuredWidth || width) / fontScale < 430
  const grid = compact && tabs.length > 3
  const keyboard = Platform.OS === 'web' ? {
    onKeyDown: (event: { key: string; preventDefault(): void; currentTarget: unknown }) => {
      const current = tabs.findIndex(tab => tab.value === value)
      if (disabled) return
      const enabled = tabs.map((tab, index) => tab.disabled ? undefined : index).filter((index): index is number => index !== undefined)
      if (!enabled.length) return
      const active = Math.max(0, enabled.indexOf(current))
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? enabled[(active + 1) % enabled.length]
          : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? enabled[(active - 1 + enabled.length) % enabled.length] : undefined
      if (next === undefined) return
      const index = event.key === 'Home' ? enabled[0]! : event.key === 'End' ? enabled[enabled.length - 1]! : next
      event.preventDefault()
      onChange(tabs[index]!.value)
      const host = event.currentTarget as HTMLElement
      host.querySelectorAll<HTMLElement>(`[role="${role}"]`)[index]?.focus()
    },
  } : {}
  const active = tabs.find(tab => tab.value === value && !tab.disabled)?.value ?? tabs.find(tab => !tab.disabled)?.value
  return <View {...keyboard} testID={testID} accessibilityRole={role === 'radio' ? 'radiogroup' : 'tablist'} accessibilityLabel={accessibilityLabel}
    onLayout={event => setMeasuredWidth(event.nativeEvent.layout.width)}
    style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
    {tabs.map(tab => <WorkspaceChoice key={tab.value} label={tab.label} icon={compact ? undefined : tab.icon}
      role={role} selected={value === tab.value} disabled={disabled || tab.disabled}
      tabIndex={!disabled && active === tab.value ? 0 : -1}
      testID={testID ? `${testID}-${tab.value}` : undefined} onPress={() => onChange(tab.value)}
      style={{ flexGrow: 1, flexBasis: grid ? '48%' : `${Math.floor(96 / tabs.length)}%`, minWidth: 0 }} />)}
  </View>
}
