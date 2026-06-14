import { Suspense, lazy, ComponentType } from 'react'
import { View, ActivityIndicator } from 'react-native'
import { useAppTheme } from '@/hooks/useAppTheme'

/**
 * 懒加载加载指示器
 */
function LazyLoadingFallback() {
  const { colors } = useAppTheme()

  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.surface,
      }}
    >
      <ActivityIndicator size="large" color={colors.ui.icon.accentForeground} />
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
 * 预加载组件
 *
 * 在用户可能需要之前预先加载组件
 *
 * @param importFn - 动态导入函数
 */
export function preloadComponent(importFn: () => Promise<{ default: any }>) {
  importFn().catch((error) => {
    console.warn('[Lazy] Failed to preload component:', error)
  })
}

/**
 * 带预加载的懒加载组件
 *
 * 在组件首次渲染时立即开始预加载
 */
export function createLazyComponentWithPreload<T extends ComponentType<any>>(
  importFn: () => Promise<{ default: T }>
): T {
  // 立即开始预加载
  preloadComponent(importFn)
  return createLazyComponent(importFn)
}
