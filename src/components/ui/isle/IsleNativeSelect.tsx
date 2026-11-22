import { useEffect, useRef, useState, type ComponentRef } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native'
import { MotiView } from 'moti'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Modal } from '@/components/ui/AppModal'
import { Text } from '@/components/ui/AppText'
import { AppIcon } from '@/components/ui/AppIcon'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useThemeMotion } from '@/hooks/useThemeMotion'
import { resolveNativeSelectLayout } from './nativeSelectLayout'

interface Option { label: string; value: string; disabled?: boolean }
interface Size { width: number; height: number }
interface Rect extends Size { x: number; y: number }

/** Native island rendering with app-owned safe-area and keyboard boundaries. */
export function IsleNativeSelect({ options, value, placeholder, disabled, onChange, style, accessibilityLabel, testID }: {
  options: Option[]
  value?: string
  placeholder: string
  disabled: boolean
  onChange: (value: string) => void
  style?: StyleProp<ViewStyle>
  accessibilityLabel?: string
  testID?: string
}) {
  const { colors, isDark } = useAppTheme()
  const motion = useThemeMotion('overlay', { readable: true })
  const insets = useSafeAreaInsets()
  const window = useWindowDimensions()
  const [open, setOpen] = useState(false)
  const [viewport, setViewport] = useState<Size | null>(null)
  const [anchor, setAnchor] = useState<Rect | null>(null)
  const [panel, setPanel] = useState<Size | null>(null)
  const trigger = useRef<ComponentRef<typeof View>>(null)
  const selected = options.find(option => option.value === value)
  const bounds = resolveNativeSelectLayout(anchor, viewport ?? window, insets,
    panel ?? { width: 200, height: options.length * 44 + 24 })
  const close = () => setOpen(false)

  useEffect(() => {
    if (!open || disabled) { setOpen(false); setAnchor(null); setPanel(null); return }
    let current = true
    trigger.current?.measureInWindow((x, y, width, height) => {
      if (current && width > 0 && height > 0) setAnchor({ x, y, width, height })
    })
    return () => { current = false }
  }, [open, disabled, window.width, window.height, insets.top, insets.right, insets.bottom, insets.left])

  return (
    <View style={[styles.wrapper, disabled && { opacity: 0.5 }, style]} testID={testID}>
      <Pressable
        ref={trigger}
        testID={testID ? `${testID}-trigger` : undefined}
        accessibilityRole="combobox"
        accessibilityLabel={accessibilityLabel ?? placeholder}
        accessibilityState={{ disabled, expanded: open && !disabled }}
        disabled={disabled}
        onPress={() => setOpen(current => !current)}
        style={[styles.trigger, {
          backgroundColor: disabled ? colors.ui.semantic.surface.muted : isDark ? colors.surfaceSecondary : '#fff',
          borderColor: isDark ? colors.border : '#e8dcc8',
        }]}
      >
        <Text style={[styles.value, { color: isDark ? colors.text : selected ? '#725d42' : '#a09080' }]}>
          {selected?.label ?? placeholder}
        </Text>
        <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
          <AppIcon name="collapse" size={12} color={open ? colors.primary : isDark ? colors.textSecondary : '#a09080'} />
        </View>
      </Pressable>
      {open && !disabled ? (
        <Modal transparent visible animationType="none" statusBarTranslucent navigationBarTranslucent
          onRequestClose={close} testID={testID ? `${testID}-modal` : undefined}>
          <KeyboardAvoidingView
            testID={testID ? `${testID}-viewport` : undefined}
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            onLayout={({ nativeEvent: { layout: { width, height } } }) => {
              if (width > 0 && height > 0) setViewport(previous =>
                previous?.width === width && previous.height === height ? previous : { width, height })
            }}
          >
            <Pressable style={StyleSheet.absoluteFill} onPress={close}
              testID={testID ? `${testID}-backdrop` : undefined} />
            <MotiView
              role="list"
              accessibilityLabel={accessibilityLabel}
              accessibilityViewIsModal
              testID={testID ? `${testID}-listbox` : undefined}
              from={{ opacity: motion.from.opacity }}
              animate={{ opacity: 1 }}
              transition={motion.transition}
              onLayout={({ nativeEvent: { layout: { width, height } } }) => {
                if (width > 0 && height > 0) setPanel(previous =>
                  previous?.width === width && previous.height === height ? previous : { width, height })
              }}
              style={[styles.dropdown, bounds, { backgroundColor: isDark ? colors.surfaceSecondary : '#ffeea0' }]}
            >
              <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled"
                testID={testID ? `${testID}-options` : undefined}>
                {options.map(option => (
                  <Pressable
                    key={option.value}
                    role="option"
                    accessibilityLabel={option.label}
                    accessibilityState={{ disabled: !!option.disabled, selected: option.value === value }}
                    focusable={!option.disabled}
                    disabled={option.disabled}
                    onPress={option.disabled ? undefined : () => { onChange(option.value); close() }}
                    style={styles.option}
                    testID={testID ? `${testID}-option-${option.value}` : undefined}
                  >
                    {({ pressed }) => <>
                      {option.value === value ? <View pointerEvents="none" style={styles.pill} /> : null}
                      <View pointerEvents="none" style={{ width: 16 }} />
                      <Text style={[styles.optionLabel, {
                        color: option.disabled ? colors.textTertiary : isDark ? colors.text : '#725d42',
                        fontWeight: option.value === value || pressed ? '700' : '500',
                      }]}>{option.label}</Text>
                    </>}
                  </Pressable>
                ))}
              </ScrollView>
            </MotiView>
          </KeyboardAvoidingView>
        </Modal>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: { alignSelf: 'flex-start', minWidth: 140 },
  trigger: {
    minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    paddingVertical: 8, paddingHorizontal: 13, borderWidth: 2, borderRadius: 12,
  },
  value: { flexShrink: 1, fontSize: 14, fontWeight: '600' },
  dropdown: { position: 'absolute', paddingVertical: 12, borderRadius: 28 },
  option: {
    minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, paddingLeft: 14, paddingRight: 30,
  },
  optionLabel: { flexShrink: 1, fontSize: 14 },
  pill: { position: 'absolute', left: 20, right: 20, top: '56%', marginTop: -7,
    height: 14, borderRadius: 7, backgroundColor: '#ffcc00', opacity: 0.3 },
})
