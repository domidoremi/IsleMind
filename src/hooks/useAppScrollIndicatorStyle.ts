import type { ScrollViewProps } from 'react-native'
import { useAppTheme } from './useAppTheme'

/** iOS defaults to black indicators even when the app chooses a dark canvas. */
export function useAppScrollIndicatorStyle(): NonNullable<ScrollViewProps['indicatorStyle']> {
  return useAppTheme().isDark ? 'white' : 'black'
}
