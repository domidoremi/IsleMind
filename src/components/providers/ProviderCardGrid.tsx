import { Fragment, type ReactNode } from 'react'
import { View } from 'react-native'

import type { ThemeId } from '@/types/settingsContracts'

export const PROVIDER_CARD_GRID_MAX_WIDTH = 1024
export const PROVIDER_CARD_GRID_MIN_CARD_WIDTH = 142
export const PROVIDER_CARD_GRID_MAX_COLUMNS = 6
export const PROVIDER_CARD_GRID_GAP = 12
export const PROVIDER_CARD_DETAIL_MAX_WIDTH = 860

export interface ProviderCardGridItem {
  id: string
  card: ReactNode
  detail?: ReactNode
  featured?: boolean
}

export interface ProviderCardGridLayout {
  columnCount: number
  columnWidth: number
  contentWidth: number
}

export interface ProviderCardGridRow {
  id: string
  items: readonly ProviderCardGridItem[]
}

export function resolveProviderCardGridLayout(viewportWidth: number, horizontalPadding: number): ProviderCardGridLayout {
  const safeViewportWidth = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0
  const safeHorizontalPadding = Number.isFinite(horizontalPadding) ? Math.max(0, horizontalPadding) : 0
  const contentWidth = Math.min(
    PROVIDER_CARD_GRID_MAX_WIDTH,
    Math.max(0, safeViewportWidth - safeHorizontalPadding * 2),
  )
  const fittedColumns = Math.floor((contentWidth + PROVIDER_CARD_GRID_GAP) / (PROVIDER_CARD_GRID_MIN_CARD_WIDTH + PROVIDER_CARD_GRID_GAP))
  const columnCount = Math.max(1, Math.min(PROVIDER_CARD_GRID_MAX_COLUMNS, fittedColumns))

  return {
    columnCount,
    columnWidth: Math.max(0, (contentWidth - PROVIDER_CARD_GRID_GAP * (columnCount - 1)) / columnCount),
    contentWidth,
  }
}

export function buildProviderCardGridRows(
  items: readonly ProviderCardGridItem[],
  columnCount: number,
): ProviderCardGridRow[] {
  const safeColumnCount = Number.isFinite(columnCount) ? Math.max(1, Math.floor(columnCount)) : 1
  const rows: ProviderCardGridRow[] = []
  for (let index = 0; index < items.length; index += safeColumnCount) {
    const rowItems = items.slice(index, index + safeColumnCount)
    rows.push({ id: `${index}:${rowItems[0]?.id ?? 'empty'}`, items: rowItems })
  }
  return rows
}

export function providerCardDetailNativeId(providerId: string): string {
  return `provider-card-detail-${encodeURIComponent(providerId)}`
}

export function ProviderCardGrid({
  viewportWidth,
  horizontalPadding,
  items,
  experience = 'lime-road',
  featuredFallback = true,
}: {
  viewportWidth: number
  horizontalPadding: number
  items: readonly ProviderCardGridItem[]
  experience?: ThemeId
  featuredFallback?: boolean
}) {
  if (experience !== 'lime-road') {
    const markdown = experience === 'markdown'
    return (
      <View
        accessibilityRole="list"
        testID={`provider-card-grid-${experience}`}
        style={{
          width: '100%',
          maxWidth: markdown ? 920 : PROVIDER_CARD_DETAIL_MAX_WIDTH,
          alignSelf: 'center',
        }}
      >
        {items.map((item) => (
          <Fragment key={item.id}>
            <View
              role="listitem"
              testID={`provider-card-${item.id}`}
              style={{
                width: '100%',
                minWidth: 0,
                minHeight: markdown ? 66 : 74,
                overflow: 'hidden',
              }}
            >
              {item.card}
            </View>
            {item.detail ? (
              <View
                nativeID={providerCardDetailNativeId(item.id)}
                testID={`provider-card-detail-${item.id}`}
                style={{
                  width: '100%',
                  maxWidth: PROVIDER_CARD_DETAIL_MAX_WIDTH,
                  alignSelf: 'center',
                  minWidth: 0,
                  paddingVertical: 8,
                }}
              >
                {item.detail}
              </View>
            ) : null}
          </Fragment>
        ))}
      </View>
    )
  }

  const layout = resolveProviderCardGridLayout(viewportWidth, horizontalPadding)
  const featuredItem = items.find((item) => item.featured) ?? (featuredFallback ? items[0] : undefined)
  const secondaryItems = featuredItem ? items.filter((item) => item.id !== featuredItem.id) : items
  const rows = buildProviderCardGridRows(secondaryItems, layout.columnCount)

  return (
    <View
      accessibilityRole="list"
      testID="provider-card-grid"
      style={{
        width: layout.contentWidth,
        maxWidth: PROVIDER_CARD_GRID_MAX_WIDTH,
        alignSelf: 'center',
        gap: PROVIDER_CARD_GRID_GAP,
      }}
    >
      {featuredItem ? (
        <View
          role="listitem"
          testID={`provider-card-${featuredItem.id}`}
          style={{
            width: layout.contentWidth,
            minWidth: 0,
            minHeight: layout.contentWidth < 360 ? 132 : 148,
            maxHeight: 176,
            overflow: 'hidden',
          }}
        >
          {featuredItem.card}
        </View>
      ) : null}
      {rows.map((row, rowIndex) => {
        const detailItem = row.items.find((item) => item.detail != null)
        return (
          <Fragment key={row.id}>
            <View
              accessible={false}
              testID={`provider-card-row-${rowIndex}`}
              style={{
                width: layout.contentWidth,
                flexDirection: 'row',
                alignItems: 'stretch',
                gap: PROVIDER_CARD_GRID_GAP,
              }}
            >
              {row.items.map((item) => (
                <View
                  key={item.id}
                  role="listitem"
                  testID={`provider-card-${item.id}`}
                  style={{
                    width: layout.columnWidth,
                    minWidth: layout.columnWidth,
                    maxWidth: layout.columnWidth,
                    minHeight: PROVIDER_CARD_GRID_MIN_CARD_WIDTH,
                    aspectRatio: 1,
                    overflow: 'hidden',
                  }}
                >
                  {item.card}
                </View>
              ))}
            </View>
            {detailItem ? (
              <View
                nativeID={providerCardDetailNativeId(detailItem.id)}
                testID={`provider-card-detail-${detailItem.id}`}
                style={{
                  width: '100%',
                  maxWidth: PROVIDER_CARD_DETAIL_MAX_WIDTH,
                  alignSelf: 'center',
                  minWidth: 0,
                }}
              >
                {detailItem.detail}
              </View>
            ) : null}
          </Fragment>
        )
      })}
    </View>
  )
}
