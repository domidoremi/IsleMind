import { promises as fs } from 'node:fs'
import path from 'node:path'

import {
  INITIAL_COMPOSER_VOICE_STATE,
  appendComposerVoiceTranscript,
  formatComposerVoiceDuration,
  reduceComposerVoiceState,
} from '../src/components/chat/composerVoiceState'

const root = path.resolve(__dirname, '..')

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8')
}

describe('composer voice state machine', () => {
  test('follows permission, recording, stop, transcription, and success transitions', () => {
    let state = reduceComposerVoiceState(INITIAL_COMPOSER_VOICE_STATE, { type: 'request-permission' })
    expect(state.phase).toBe('permission-request')
    state = reduceComposerVoiceState(state, { type: 'recording-started' })
    expect(state).toEqual({ phase: 'recording', durationMillis: 0 })
    state = reduceComposerVoiceState(state, { type: 'duration', durationMillis: 3_250 })
    state = reduceComposerVoiceState(state, { type: 'stop' })
    expect(state).toEqual({ phase: 'stopping', durationMillis: 3_250 })
    state = reduceComposerVoiceState(state, { type: 'transcribe' })
    expect(state.phase).toBe('transcribing')
    state = reduceComposerVoiceState(state, { type: 'succeed' })
    expect(state.phase).toBe('success')
  })

  test('models permission recovery, cancellation, duration, and draft preservation', () => {
    const denied = reduceComposerVoiceState(
      { phase: 'permission-request' },
      { type: 'fail', kind: 'permission', canAskAgain: false },
    )
    expect(denied).toEqual({ phase: 'error', kind: 'permission', canAskAgain: false })
    expect(reduceComposerVoiceState({ phase: 'recording', durationMillis: 900 }, { type: 'cancel' }))
      .toEqual({ phase: 'cancelling', durationMillis: 900 })
    expect(formatComposerVoiceDuration(65_900)).toBe('01:05')
    expect(appendComposerVoiceTranscript('Existing draft', '  New transcript  ')).toBe('Existing draft\nNew transcript')
  })
})

describe('composer voice and quick-action source contracts', () => {
  test('uses the SDK 54 recording preset, audio mode, native cleanup, and web fail-closed guard', async () => {
    const source = await read('src/services/speech.ts')
    expect(source).toContain('RecordingPresets.HIGH_QUALITY')
    expect(source).toContain('setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })')
    expect(source).toContain('setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true })')
    expect(source).toContain("if (Platform.OS === 'web') throw")
    expect(source).toContain('FileSystem.deleteAsync(uri, { idempotent: true })')
    expect(source).toContain('signal?: AbortSignal')
  })

  test('projects accessible deterministic controls without the threshold paragraph', async () => {
    const source = await read('src/components/chat/Composer.tsx')
    expect(source).toContain('useComposerVoiceInput')
    expect(source).toContain('accessibilityLiveRegion="polite"')
    expect(source).toContain("minHeight: 44")
    expect(source).toContain("t('chat.openMicrophoneSettings')")
    expect(source).not.toContain('multimodalCapabilityNoticeWithGenerationGate')
    expect(source).not.toContain('const [recording, setRecording]')
  })

  test('removes the quick-action title and hint in every locale', async () => {
    for (const locale of ['en', 'ja', 'zh-CN']) {
      const resource = JSON.parse(await read(`src/i18n/resources/${locale}.json`))
      expect(resource.chat.quickToolsPanelTitle).toBeUndefined()
      expect(resource.chat.quickToolsPanelHint).toBeUndefined()
      expect(resource.chat.voiceRecording).toBeTruthy()
      expect(resource.chat.openMicrophoneSettings).toBeTruthy()
    }
  })
})
