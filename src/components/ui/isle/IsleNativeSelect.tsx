import { useEffect, useRef, useState, type ComponentRef } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native'
import { ScrollView } from '@/components/ui/AppScrollView'
import { MotiView } from 'moti'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Modal } from '@/components/ui/AppModal'
import { Text } from '@/components/ui/AppText'
import { AppIcon } from '@/components/ui/AppIcon'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useThemeMotion } from '@/hooks/useThemeMotion'
import { resolveNativeSelectLayout } from './nativeSelectLayout'
import { IsleOverlayPressable, IslePressable } from './Pressable'

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
  const { colors } = useAppTheme()
  const motion = useThemeMotion('overlay', { readable: true })
  const insets = useSafeAreaInsets()
  const window = useWindowDimensions()
  const [open, setOpen] = useState(false)
  const [viewport, setViewport] = useState<Size | null>(null)
  const [anchor, setAnchor] = useState<Rect | null>(null)
  const [panel, setPanel] = useState<Size | null>(null)
  const trigger = useRef<ComponentRef<typeof View>>(null)
  const selected = options.find(option => option.value === value)
  const preferredWidth = Math.min(320, Math.max(200, anchor?.width ?? 200))
  const bounds = resolveNativeSelectLayout(anchor, viewport ?? window, insets,
    { width: preferredWidth, height: panel?.height ?? options.length * 44 + 24 })
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
      <IslePressable
        ref={trigger}
        testID={testID ? `${testID}-trigger` : undefined}
        accessibilityRole="combobox"
        accessibilityLabel={accessibilityLabel ?? placeholder}
        accessibilityValue={{ text: selected?.label ?? placeholder }}
        accessibilityState={{ disabled, expanded: open && !disabled }}
        disabled={disabled}
        disabledOpacity={1}
        onPress={() => setOpen(current => !current)}
        style={[styles.trigger, {
          backgroundColor: disabled ? colors.ui.control.disabledBackground : colors.ui.input.background,
          borderColor: disabled ? colors.ui.control.disabledBorder : colors.ui.input.border,
        }]}
      >
        <Text style={[styles.value, { color: disabled ? colors.ui.control.disabledForeground : selected ? colors.text : colors.ui.input.placeholderForeground }]}>
          {selected?.label ?? placeholder}
        </Text>
        <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
          <AppIcon name="collapse" size={12} color={disabled ? colors.ui.control.disabledForeground : open ? colors.ui.input.focus : colors.ui.input.placeholderForeground} />
        </View>
      </IslePressable>
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
            <IsleOverlayPressable accessible={false} accessibilityRole="none" focusable={false}
              importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill} onPress={close}
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
              style={[styles.dropdown, bounds, {
                width: Math.min(preferredWidth, bounds.maxWidth),
                backgroundColor: colors.ui.semantic.chrome.sheet,
                borderColor: colors.borderStrong, shadowColor: colors.shadowTint,
              }]}
            >
              <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled"
                testID={testID ? `${testID}-options` : undefined}>
                {options.map(option => (
                  <IslePressable
                    key={option.value}
                    role="option"
                    accessibilityLabel={option.label}
                    accessibilityState={{ disabled: !!option.disabled, selected: option.value === value }}
                    focusable={!option.disabled}
                    disabled={option.disabled}
                    disabledOpacity={1}
                    onPress={option.disabled ? undefined : () => { onChange(option.value); close() }}
                    style={({ pressed }) => [styles.option, {
                      backgroundColor: option.value === value ? colors.ui.tone.success.background
                        : pressed && !option.disabled ? colors.ui.control.defaultBackground : 'transparent',
                    }]}
                    testID={testID ? `${testID}-option-${option.value}` : undefined}
                  >
                    {({ pressed }) => <>
                      <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
                        style={styles.selectionMark}>
                        {option.value === value ? <AppIcon name="check" size={18}
                          color={option.disabled ? colors.textTertiary : colors.ui.tone.success.foreground} /> : null}
                      </View>
                      <Text style={[styles.optionLabel, {
                        color: option.disabled ? colors.textTertiary : option.value === value ? colors.ui.tone.success.foreground : colors.text,
                        fontWeight: option.value === value || pressed ? '700' : '500',
                      }]}>{option.label}</Text>
                    </>}
                  </IslePressable>
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
  dropdown: {
    position: 'absolute', padding: 8, borderRadius: 24, borderWidth: 1,
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 12, elevation: 8,
  },
  option: {
    minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: 16,
  },
  selectionMark: { width: 18, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  optionLabel: { flex: 1, flexShrink: 1, fontSize: 14 },
})
