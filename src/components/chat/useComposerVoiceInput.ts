import { useCallback, useEffect, useReducer, useRef } from 'react'
import { Linking } from 'react-native'

import {
  cancelLocalAudioRecording,
  deleteLocalAudioRecording,
  getAudioRecordingAvailability,
  requestMicrophonePermission,
  startLocalAudioRecording,
  stopLocalAudioRecording,
  transcribeLocalAudio,
  useLocalAudioRecorder,
} from '@/services/speech'

import {
  INITIAL_COMPOSER_VOICE_STATE,
  composerVoiceIsBusy,
  reduceComposerVoiceState,
  type ComposerVoiceEvent,
  type ComposerVoiceFailureKind,
} from './composerVoiceState'

export function useComposerVoiceInput({
  enabled,
  onTranscript,
}: {
  enabled: boolean
  onTranscript: (transcript: string) => void
}) {
  const { recorder, durationMillis } = useLocalAudioRecorder()
  const [state, dispatch] = useReducer(reduceComposerVoiceState, INITIAL_COMPOSER_VOICE_STATE)
  const stateRef = useRef(state)
  const mountedRef = useRef(true)
  const operationRef = useRef(0)
  const appendedOperationRef = useRef<number | null>(null)
  const activeUriRef = useRef<string | null>(null)
  const transcriptionAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const transition = useCallback((event: ComposerVoiceEvent) => {
    stateRef.current = reduceComposerVoiceState(stateRef.current, event)
    dispatch(event)
  }, [])

  useEffect(() => {
    if (state.phase === 'recording') {
      transition({ type: 'duration', durationMillis })
    }
  }, [durationMillis, state.phase, transition])

  useEffect(() => {
    if (state.phase !== 'success') return
    const timeout = setTimeout(() => transition({ type: 'reset' }), 1200)
    return () => clearTimeout(timeout)
  }, [state.phase, transition])

  const isCurrentOperation = useCallback((operation: number) => {
    return mountedRef.current && operationRef.current === operation
  }, [])

  const begin = useCallback(async () => {
    if (!enabled || composerVoiceIsBusy(stateRef.current) || stateRef.current.phase === 'recording') return

    const operation = operationRef.current + 1
    operationRef.current = operation
    appendedOperationRef.current = null
    transition({ type: 'request-permission' })

    const availability = getAudioRecordingAvailability()
    if (availability !== 'available') {
      transition({ type: 'fail', kind: availability as ComposerVoiceFailureKind, canAskAgain: false })
      return
    }

    try {
      const permission = await requestMicrophonePermission()
      if (!isCurrentOperation(operation)) return
      if (!permission.granted) {
        transition({ type: 'fail', kind: 'permission', canAskAgain: permission.canAskAgain })
        return
      }

      await startLocalAudioRecording(recorder)
      if (!isCurrentOperation(operation)) {
        await cancelLocalAudioRecording(recorder, true)
        return
      }
      transition({ type: 'recording-started' })
    } catch {
      if (isCurrentOperation(operation)) {
        transition({ type: 'fail', kind: 'recording' })
      }
      await cancelLocalAudioRecording(recorder, false)
    }
  }, [enabled, isCurrentOperation, recorder, transition])

  const stop = useCallback(async () => {
    if (stateRef.current.phase !== 'recording') return
    const operation = operationRef.current
    transition({ type: 'stop' })

    let uri: string | null = null
    try {
      uri = await stopLocalAudioRecording(recorder)
      if (!isCurrentOperation(operation)) return
      if (!uri) throw new Error('Audio recorder returned no local URI')

      activeUriRef.current = uri
      transition({ type: 'transcribe' })
      const abortController = new AbortController()
      transcriptionAbortRef.current = abortController
      const transcript = await transcribeLocalAudio(uri, undefined, abortController.signal)
      if (!isCurrentOperation(operation) || abortController.signal.aborted) return

      if (appendedOperationRef.current !== operation && transcript.trim()) {
        appendedOperationRef.current = operation
        onTranscript(transcript)
      }
      transition({ type: 'succeed' })
    } catch {
      if (isCurrentOperation(operation)) {
        transition({ type: 'fail', kind: 'transcription' })
      }
    } finally {
      if (transcriptionAbortRef.current && operationRef.current === operation) {
        transcriptionAbortRef.current = null
      }
      const cleanupUri = uri ?? activeUriRef.current
      activeUriRef.current = null
      await deleteLocalAudioRecording(cleanupUri)
    }
  }, [isCurrentOperation, onTranscript, recorder, transition])

  const cancel = useCallback(async () => {
    const previousState = stateRef.current
    if (previousState.phase === 'idle') return

    const operation = operationRef.current + 1
    operationRef.current = operation
    transcriptionAbortRef.current?.abort()
    transcriptionAbortRef.current = null
    transition({ type: 'cancel' })

    const shouldStopRecorder = previousState.phase === 'recording'
    const cleanupUri = activeUriRef.current
    activeUriRef.current = null
    await cancelLocalAudioRecording(recorder, shouldStopRecorder)
    await deleteLocalAudioRecording(cleanupUri)
    if (isCurrentOperation(operation)) transition({ type: 'reset' })
  }, [isCurrentOperation, recorder, transition])

  const openSettings = useCallback(async () => {
    await Linking.openSettings()
    transition({ type: 'reset' })
  }, [transition])

  useEffect(() => {
    if (!enabled && state.phase !== 'idle') void cancel()
  }, [cancel, enabled, state.phase])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      operationRef.current += 1
      transcriptionAbortRef.current?.abort()
      const shouldStopRecorder = stateRef.current.phase === 'recording'
      const cleanupUri = activeUriRef.current
      activeUriRef.current = null
      if (shouldStopRecorder) {
        void cancelLocalAudioRecording(recorder, true)
          .then(() => deleteLocalAudioRecording(cleanupUri))
        return
      }
      void deleteLocalAudioRecording(cleanupUri)
    }
  }, [recorder])

  return {
    state,
    begin,
    stop,
    cancel,
    retry: begin,
    openSettings,
  }
}
