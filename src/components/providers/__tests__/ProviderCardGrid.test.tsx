import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Text, View } from 'react-native'
import { render, within } from '@testing-library/react-native'
import { IslePressable } from '@/components/ui/isle/Pressable'
import {
  ProviderCardGrid,
  PROVIDER_CARD_GRID_MIN_CARD_WIDTH,
  buildProviderCardGridRows,
  providerCardDetailNativeId,
  resolveProviderCardGridLayout,
  type ProviderCardGridItem,
} from '../ProviderCardGrid'

const PROVIDER_IDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo'] as const

function createItems(expandedId: string | null = null): ProviderCardGridItem[] {
  return PROVIDER_IDS.map((id) => ({
    id,
    card: (
      <IslePressable
        accessibilityRole="button"
        accessibilityState={{ expanded: expandedId === id }}
        testID={`provider-toggle-${id}`}
      >
        <Text numberOfLines={1} ellipsizeMode="tail" testID={`provider-label-${id}`}>
          {`${id} ${'provider-with-a-long-operational-name-'.repeat(8)}`}
        </Text>
      </IslePressable>
    ),
    detail: expandedId === id ? (
      <View testID={`provider-detail-content-${id}`}>
        <IslePressable accessibilityRole="button" testID={`provider-detail-action-${id}`}>
          <Text>Detail action</Text>
        </IslePressable>
      </View>
    ) : undefined,
  }))
}

describe('ProviderCardGrid', () => {
  it.each([
    { width: 320, padding: 12, columns: 2, contentWidth: 296 },
    { width: 768, padding: 16, columns: 4, contentWidth: 736 },
    { width: 1280, padding: 16, columns: 6, contentWidth: 1024 },
  ])('renders a stable featured card and $columns-column secondary cards at $width px', async ({ width, padding, columns, contentWidth }) => {
    const layout = resolveProviderCardGridLayout(width, padding)
    expect(layout.columnCount).toBe(columns)
    expect(layout.contentWidth).toBe(contentWidth)

    const view = await render(
      <ProviderCardGrid viewportWidth={width} horizontalPadding={padding} items={createItems()} />,
    )
    const cells = PROVIDER_IDS.map((id) => view.getByTestId(`provider-card-${id}`))
    const firstCellStyle = cells[0].props.style
    const lastCellStyle = cells[cells.length - 1].props.style

    expect(firstCellStyle.aspectRatio).toBeUndefined()
    expect(firstCellStyle.width).toBe(contentWidth)
    expect(firstCellStyle.minHeight).toBe(contentWidth < 360 ? 132 : 148)
    expect(firstCellStyle.maxHeight).toBe(176)
    expect(lastCellStyle.aspectRatio).toBe(1)
    expect(lastCellStyle.minHeight).toBe(PROVIDER_CARD_GRID_MIN_CARD_WIDTH)
    expect(lastCellStyle.width).toBeCloseTo(layout.columnWidth)
    expect(view.getByTestId('provider-card-grid').props.accessibilityRole).toBe('list')
    expect(cells.map((cell) => cell.props.role)).toEqual(PROVIDER_IDS.map(() => 'listitem'))
    expect(view.getAllByTestId(/^provider-card-row-/)).toHaveLength(Math.ceil((PROVIDER_IDS.length - 1) / columns))
  })

  it('keeps row-major card and focus order while placing detail after its card row', async () => {
    const items = createItems('bravo')
    expect(buildProviderCardGridRows(items, 2).map((row) => row.items.map((item) => item.id))).toEqual([
      ['alpha', 'bravo'],
      ['charlie', 'delta'],
      ['echo'],
    ])

    const view = await render(
      <ProviderCardGrid viewportWidth={768} horizontalPadding={16} items={items} />,
    )
    const focusOrder = view.getAllByRole('button').map((node) => node.props.testID)
    expect(focusOrder).toEqual([
      'provider-toggle-alpha',
      'provider-toggle-bravo',
      'provider-toggle-charlie',
      'provider-toggle-delta',
      'provider-toggle-echo',
      'provider-detail-action-bravo',
    ])
    expect(focusOrder.filter((id) => id.startsWith('provider-toggle-'))).toEqual(
      PROVIDER_IDS.map((id) => `provider-toggle-${id}`),
    )

    const detailRow = view.getByTestId('provider-card-detail-bravo')
    expect(detailRow.props.nativeID).toBe(providerCardDetailNativeId('bravo'))
    expect(within(view.getByTestId('provider-card-bravo')).queryByTestId('provider-detail-content-bravo')).toBeNull()
    expect(within(detailRow).getByTestId('provider-detail-content-bravo')).toBeTruthy()
  })

  it('bounds long labels and exposes deterministic expanded states', async () => {
    const view = await render(
      <ProviderCardGrid viewportWidth={320} horizontalPadding={12} items={createItems('alpha')} />,
    )

    expect(view.getByTestId('provider-label-alpha').props.numberOfLines).toBe(1)
    expect(view.getByTestId('provider-label-alpha').props.ellipsizeMode).toBe('tail')
    expect(view.getByTestId('provider-toggle-alpha').props.accessibilityState).toEqual({ expanded: true })
    expect(view.getByTestId('provider-toggle-bravo').props.accessibilityState).toEqual({ expanded: false })
  })

  it('keeps the production connection row accessibility and out-of-row detail contracts', () => {
    const source = readFileSync(join(__dirname, '..', 'ProviderSettingsContent.tsx'), 'utf8')
    const connectionRowSource = readFileSync(join(__dirname, '..', 'ProviderConnectionRow.tsx'), 'utf8')
    const rowStart = source.indexOf('function ProviderListRow(')
    const detailStart = source.indexOf('function DeferredProviderDetails(')
    expect(rowStart).toBeGreaterThanOrEqual(0)
    expect(detailStart).toBeGreaterThan(rowStart)
    const rowSource = source.slice(rowStart, detailStart)

    expect(connectionRowSource).toContain('accessibilityRole="checkbox"')
    expect(connectionRowSource).toContain('accessibilityState={{ checked: props.selected }}')
    expect(connectionRowSource).toContain('accessibilityState={{ expanded: props.expanded }}')
    expect(connectionRowSource).toContain('testID={`provider-edit-${props.id}`}')
    expect(source).toContain("t('providerSettings.deleteSelected')")
    expect(source).toContain('confirmRemoveSupplierGroup(group)')
    // The extracted row may truncate visible labels, but its full identity and
    // independent selection, opening and editing actions must stay connected.
    for (const contract of [
      '<ProviderConnectionRow id={provider.id}',
      'name={providerDisplayName}',
      'endpoint={providerUrl}',
      'stateLabel={providerStateLabel}',
      'enabled={provider.enabled} featured={featured} selected={selected} batchMode={batchMode} expanded={expanded}',
      'onToggleSelected={onToggleSelected}',
      'onOpen={() => onExpandedChange(!expanded)}',
      'onEdit={onEdit}',
    ]) {
      expect(rowSource).toContain(contract)
    }
    for (const contract of [
      "accessibilityLabel={[props.name, props.stateLabel, props.modelsLabel, props.endpoint].join('. ')}",
      'accessibilityLabel={props.selectLabel}',
      'accessibilityLabel={props.editLabel}',
      'onPress={props.onToggleSelected}',
      'onPress={props.onOpen}',
      'onPress={props.onEdit}',
    ]) {
      expect(connectionRowSource).toContain(contract)
    }
    expect(rowSource).not.toContain('count: provider.models.length')
    expect(rowSource).toContain("modelsLabel={t('settingsSubsystem.modelCount', { count: modelInventory.selectableModels })}")
    expect(rowSource).toContain("selectLabel={`${t('providerSettings.selectProvider')} ${providerDisplayName}`}")
    expect(rowSource).toContain("editLabel={`${t('common.edit')} ${providerDisplayName}`}")
    expect(rowSource).toContain('useMemo(() => summarizeProviderModelInventory(provider), [provider])')
    expect(rowSource).toContain("provider.baseUrl?.trim() || t('providerSettings.baseUrl')")
    expect(rowSource).not.toContain('getProviderSelectableModels(provider).length')
    expect(rowSource).not.toContain('<DeferredProviderDetails')
  })

  it('gives the detail sheet a real glass material and keeps help in its header', () => {
    const source = readFileSync(join(__dirname, '..', 'ProviderSettingsContent.tsx'), 'utf8')
    const sheet = source.slice(source.indexOf('function ProviderConfigurationSheet('), source.indexOf('function ProviderListRow('))
    expect(sheet).toContain('<GlassSurface')
    expect(sheet).toContain('enabled={Boolean(colors.ui.liquidGlass)} variant="floating"')
    expect(sheet.indexOf('<SettingsHelpButton compact topic="models"')).toBeLessThan(sheet.indexOf('<ScrollView'))
    expect(sheet).toContain('sortControl={sortControl}')
    expect(sheet).toContain('await leave(onClose)')
    expect(sheet).toContain("animationType={motion === 'full' ? 'slide' : 'none'}")
  })
})
