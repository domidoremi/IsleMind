import { useCallback, useMemo, useRef } from 'react'

export interface ChatOptionsDraftCommits {
  register: (commit: () => void) => () => void
  commit: () => void
}

export function useChatOptionsDraftCommits(): ChatOptionsDraftCommits {
  const pending = useRef(new Set<() => void>())
  const register = useCallback((commit: () => void) => {
    pending.current.add(commit)
    return () => { pending.current.delete(commit) }
  }, [])
  const commit = useCallback(() => {
    for (const save of [...pending.current]) save()
  }, [])
  return useMemo(() => ({ register, commit }), [register, commit])
}
