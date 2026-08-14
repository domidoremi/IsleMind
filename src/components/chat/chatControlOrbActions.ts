import type { Dispatch, SetStateAction } from 'react'
import type { TFunction } from 'i18next'

import { type ComposerPanel } from './FloatingComposer'
import { type FloatingControlOrbAction } from './FloatingControlOrb'

type SetComposerPanel = Dispatch<SetStateAction<ComposerPanel>>
type SetBoolean = Dispatch<SetStateAction<boolean>>

export function buildSetupControlOrbActions({
  goHistory,
  goMemoryReview,
  goProviders,
  goSettings,
  openSetupAiConfiguration,
  setComposerPanel,
  setControlOrbOpen,
  t,
}: {
  goHistory: () => void
  goMemoryReview: () => void
  goProviders: () => void
  goSettings: () => void
  openSetupAiConfiguration: () => void
  setComposerPanel: SetComposerPanel
  setControlOrbOpen: SetBoolean
  t: TFunction
}): FloatingControlOrbAction[] {
  return [
    {
      key: 'history',
      label: t('conversation.viewHistory'),
      icon: 'history',
      onPress: () => {
        setControlOrbOpen(false)
        setComposerPanel(null)
        goHistory()
      },
    },
    {
      key: 'model',
      label: t('chat.quickModel'),
      icon: 'provider-key',
      onPress: () => {
        setControlOrbOpen(false)
        openSetupAiConfiguration()
      },
    },
    {
      key: 'tools',
      label: t('chat.quickTools'),
      icon: 'tools',
      onPress: () => {
        setControlOrbOpen(false)
        setComposerPanel((current) => current === 'more' ? null : 'more')
      },
    },
    {
      key: 'memory',
      label: t('chat.memory'),
      icon: 'memory-brain',
      onPress: () => {
        setControlOrbOpen(false)
        goMemoryReview()
      },
    },
    {
      key: 'providers',
      label: t('chat.configureProviders'),
      icon: 'key',
      onPress: () => {
        setControlOrbOpen(false)
        setComposerPanel(null)
        goProviders()
      },
    },
    {
      key: 'settings',
      label: t('settings.title'),
      icon: 'settings',
      onPress: () => {
        setControlOrbOpen(false)
        goSettings()
      },
    },
  ]
}

export function buildActiveControlOrbActions({
  goHistory,
  goMemoryReview,
  goProviders,
  goSettings,
  markChromeActive,
  openWorkspaceReview,
  setComposerPanel,
  setControlOrbOpen,
  setShowOptions,
  t,
}: {
  goHistory: () => void
  goMemoryReview: () => void
  goProviders: () => void
  goSettings: () => void
  markChromeActive: () => void
  openWorkspaceReview: () => void
  setComposerPanel: SetComposerPanel
  setControlOrbOpen: SetBoolean
  setShowOptions: SetBoolean
  t: TFunction
}): FloatingControlOrbAction[] {
  return [
    {
      key: 'history',
      label: t('conversation.viewHistory'),
      icon: 'history',
      onPress: () => {
        setControlOrbOpen(false)
        setComposerPanel(null)
        setShowOptions(false)
        goHistory()
      },
    },
    {
      key: 'model',
      label: t('chat.quickModel'),
      icon: 'provider-key',
      onPress: () => {
        setControlOrbOpen(false)
        markChromeActive()
        setComposerPanel(null)
        setShowOptions(true)
      },
    },
    {
      key: 'session-options',
      label: t('chat.modelAndConversationOptions'),
      icon: 'preferences-sliders',
      onPress: () => {
        setControlOrbOpen(false)
        setComposerPanel(null)
        markChromeActive()
        setShowOptions(true)
      },
    },
    {
      key: 'tools',
      label: t('chat.quickTools'),
      icon: 'tools',
      onPress: () => {
        setControlOrbOpen(false)
        setShowOptions(false)
        setComposerPanel((current) => current === 'more' ? null : 'more')
      },
    },
    {
      key: 'workspace-review',
      label: t('chat.workspaceReviewToolbox'),
      icon: 'list-check',
      onPress: () => {
        setControlOrbOpen(false)
        setComposerPanel(null)
        setShowOptions(false)
        openWorkspaceReview()
      },
    },
    {
      key: 'memory',
      label: t('chat.memory'),
      icon: 'memory-brain',
      onPress: () => {
        setControlOrbOpen(false)
        setComposerPanel(null)
        goMemoryReview()
      },
    },
    {
      key: 'providers',
      label: t('chat.configureProviders'),
      icon: 'key',
      onPress: () => {
        setControlOrbOpen(false)
        setComposerPanel(null)
        goProviders()
      },
    },
    {
      key: 'settings',
      label: t('settings.title'),
      icon: 'settings',
      onPress: () => {
        setControlOrbOpen(false)
        setComposerPanel(null)
        goSettings()
      },
    },
  ]
}
