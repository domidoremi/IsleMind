import { Platform } from 'react-native'

/** RN Web handles Enter on switches, but only gives button roles Space support. */
export function switchKeyboardProps(onToggle: () => void, disabled = false) {
  return Platform.OS === 'web' ? {
    onKeyDown: (event: { key: string; repeat?: boolean; defaultPrevented?: boolean; preventDefault(): void; stopPropagation(): void }) => {
      if ((event.key !== ' ' && event.key !== 'Spacebar') || event.defaultPrevented) return
      event.preventDefault()
      event.stopPropagation()
      if (!disabled && !event.repeat) onToggle()
    },
  } : {}
}
