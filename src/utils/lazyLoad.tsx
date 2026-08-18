import { Suspense, lazy, type ComponentProps, type ComponentType, type ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useAppTheme } from '@/hooks/useAppTheme'
import { HighFrameSpinner } from '@/components/ui/HighFrameSpinner'

/**
 * 懒加载加载指示器
 */
interface LazyLoadingFallbackProps {
  dismissLabel?: string
  onDismiss?: () => void
}

export function LazyLoadingFallback({ dismissLabel, onDismiss }: LazyLoadingFallbackProps = {}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()

  return (
    <View
      style={{
        flex: 1,
        width: '100%',
        minHeight: 72,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 20,
        backgroundColor: 'transparent',
      }}
    >
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={t('common.loading')}
        accessibilityState={{ busy: true }}
        accessibilityLiveRegion="polite"
        style={{ alignItems: 'center', gap: 12 }}
      >
        <HighFrameSpinner color={colors.ui.icon.accentForeground} size={22} strokeWidth={2.2} />
        <Text
          accessible={false}
          style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '700', textAlign: 'center' }}
        >
          {t('common.loading')}
        </Text>
      </View>
      {onDismiss ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={dismissLabel ?? t('common.back')}
          onPress={onDismiss}
          style={({ pressed }) => ({
            minHeight: 44,
            minWidth: 88,
            paddingHorizontal: 14,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: Math.min(colors.ui.radius.controlMiddle, 8),
            borderWidth: 1,
            borderColor: colors.ui.control.primaryBorder,
            backgroundColor: colors.ui.control.defaultBackground,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 16, fontWeight: '800' }}>
            {dismissLabel ?? t('common.back')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}

interface LazyComponentOptions<T extends ComponentType<any>> {
  renderFallback?: (props: ComponentProps<T>) => ReactNode
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
  importFn: () => Promise<{ default: T }>,
  options: LazyComponentOptions<T> = {},
): T {
  const LazyComponent = lazy(importFn)

  return ((props: any) => (
    <Suspense fallback={options.renderFallback?.(props) ?? <LazyLoadingFallback />}>
      <LazyComponent {...props} />
    </Suspense>
  )) as T
}
