import { createContext, useCallback, useContext, useEffect, useRef, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { View, type StyleProp, type ViewStyle } from 'react-native'
import { useAppTheme } from '@/hooks/useAppTheme'

export interface SettingsTaskNavigation { title: string; onBack: () => void }
export interface SettingsUndoAction { onPress: () => void; disabled: boolean }

export const SettingsSectionContext = createContext<{
  target?: string
  highlight?: string
  register: (id: string, node: View | null) => void
  resetScroll?: (restoreList?: boolean) => void
  setTaskNavigation?: (navigation: SettingsTaskNavigation | undefined) => void
  setUndoAction?: Dispatch<SetStateAction<SettingsUndoAction | undefined>>
}>({ register: () => undefined })
export function useSettingsTarget() { return useContext(SettingsSectionContext).target }
/** Reversible settings use the existing header slot, never an inserted content row. */
export function useSettingsUndoAction(available: boolean, onUndo: () => void, busy = false) {
  const { setUndoAction } = useContext(SettingsSectionContext)
  const undoRef = useRef(onUndo)
  undoRef.current = onUndo
  const allowed = useRef(available && !busy)
  allowed.current = available && !busy
  const undo = useCallback(() => { if (allowed.current) undoRef.current() }, [])
  useEffect(() => {
    allowed.current = available && !busy
    if (!setUndoAction) return () => { allowed.current = false }
    const action = available ? { onPress: undo, disabled: busy } : undefined
    setUndoAction(action)
    return () => {
      allowed.current = false
      setUndoAction(current => current === action ? undefined : current)
    }
  }, [available, busy, setUndoAction, undo])
}
export function SettingsSection({ id, children, style }: { id: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { register, highlight } = useContext(SettingsSectionContext)
  const node = useRef<View>(null)
  const { colors } = useAppTheme()
  useEffect(() => () => register(id, null), [id, register])
  return <View ref={node} collapsable={false} testID={`settings-section-${id}`} onLayout={() => register(id, node.current)} style={[{ borderLeftWidth: 3, borderLeftColor: highlight === id ? colors.primary : 'transparent', paddingLeft: 5, minWidth: 0 }, style]}>{children}</View>
}
