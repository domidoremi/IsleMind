import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Platform } from 'react-native'
import { useNavigation } from 'expo-router'
import { usePreventRemove } from 'expo-router/react-navigation'
import { useTranslation } from 'react-i18next'
import { useIsleDialog } from '@/components/ui/isle'
import { useAppUpdateBlocker } from '@/hooks/useAppUpdateBlocker'

type Editor = { dirty: boolean; busy: boolean; revision: () => object; discard: () => void }
const EditorContext = createContext<{ register: (id: string, editor: Editor) => () => void; leave: (action: () => void) => Promise<void> } | null>(null)

export function useSettingsLifetime() {
  const lifetime = useRef<AbortController | undefined>(undefined)
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    return () => controller.abort()
  }, [])
  return lifetime
}

/** Browser history can reset the Expo root without calling a screen's removal guard. */
export function useSettingsBrowserLeave(blocked: boolean, leave: (action: () => void) => Promise<void>) {
  useAppUpdateBlocker(blocked, 'settings-edit')
  const latest = useRef(leave)
  latest.current = leave
  useEffect(() => {
    if (!blocked || Platform.OS !== 'web') return
    const navigation = window.navigation
    let approvedKey: string | undefined
    let confirming = false
    let active = true
    const preventUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const preventTraversal = (event: NavigateEvent) => {
      if (event.navigationType !== 'traverse' || !event.destination.sameDocument || !event.cancelable) return
      if (approvedKey === event.destination.key) { approvedKey = undefined; return }
      event.preventDefault()
      if (confirming) return
      confirming = true
      void latest.current(() => {
        if (!active) return
        approvedKey = event.destination.key
        // Replay the exact entry only after approval; do not push dummy history entries.
        void navigation?.traverseTo(approvedKey).finished?.catch(() => undefined)
      }).then(() => { confirming = false }, () => { confirming = false })
    }
    window.addEventListener('beforeunload', preventUnload)
    navigation?.addEventListener('navigate', preventTraversal)
    return () => {
      active = false
      window.removeEventListener('beforeunload', preventUnload)
      navigation?.removeEventListener('navigate', preventTraversal)
    }
  }, [blocked])
}

export function SettingsEditBoundary({ children }: { children: ReactNode }) {
  const editors = useRef(new Map<string, Editor>())
  const [blocked, setBlocked] = useState(false)
  const confirming = useRef(false)
  const lifetime = useSettingsLifetime()
  const navigation = useNavigation()
  const dialog = useIsleDialog()
  const { t } = useTranslation()
  const register = useCallback((id: string, editor: Editor) => {
    editors.current.set(id, editor)
    const update = () => { if (!lifetime.current?.signal.aborted) setBlocked([...editors.current.values()].some(item => item.dirty || item.busy)) }
    update()
    return () => { editors.current.delete(id); update() }
  }, [])
  const leave = useCallback(async (action: () => void) => {
    const signal = lifetime.current?.signal
    if (signal?.aborted || confirming.current || [...editors.current.values()].some(item => item.busy)) return
    const dirty = [...editors.current.values()].filter(item => item.dirty)
    if (!dirty.length) { action(); return }
    const reviewed = [...editors.current].map(([id, editor]) => ({ id, revision: editor.revision() }))
    confirming.current = true
    try {
      const discard = await dialog.confirm({ title: t('settingsWorkspace.discardTitle'), message: t('settingsWorkspace.discardMessage'), confirmLabel: t('settingsWorkspace.discard'), cancelLabel: t('settingsWorkspace.keepEditing'), tone: 'danger', signal }).catch(() => false)
      const current = [...editors.current.values()]
      const unchanged = reviewed.length === editors.current.size && reviewed.every(item => editors.current.get(item.id)?.revision() === item.revision)
      if (discard && unchanged && !signal?.aborted && !current.some(item => item.busy)) { current.filter(item => item.dirty).forEach(item => { item.discard(); item.dirty = false }); setBlocked(false); action() }
    } finally { confirming.current = false }
  }, [dialog, t])
  usePreventRemove(blocked, ({ data }) => { void leave(() => navigation.dispatch(data.action)) })
  useSettingsBrowserLeave(blocked, leave)
  return <EditorContext.Provider value={{ register, leave }}>{children}</EditorContext.Provider>
}

/** Supply a stable content/identity snapshot, not a newly allocated object on every render. */
export function useSettingsDraft(dirty: boolean, busy: boolean, discard: () => void, snapshot?: unknown) {
  useAppUpdateBlocker(dirty || busy, 'settings-draft')
  const context = useContext(EditorContext)
  const id = useId()
  const latest = useRef(discard)
  latest.current = discard
  const busyRef = useRef(busy)
  busyRef.current = busy
  const revision = useRef({ dirty, busy, snapshot })
  if (revision.current.dirty !== dirty || revision.current.busy !== busy || !Object.is(revision.current.snapshot, snapshot)) {
    // A changed-and-restored draft still requires fresh consent.
    revision.current = { dirty, busy, snapshot }
  }
  const currentRevision = revision.current
  const dialog = useIsleDialog()
  const { t } = useTranslation()
  const pending = useRef(false)
  const lifetime = useSettingsLifetime()
  useEffect(() => context?.register(id, { dirty, busy, revision: () => revision.current, discard: () => latest.current() }), [context?.register, id, dirty, busy, currentRevision])
  return async (action: () => void) => {
    const signal = lifetime.current?.signal
    if (signal?.aborted || busyRef.current || pending.current) return
    const reviewed = revision.current
    pending.current = true
    try {
      const approved = !reviewed.dirty || await dialog.confirm({ title: t('settingsWorkspace.discardTitle'), message: t('settingsWorkspace.discardMessage'), confirmLabel: t('settingsWorkspace.discard'), cancelLabel: t('settingsWorkspace.keepEditing'), tone: 'danger', signal }).catch(() => false)
      if (approved && reviewed === revision.current && !signal?.aborted && !busyRef.current) {
        latest.current()
        action()
      }
    } finally { pending.current = false }
  }
}

export function useSettingsLeave() {
  const context = useContext(EditorContext)
  return context?.leave ?? (async (action: () => void) => action())
}
