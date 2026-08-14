import { Suspense, lazy, ComponentType } from 'react'
import { View } from 'react-native'
import { useAppTheme } from '@/hooks/useAppTheme'
import { HighFrameSpinner } from '@/components/ui/HighFrameSpinner'

/**
 * 懒加载加载指示器
 */
function LazyLoadingFallback() {
  const { colors } = useAppTheme()

  return (
    <View
      style={{
        minHeight: 72,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'transparent',
      }}
    >
      <HighFrameSpinner color={colors.ui.icon.accentForeground} size={22} strokeWidth={2.2} />
    </View>
  )
}

/**
 * 创建懒加载组件包装器
 *
 * 使用方式:
 * ```typescript
 * const Settings = createLazyComponent(
 *   () => import('@/components/settings/SettingsContent')
 * )
 * ```
 *
 * @param importFn - 动态导入函数
 * @returns 懒加载的 React 组件
 */
export function createLazyComponent<T extends ComponentType<any>>(
  importFn: () => Promise<{ default: T }>
): T {
  const LazyComponent = lazy(importFn)

  return ((props: any) => (
    <Suspense fallback={<LazyLoadingFallback />}>
      <LazyComponent {...props} />
    </Suspense>
  )) as T
}

/**
 * Compatibility wrapper for existing Settings routes.
 *
 * Expo Router evaluates every route module while building its route tree.
 * Starting the import here would eagerly fetch every Settings bundle at once,
 * so loading must remain owned by React.lazy when the route actually renders.
 *
 * Delete this alias after callers migrate to createLazyComponent.
 */
export function createLazyComponentWithPreload<T extends ComponentType<any>>(
  importFn: () => Promise<{ default: T }>
): T {
  return createLazyComponent(importFn)
}
