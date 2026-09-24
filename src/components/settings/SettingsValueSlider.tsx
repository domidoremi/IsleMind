import { useEffect, useMemo, useRef, useState } from 'react'
import { PanResponder, Text, View } from 'react-native'
import { useAppTheme } from '@/hooks/useAppTheme'

/** Preview is local. Only a completed gesture or accessibility step commits. */
export function SettingsValueSlider({ label, value, min, max, step, logarithmic = false, onCommit }: {
  label: string; value: number; min: number; max: number; step: number; logarithmic?: boolean; onCommit: (value: number) => void
}) {
  const { colors } = useAppTheme()
  const [preview, setPreview] = useState(value)
  const width = useRef(1)
  const gesture = useRef<{ origin: number; value: number } | null>(null)
  const current = useRef({ value, onCommit })
  current.current = { value, onCommit }
  useEffect(() => { gesture.current = null; setPreview(value) }, [value])
  const clamp = (next: number) => Math.max(min, Math.min(max, Number((Math.round(next / step) * step).toFixed(4))))
  const fraction = logarithmic ? Math.log(Math.max(min, preview) / min) / Math.log(max / min) : (preview - min) / (max - min)
  const responder = useMemo(() => {
    function move(pageX: number) {
      if (!gesture.current) return
      const ratio = Math.max(0, Math.min(1, (pageX - gesture.current.origin) / width.current))
      const next = clamp(logarithmic ? min * Math.pow(max / min, ratio) : min + (max - min) * ratio)
      gesture.current.value = next
      setPreview(next)
    }
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: event => {
        gesture.current = { origin: event.nativeEvent.pageX - event.nativeEvent.locationX, value: current.current.value }
        move(event.nativeEvent.pageX)
      },
      onPanResponderMove: event => move(event.nativeEvent.pageX),
      onPanResponderRelease: () => {
        const next = gesture.current?.value
        gesture.current = null
        if (next !== undefined) current.current.onCommit(next)
      },
      onPanResponderTerminationRequest: () => true,
      onPanResponderTerminate: () => { gesture.current = null; setPreview(current.current.value) },
    })
  }, [min, max, step, logarithmic])
  function adjust(direction: number) {
    const next = clamp(current.current.value + step * direction)
    setPreview(next)
    current.current.onCommit(next)
  }
  return <View style={{ gap: 2 }}>
    <View {...responder.panHandlers} testID={`settings-slider-${label}`} accessible focusable accessibilityRole="adjustable" accessibilityLabel={label}
      accessibilityValue={{ min, max, now: preview }} accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'increment') adjust(1); if (event.nativeEvent.actionName === 'decrement') adjust(-1) }}
      onLayout={event => { width.current = Math.max(1, event.nativeEvent.layout.width) }}
      style={{ minHeight: 44, justifyContent: 'center', marginHorizontal: 11 }}>
      <View pointerEvents="none" style={{ height: 6, borderRadius: 3, backgroundColor: colors.ui.semantic.chrome.border }}>
        <View style={{ height: 6, width: `${Math.max(0, Math.min(1, fraction)) * 100}%`, borderRadius: 3, backgroundColor: colors.primary }} />
        <View style={{ position: 'absolute', top: -8, left: `${Math.max(0, Math.min(1, fraction)) * 100}%`, marginLeft: -11, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary }} />
      </View>
    </View>
    <Text style={{ fontSize: 14, lineHeight: 20, color: colors.textSecondary }}>{preview} · {min}–{max}</Text>
  </View>
}
