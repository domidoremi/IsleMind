import type { ReactNode } from 'react'
import { StyleSheet, Text, View, type ViewStyle } from 'react-native'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/ui/AppIcon'
import { IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import type { McpServerConfig } from '@/types/mcpContracts'

export interface McpSettingsExperienceProps {
  managementOpen: boolean
  managementTrigger: ReactNode
  management: ReactNode
  servers: McpServerConfig[]
  pendingServerId: string | null
  emptyState?: ReactNode
  compact: boolean
  onToggle: (server: McpServerConfig) => void
  onOpenDetails: (serverId: string) => void
}

export function MinimalMcpSettingsExperience(props: McpSettingsExperienceProps) {
  const { colors } = useAppTheme()
  return (
    <View testID="mcp-settings-experience-minimal" style={{ gap: 10 }}>
      <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.semantic.chrome.border }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '800' }}>MCP</Text>
          <Text style={{ color: colors.textTertiary, fontSize: 10.5, lineHeight: 14, fontWeight: '500' }}>{`${props.servers.length} endpoints`}</Text>
        </View>
        {props.managementTrigger}
      </View>
      {props.managementOpen ? props.management : (
        <MinimalMcpCatalog {...props} />
      )}
    </View>
  )
}

export function LimeRoadMcpSettingsExperience(props: McpSettingsExperienceProps) {
  const { colors } = useAppTheme()
  return (
    <View testID="mcp-settings-experience-lime-road">
      <View style={{ minHeight: 52, paddingHorizontal: 2, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: colors.material.stroke }}>
          <View style={{ width: 30, height: 30, borderRadius: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ui.control.primaryBackground, borderWidth: 1, borderColor: colors.ui.control.primaryBorder }}>
            <AppIcon name="mcp-network" color={colors.ui.control.primaryForeground} size={15} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: colors.text, fontSize: 13, lineHeight: 17, fontWeight: '900' }}>MCP</Text>
            <Text numberOfLines={1} style={{ marginTop: 1, color: colors.textTertiary, fontSize: 10, lineHeight: 13, fontWeight: '700' }}>{`${props.servers.length} endpoints`}</Text>
          </View>
          {props.managementTrigger}
      </View>
      <View style={{ marginTop: 10 }}>
        {props.managementOpen ? props.management : <LimeRoadMcpCatalog {...props} />}
      </View>
    </View>
  )
}

export function MarkdownMcpSettingsExperience(props: McpSettingsExperienceProps) {
  const { colors } = useAppTheme()
  return (
    <View testID="mcp-settings-experience-markdown">
      <View style={{ minHeight: 46, paddingHorizontal: 2, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.section.divider }}>
        <AppIcon name="mcp-network" color={colors.ui.control.link} size={15} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: colors.text, fontSize: 12.5, lineHeight: 16, fontWeight: '800' }}>MCP</Text>
          <Text style={{ color: colors.textTertiary, fontSize: 9.5, lineHeight: 13, fontWeight: '600' }}>{`${props.servers.length} endpoints`}</Text>
        </View>
        {props.managementTrigger}
      </View>
      {props.managementOpen ? (
        <View style={{ paddingTop: 10 }}>{props.management}</View>
      ) : (
        <MarkdownMcpCatalog {...props} />
      )}
    </View>
  )
}

type CanonicalMcpFamily = 'monet' | 'material' | 'liquid-glass'

function CanonicalMcpExperience({ family, props }: { family: CanonicalMcpFamily; props: McpSettingsExperienceProps }) {
  const { colors, design } = useAppTheme()
  const { t } = useTranslation()
  const headerIcon = family === 'material' ? 'settings' : family === 'liquid-glass' ? 'spark' : 'mcp-network'
  const catalogLayout = family === 'material' ? 'list' : 'grid'
  const panelBackground = family === 'material' ? colors.ui.semantic.surface.muted : colors.ui.semantic.chrome.background
  const panelBorder = family === 'material' ? colors.ui.semantic.chrome.border : colors.ui.semantic.chrome.border
  const panelRadius = family === 'material' ? design.semantic.radius.extraLarge : design.semantic.radius.extraLarge
  return (
    <View testID={`mcp-settings-experience-${family}`} style={{ gap: design.semantic.spacing.md }}>
      <View style={{ minHeight: family === 'material' ? 64 : 58, paddingHorizontal: family === 'liquid-glass' ? 12 : 4, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: family === 'liquid-glass' ? design.semantic.radius.extraLarge : 0, backgroundColor: family === 'liquid-glass' ? panelBackground : 'transparent', borderBottomWidth: family === 'liquid-glass' ? 1 : StyleSheet.hairlineWidth, borderBottomColor: colors.ui.semantic.chrome.border, borderWidth: family === 'liquid-glass' ? 1 : 0 }}>
        <View style={{ width: 34, height: 34, borderRadius: family === 'material' ? design.semantic.radius.medium : design.semantic.radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ui.icon.accentBackground, borderWidth: family === 'material' ? 0 : 1, borderColor: colors.ui.semantic.chrome.border }}>
          <AppIcon name={headerIcon} color={colors.ui.icon.accentForeground} size={16} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: colors.text, fontSize: design.semantic.typography.title.fontSize, lineHeight: design.semantic.typography.title.lineHeight, fontWeight: design.semantic.typography.title.fontWeight }}>MCP</Text>
          <Text numberOfLines={1} style={{ marginTop: 1, color: colors.textTertiary, fontSize: design.semantic.typography.caption.fontSize, lineHeight: design.semantic.typography.caption.lineHeight, fontWeight: '500' }}>{`${props.servers.length} endpoints`}</Text>
        </View>
        {props.managementTrigger}
      </View>
      {props.managementOpen ? props.management : props.servers.length ? (
        <View testID={`mcp-server-catalog-${family}`} accessibilityRole="list" style={{ flexDirection: catalogLayout === 'grid' ? 'row' : 'column', flexWrap: catalogLayout === 'grid' ? 'wrap' : 'nowrap', gap: design.semantic.spacing.sm }}>
          {props.servers.map((server, index) => {
            const pending = props.pendingServerId === server.id
            const enabled = server.enabled
            const cardBackground = enabled ? design.semantic.color.primaryContainer : panelBackground
            const cardForeground = enabled ? design.semantic.color.onPrimaryContainer : colors.text
            const cardStyle = family === 'liquid-glass'
              ? { flexGrow: 1, flexBasis: props.compact ? '100%' : '47%', minHeight: 104, padding: 14, borderRadius: design.semantic.radius.extraLarge, backgroundColor: cardBackground, borderWidth: 1, borderColor: colors.ui.semantic.chrome.border, shadowColor: design.semantic.elevation.shadowColor, shadowOpacity: design.semantic.elevation.shadowOpacity, shadowRadius: design.semantic.elevation.shadowBlur, shadowOffset: { width: 0, height: design.semantic.elevation.shadowOffsetY }, elevation: design.semantic.elevation.level2 }
              : family === 'monet'
                ? { flexGrow: 1, flexBasis: props.compact ? '100%' : '47%', minHeight: 96, padding: 13, borderRadius: design.semantic.radius.large, backgroundColor: index % 2 === 0 ? colors.ui.semantic.surface.base : colors.ui.semantic.surface.muted, borderWidth: 1, borderColor: colors.ui.semantic.chrome.border }
                : { minHeight: 64, paddingHorizontal: 14, paddingVertical: 8, borderRadius: design.semantic.radius.extraLarge, backgroundColor: enabled ? design.semantic.color.primaryContainer : colors.ui.semantic.surface.base, borderWidth: 1, borderColor: panelBorder }
            const typedCardStyle = cardStyle as ViewStyle
            return (
              <View key={server.id} style={typedCardStyle}>
                <IslePressable haptic disabled={pending} accessibilityRole="switch" accessibilityLabel={`${server.name}. ${t(enabled ? 'settings.enabledState' : 'settings.disabledState')}`} accessibilityState={{ checked: enabled, disabled: pending }} onPress={() => props.onToggle(server)} style={{ flex: 1, minHeight: 44, justifyContent: 'center', gap: 5 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: enabled ? colors.ui.tone.success.foreground : colors.ui.semantic.chrome.border }} />
                    <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: cardForeground, fontSize: design.semantic.typography.label.fontSize, lineHeight: design.semantic.typography.label.lineHeight, fontWeight: '700' }}>{server.name}</Text>
                    <AppIcon name={enabled ? 'check' : 'back-next'} color={enabled ? colors.ui.tone.success.foreground : colors.textTertiary} size={15} />
                  </View>
                  <Text numberOfLines={1} style={{ color: enabled ? design.semantic.color.onPrimaryContainer : colors.textTertiary, fontSize: design.semantic.typography.caption.fontSize, lineHeight: design.semantic.typography.caption.lineHeight, fontWeight: '500' }}>{pending ? t('mcp.refreshing') : `${t(`mcp.status.${server.status}`)} · ${server.tools.length} tools`}</Text>
                </IslePressable>
                <IslePressable haptic accessibilityRole="button" accessibilityLabel={`${server.name}. ${t('mcp.showDetails')}`} onPress={() => props.onOpenDetails(server.id)} style={{ position: 'absolute', right: family === 'material' ? 10 : 8, top: family === 'material' ? 8 : 5, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                  <AppIcon name="settings" color={enabled ? design.semantic.color.onPrimaryContainer : colors.textSecondary} size={16} />
                </IslePressable>
              </View>
            )
          })}
        </View>
      ) : <>{props.emptyState}</>}
    </View>
  )
}

export function MonetMcpSettingsExperience(props: McpSettingsExperienceProps) {
  return <CanonicalMcpExperience family="monet" props={props} />
}

export function MaterialMcpSettingsExperience(props: McpSettingsExperienceProps) {
  return <CanonicalMcpExperience family="material" props={props} />
}

export function LiquidGlassMcpSettingsExperience(props: McpSettingsExperienceProps) {
  return <CanonicalMcpExperience family="liquid-glass" props={props} />
}

function MinimalMcpCatalog({ servers, pendingServerId, emptyState, onToggle, onOpenDetails }: McpSettingsExperienceProps) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  if (!servers.length) return <>{emptyState}</>
  return (
    <View testID="mcp-server-catalog-minimal" accessibilityRole="list">
      {servers.map((server) => {
        const pending = pendingServerId === server.id
        return (
          <View key={server.id} style={{ minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.semantic.chrome.border }}>
            <IslePressable
              haptic
              disabled={pending}
              accessibilityRole="switch"
              accessibilityLabel={`${server.name}. ${t(server.enabled ? 'settings.enabledState' : 'settings.disabledState')}`}
              accessibilityState={{ checked: server.enabled, disabled: pending }}
              onPress={() => onToggle(server)}
              style={{ flex: 1, minWidth: 0, minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 10 }}
            >
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: server.enabled ? colors.ui.tone.success.foreground : colors.ui.semantic.chrome.border }} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ color: colors.text, fontSize: 12.5, lineHeight: 17, fontWeight: '700' }}>{server.name}</Text>
                <Text numberOfLines={1} style={{ marginTop: 2, color: colors.textTertiary, fontSize: 10.5, lineHeight: 14, fontWeight: '500' }}>{`${t(`mcp.status.${server.status}`)} · ${server.tools.length} tools`}</Text>
              </View>
            </IslePressable>
            <IslePressable haptic accessibilityRole="button" accessibilityLabel={`${server.name}. ${t('mcp.showDetails')}`} onPress={() => onOpenDetails(server.id)} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: colors.textSecondary, fontSize: 10.5, lineHeight: 14, fontWeight: '800' }}>{t('mcp.showDetails')}</Text>
            </IslePressable>
          </View>
        )
      })}
    </View>
  )
}

function LimeRoadMcpCatalog({ servers, pendingServerId, emptyState, compact, onToggle, onOpenDetails }: McpSettingsExperienceProps) {
  const { colors, isDark } = useAppTheme()
  const { t } = useTranslation()
  if (!servers.length) return <>{emptyState}</>
  const columns = compact ? 1 : 2
  return (
    <View testID="mcp-server-catalog-lime-road" accessibilityRole="list" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}>
      {servers.map((server) => {
        const pending = pendingServerId === server.id
        const enabledSurface = '#198754'
        const surface = server.enabled ? enabledSurface : isDark ? colors.ui.semantic.surface.base : '#FFFFFF'
        const foreground = server.enabled ? '#FFFFFF' : colors.text
        const secondary = server.enabled ? 'rgba(255,255,255,0.78)' : colors.textTertiary
        return (
          <View key={server.id} style={{ flexGrow: 1, flexBasis: columns === 1 ? '100%' : '47%', minWidth: 0, minHeight: compact ? 92 : 108, overflow: 'hidden', borderRadius: 8, backgroundColor: surface, borderWidth: 1, borderColor: server.enabled ? enabledSurface : colors.material.stroke }}>
            <IslePressable haptic disabled={pending} accessibilityRole="switch" accessibilityLabel={`${server.name}. ${t(server.enabled ? 'settings.enabledState' : 'settings.disabledState')}`} accessibilityState={{ checked: server.enabled, disabled: pending }} onPress={() => onToggle(server)} style={{ flex: 1, minHeight: compact ? 90 : 106, padding: 12, paddingRight: 48, justifyContent: 'center', gap: 5 }}>
              <Text numberOfLines={2} style={{ color: foreground, fontSize: 14, lineHeight: 19, fontWeight: '900' }}>{server.name}</Text>
              <Text numberOfLines={1} style={{ color: secondary, fontSize: 10.5, lineHeight: 14, fontWeight: '800' }}>{pending ? t('mcp.refreshing') : `${t(`mcp.status.${server.status}`)} · ${server.tools.length}/${server.resources.length}/${server.prompts.length}`}</Text>
            </IslePressable>
            <IslePressable haptic accessibilityRole="button" accessibilityLabel={`${server.name}. ${t('mcp.showDetails')}`} onPress={() => onOpenDetails(server.id)} style={{ position: 'absolute', top: 4, right: 4, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <AppIcon name="settings" color={foreground} size={17} />
            </IslePressable>
          </View>
        )
      })}
    </View>
  )
}

function MarkdownMcpCatalog({ servers, pendingServerId, emptyState, compact, onToggle, onOpenDetails }: McpSettingsExperienceProps) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  if (!servers.length) return <View style={{ paddingTop: 10 }}>{emptyState}</View>
  return (
    <View testID="mcp-server-catalog-markdown" accessibilityRole="list" style={{ borderWidth: StyleSheet.hairlineWidth, borderTopWidth: 0, borderColor: colors.ui.section.divider, borderBottomLeftRadius: 6, borderBottomRightRadius: 6, overflow: 'hidden' }}>
      {servers.map((server, index) => {
        const pending = pendingServerId === server.id
        return (
          <View key={server.id} style={{ minHeight: 63, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: index % 2 ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.base, borderBottomWidth: index === servers.length - 1 ? 0 : StyleSheet.hairlineWidth, borderBottomColor: colors.ui.section.divider }}>
            <IslePressable haptic disabled={pending} accessibilityRole="switch" accessibilityLabel={`${server.name}. ${t(server.enabled ? 'settings.enabledState' : 'settings.disabledState')}`} accessibilityState={{ checked: server.enabled, disabled: pending }} onPress={() => onToggle(server)} style={{ flex: 1, minWidth: 0, minHeight: 61, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <AppIcon name={server.enabled ? 'check' : 'mcp-network'} color={server.enabled ? colors.ui.tone.success.foreground : colors.textTertiary} size={15} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ color: colors.text, fontSize: 11.5, lineHeight: 16, fontWeight: '800' }}>{server.name}</Text>
                <Text numberOfLines={1} style={{ marginTop: 2, color: colors.textTertiary, fontSize: 10, lineHeight: 13, fontWeight: '500' }}>{compact ? t(`mcp.status.${server.status}`) : `${t(`mcp.status.${server.status}`)} · ${server.tools.length} tools`}</Text>
              </View>
            </IslePressable>
            <IslePressable haptic accessibilityRole="button" accessibilityLabel={`${server.name}. ${t('mcp.showDetails')}`} onPress={() => onOpenDetails(server.id)} style={{ minWidth: 52, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' }}>
              <AppIcon name="settings" color={colors.textSecondary} size={16} />
            </IslePressable>
          </View>
        )
      })}
    </View>
  )
}
