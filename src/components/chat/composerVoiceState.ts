export type ComposerVoiceFailureKind =
  | 'unavailable'
  | 'web-insecure'
  | 'web-unsupported'
  | 'permission'
  | 'recording'
  | 'transcription'

export type ComposerVoiceState =
  | { phase: 'idle' }
  | { phase: 'permission-request' }
  | { phase: 'recording'; durationMillis: number }
  | { phase: 'stopping'; durationMillis: number }
  | { phase: 'cancelling'; durationMillis: number }
  | { phase: 'transcribing'; durationMillis: number }
  | { phase: 'success' }
  | { phase: 'error'; kind: ComposerVoiceFailureKind; canAskAgain: boolean }

export type ComposerVoiceEvent =
  | { type: 'request-permission' }
  | { type: 'recording-started' }
  | { type: 'duration'; durationMillis: number }
  | { type: 'stop' }
  | { type: 'transcribe' }
  | { type: 'cancel' }
  | { type: 'succeed' }
  | { type: 'fail'; kind: ComposerVoiceFailureKind; canAskAgain?: boolean }
  | { type: 'reset' }

export const INITIAL_COMPOSER_VOICE_STATE: ComposerVoiceState = { phase: 'idle' }

export function reduceComposerVoiceState(state: ComposerVoiceState, event: ComposerVoiceEvent): ComposerVoiceState {
  switch (event.type) {
    case 'request-permission':
      return state.phase === 'idle' || state.phase === 'error' || state.phase === 'success'
        ? { phase: 'permission-request' }
        : state
    case 'recording-started':
      return state.phase === 'permission-request' ? { phase: 'recording', durationMillis: 0 } : state
    case 'duration':
      return state.phase === 'recording'
        ? { ...state, durationMillis: Math.max(state.durationMillis, event.durationMillis) }
        : state
    case 'stop':
      return state.phase === 'recording' ? { phase: 'stopping', durationMillis: state.durationMillis } : state
    case 'transcribe':
      return state.phase === 'stopping' ? { phase: 'transcribing', durationMillis: state.durationMillis } : state
    case 'cancel': {
      if (state.phase === 'idle' || state.phase === 'success' || state.phase === 'error') return state
      const durationMillis = 'durationMillis' in state ? state.durationMillis : 0
      return { phase: 'cancelling', durationMillis }
    }
    case 'succeed':
      return state.phase === 'transcribing' ? { phase: 'success' } : state
    case 'fail':
      return { phase: 'error', kind: event.kind, canAskAgain: event.canAskAgain ?? true }
    case 'reset':
      return INITIAL_COMPOSER_VOICE_STATE
  }
}

export function formatComposerVoiceDuration(durationMillis: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMillis / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function appendComposerVoiceTranscript(draft: string, transcript: string): string {
  const normalizedTranscript = transcript.trim()
  if (!normalizedTranscript) return draft
  if (!draft.trim()) return normalizedTranscript
  return `${draft}\n${normalizedTranscript}`
}

export function composerVoiceIsBusy(state: ComposerVoiceState): boolean {
  return state.phase === 'permission-request' ||
    state.phase === 'stopping' ||
    state.phase === 'cancelling' ||
    state.phase === 'transcribing'
}
