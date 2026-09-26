/** Execution deadlines must not depend solely on an Android UI frame clock.
 * The optional platform mirror never grants CPU or run authority. UI timers stay
 * untouched; foreground/Web and tests retain their ordinary timer implementation. */
export interface ExecutionTimerMirror {
  schedule(callback: () => void, delayMs: number): () => void
}

export interface ExecutionTimer { cancel(): void }

let mirror: ExecutionTimerMirror | undefined

/** Installed once by application composition, before admitting native work. */
export function bindExecutionTimerMirror(value: ExecutionTimerMirror): () => void {
  if (mirror) throw new Error('Execution timer mirror is already installed')
  mirror = value
  return () => { if (mirror === value) mirror = undefined }
}

export function setExecutionTimeout(callback: () => void, delayMs: number): ExecutionTimer {
  if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 2_147_483_647) throw new Error('Invalid execution deadline')
  let active = true
  let nativeCancel: (() => void) | undefined
  const cancel = () => {
    if (!active) return
    active = false
    clearTimeout(timer)
    nativeCancel?.()
  }
  const fire = () => { if (active) { cancel(); callback() } }
  const timer = setTimeout(fire, delayMs)
  try {
    nativeCancel = mirror?.schedule(fire, delayMs)
    if (!active) nativeCancel?.()
  } catch (error) { cancel(); throw error }
  return { cancel }
}

export function clearExecutionTimeout(timer: ExecutionTimer | undefined | null): void { timer?.cancel() }

export function setExecutionInterval(callback: () => void, delayMs: number): ExecutionTimer {
  let active = true
  let timer: ExecutionTimer
  const tick = () => {
    if (!active) return
    try { callback() } finally { if (active) timer = setExecutionTimeout(tick, delayMs) }
  }
  timer = setExecutionTimeout(tick, delayMs)
  return { cancel() { active = false; timer.cancel() } }
}

export const clearExecutionInterval = clearExecutionTimeout
