/** Bounded, process-local read fencing; eviction revokes old readers rather than reopening them. */
export function createProviderDispatchReadFence(maxTrackedKeys: number, message: string) {
  if (!Number.isSafeInteger(maxTrackedKeys) || maxTrackedKeys <= 0) throw new Error('Invalid dispatch read-fence bound')
  const revisions = new Map<string, object>()
  // Pending entries live only as long as the admitted writes, including overlapping writes.
  const changing = new Map<string, number>()

  function revise(key: string) {
    const token = {}
    revisions.delete(key)
    revisions.set(key, token)
    while (revisions.size > maxTrackedKeys) revisions.delete(revisions.keys().next().value!)
    return token
  }

  function capture(key: string): () => void {
    const token = revisions.get(key) ?? revise(key)
    const capturedDuringChange = changing.has(key)
    return () => {
      if (capturedDuringChange || changing.has(key) || revisions.get(key) !== token) throw new Error(message)
    }
  }

  async function observe<Value>(keys: readonly string[], write: () => Promise<Value>): Promise<Value> {
    const captured = [...new Set(keys)]
    for (const key of captured) {
      revise(key)
      changing.set(key, (changing.get(key) ?? 0) + 1)
    }
    try { return await write() }
    finally {
      for (const key of captured) {
        const count = (changing.get(key) ?? 1) - 1
        if (count) changing.set(key, count); else changing.delete(key)
      }
    }
  }

  return { capture, observe }
}
