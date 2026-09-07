export type ContextCompactionGuardDisabledReason = 'consecutive-failures' | 'thrashing'

export interface ContextCompactionGuardState {
  readonly conversationId: string
  readonly turn: number
  readonly compressionEpoch: number
  readonly consecutiveFailures: number
  readonly rapidRetriggerCount: number
  readonly autoDisabled: boolean
  readonly disabledReason?: ContextCompactionGuardDisabledReason
  readonly lastAttemptTurn?: number
}

export interface ContextCompactionGuardPolicy {
  beginTurn(conversationId: string): ContextCompactionGuardState
  recordAttempt(input: {
    readonly conversationId: string
    readonly succeeded: boolean
  }): ContextCompactionGuardState
  getState(conversationId: string): ContextCompactionGuardState
  reset(conversationId: string): void
}

interface MutableGuardState {
  conversationId: string
  turn: number
  compressionEpoch: number
  consecutiveFailures: number
  rapidRetriggerCount: number
  autoDisabled: boolean
  disabledReason?: ContextCompactionGuardDisabledReason
  lastAttemptTurn?: number
}

const FAILURE_LIMIT = 3
const THRASHING_LIMIT = 3
const RAPID_RETRIGGER_TURNS = 3
const DEFAULT_MAX_CONVERSATIONS = 256

export function createContextCompactionGuardPolicy(options: {
  readonly maxConversations?: number
} = {}): ContextCompactionGuardPolicy {
  const states = new Map<string, MutableGuardState>()
  const maxConversations = Math.max(1, Math.floor(options.maxConversations ?? DEFAULT_MAX_CONVERSATIONS))

  function beginTurn(conversationId: string): ContextCompactionGuardState {
    const state = mutableState(states, conversationId)
    state.turn += 1
    touch(states, state)
    evictOldest(states, maxConversations)
    return snapshot(state)
  }

  function recordAttempt(input: {
    readonly conversationId: string
    readonly succeeded: boolean
  }): ContextCompactionGuardState {
    const state = mutableState(states, input.conversationId)
    // Recovery can replay finalization. Count at most one attempt per turn.
    if (state.lastAttemptTurn === state.turn) return snapshot(state)
    state.rapidRetriggerCount = state.lastAttemptTurn !== undefined
      && state.turn - state.lastAttemptTurn <= RAPID_RETRIGGER_TURNS
      ? state.rapidRetriggerCount + 1
      : 0
    state.lastAttemptTurn = state.turn
    state.compressionEpoch += 1
    state.consecutiveFailures = input.succeeded ? 0 : state.consecutiveFailures + 1
    if (state.consecutiveFailures >= FAILURE_LIMIT) {
      state.autoDisabled = true
      state.disabledReason = 'consecutive-failures'
    } else if (state.rapidRetriggerCount >= THRASHING_LIMIT) {
      state.autoDisabled = true
      state.disabledReason = 'thrashing'
    }
    touch(states, state)
    evictOldest(states, maxConversations)
    return snapshot(state)
  }

  function getState(conversationId: string): ContextCompactionGuardState {
    const state = mutableState(states, conversationId)
    touch(states, state)
    evictOldest(states, maxConversations)
    return snapshot(state)
  }

  function reset(conversationId: string): void {
    states.delete(requireConversationId(conversationId))
  }

  return { beginTurn, recordAttempt, getState, reset }
}

function mutableState(states: Map<string, MutableGuardState>, conversationId: string): MutableGuardState {
  const id = requireConversationId(conversationId)
  const existing = states.get(id)
  if (existing) return existing
  const created: MutableGuardState = {
    conversationId: id,
    turn: 0,
    compressionEpoch: 0,
    consecutiveFailures: 0,
    rapidRetriggerCount: 0,
    autoDisabled: false,
  }
  states.set(id, created)
  return created
}

function snapshot(state: MutableGuardState): ContextCompactionGuardState {
  return Object.freeze({ ...state })
}

function touch(states: Map<string, MutableGuardState>, state: MutableGuardState): void {
  states.delete(state.conversationId)
  states.set(state.conversationId, state)
}

function evictOldest(states: Map<string, MutableGuardState>, limit: number): void {
  while (states.size > limit) {
    const oldest = states.keys().next().value as string | undefined
    if (!oldest) return
    states.delete(oldest)
  }
}

function requireConversationId(value: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 512 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new TypeError('Invalid compaction guard conversationId.')
  }
  return normalized
}
