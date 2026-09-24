import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Platform } from 'react-native'
import { useNavigation } from 'expo-router'
import { usePreventRemove } from 'expo-router/react-navigation'
import { useTranslation } from 'react-i18next'
import { useIsleDialog } from '@/components/ui/isle'

type Editor = { dirty: boolean; busy: boolean; discard: () => void }
const EditorContext = createContext<{ register: (id: string, editor: Editor) => () => void; leave: (action: () => void) => Promise<void> } | null>(null)

export function SettingsEditBoundary({ children }: { children: ReactNode }) {
  const editors = useRef(new Map<string, Editor>())
  const [blocked, setBlocked] = useState(false)
  const confirming = useRef(false)
  const navigation = useNavigation()
  const dialog = useIsleDialog()
  const { t } = useTranslation()
  const register = useCallback((id: string, editor: Editor) => {
    editors.current.set(id, editor)
    const update = () => setBlocked([...editors.current.values()].some(item => item.dirty || item.busy))
    update()
    return () => { editors.current.delete(id); update() }
  }, [])
  const leave = useCallback(async (action: () => void) => {
    if (confirming.current || [...editors.current.values()].some(item => item.busy)) return
    const dirty = [...editors.current.values()].filter(item => item.dirty)
    if (!dirty.length) { action(); return }
    confirming.current = true
    try {
      const discard = await dialog.confirm({ title: t('settingsWorkspace.discardTitle'), message: t('settingsWorkspace.discardMessage'), confirmLabel: t('settingsWorkspace.discard'), cancelLabel: t('settingsWorkspace.keepEditing'), tone: 'danger' })
      const current = [...editors.current.values()]
      if (discard && !current.some(item => item.busy)) { current.filter(item => item.dirty).forEach(item => { item.discard(); item.dirty = false }); setBlocked(false); action() }
    } finally { confirming.current = false }
  }, [dialog, t])
  usePreventRemove(blocked, ({ data }) => { void leave(() => navigation.dispatch(data.action)) })
  useEffect(() => {
    if (!blocked || Platform.OS !== 'web') return
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [blocked])
  return <EditorContext.Provider value={{ register, leave }}>{children}</EditorContext.Provider>
}

export function useSettingsDraft(dirty: boolean, busy: boolean, discard: () => void) {
  const context = useContext(EditorContext)
  const id = useId()
  const latest = useRef(discard)
  latest.current = discard
  const busyRef = useRef(busy)
  busyRef.current = busy
  const dialog = useIsleDialog()
  const { t } = useTranslation()
  const pending = useRef(false)
  useEffect(() => context?.register(id, { dirty, busy, discard: () => latest.current() }), [context?.register, id, dirty, busy])
  return async (action: () => void) => {
    if (busy || pending.current) return
    pending.current = true
    try {
      const approved = !dirty || await dialog.confirm({ title: t('settingsWorkspace.discardTitle'), message: t('settingsWorkspace.discardMessage'), confirmLabel: t('settingsWorkspace.discard'), cancelLabel: t('settingsWorkspace.keepEditing'), tone: 'danger' })
      if (approved && !busyRef.current) {
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
