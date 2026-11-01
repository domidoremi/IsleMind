import { useCallback, useEffect, useRef, useState } from 'react'
import { AccessibilityInfo } from 'react-native'
import { resolveAppFeedbackTimeout } from '@/components/ui/appFeedbackTimeout'

export type ActionFeedbackPhase = 'idle' | 'pending' | 'success' | 'error'

/** A receipt belongs to an operation and content identity, never to a theme. */
export function useActionFeedback(identity?: unknown, durationMs = 2600) {
  const [phase, setPhase] = useState<ActionFeedbackPhase>('idle')
  const generation = useRef(0)
  const mounted = useRef(true)
  const pending = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }, [])
  const reset = useCallback(() => {
    generation.current += 1
    pending.current = false
    clearTimer()
    if (mounted.current) setPhase('idle')
  }, [clearTimer])
  useEffect(() => { reset() }, [identity, reset])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; generation.current += 1; clearTimer() }
  }, [clearTimer])

  const report = useCallback((result: Exclude<ActionFeedbackPhase, 'idle'>) => {
    if (!mounted.current) return
    const ticket = ++generation.current
    pending.current = result === 'pending'
    clearTimer()
    setPhase(result)
    if (result !== 'success' || durationMs <= 0) return
    void resolveAppFeedbackTimeout(durationMs, AccessibilityInfo).then(timeout => {
      if (!mounted.current || generation.current !== ticket) return
      timer.current = setTimeout(() => {
        timer.current = null
        if (mounted.current && generation.current === ticket) setPhase('idle')
      }, timeout)
    })
  }, [clearTimer, durationMs])

  const run = useCallback(async (operation: () => Promise<unknown>): Promise<boolean> => {
    if (pending.current || !mounted.current) return false
    report('pending')
    const ticket = generation.current
    let succeeded = false
    try { succeeded = await operation() !== false } catch { succeeded = false }
    if (mounted.current && generation.current === ticket) report(succeeded ? 'success' : 'error')
    return succeeded
  }, [report])
  return { phase, run, report, reset }
}
