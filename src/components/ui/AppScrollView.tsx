import { forwardRef, type ForwardedRef, type ReactElement, type RefAttributes } from 'react'
import { FlatList as NativeFlatList, ScrollView as NativeScrollView, type FlatListProps, type ScrollViewProps } from 'react-native'
import { useAppScrollIndicatorStyle } from '@/hooks/useAppScrollIndicatorStyle'

export type ScrollView = NativeScrollView
export const ScrollView = forwardRef<NativeScrollView, ScrollViewProps>(function AppScrollView({ indicatorStyle, ...props }, ref) {
  const themedIndicator = useAppScrollIndicatorStyle()
  return <NativeScrollView {...props} ref={ref}
    indicatorStyle={!indicatorStyle || indicatorStyle === 'default' ? themedIndicator : indicatorStyle} />
})

export type FlatList<ItemT = any> = NativeFlatList<ItemT>
function AppFlatList<ItemT>({ indicatorStyle, ...props }: FlatListProps<ItemT>, ref: ForwardedRef<NativeFlatList<ItemT>>) {
  const themedIndicator = useAppScrollIndicatorStyle()
  return <NativeFlatList {...props} ref={ref}
    indicatorStyle={!indicatorStyle || indicatorStyle === 'default' ? themedIndicator : indicatorStyle} />
}
export const FlatList = forwardRef(AppFlatList) as <ItemT>(props: FlatListProps<ItemT> & RefAttributes<NativeFlatList<ItemT>>) => ReactElement
