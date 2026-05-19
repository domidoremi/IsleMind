import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react'

interface MainPagerGestureLockContextValue {
  locked: boolean
  setLocked: (locked: boolean) => void
}

const MainPagerGestureLockContext = createContext<MainPagerGestureLockContextValue | null>(null)

export function MainPagerGestureLockProvider({ children }: PropsWithChildren) {
  const [locked, setLockedState] = useState(false)
  const setLocked = useCallback((next: boolean) => {
    setLockedState(next)
  }, [])
  const value = useMemo(() => ({ locked, setLocked }), [locked, setLocked])

  return (
    <MainPagerGestureLockContext.Provider value={value}>
      {children}
    </MainPagerGestureLockContext.Provider>
  )
}

export function useMainPagerGestureLock() {
  return useContext(MainPagerGestureLockContext)
}
