import * as FileSystem from 'expo-file-system/legacy'
import * as Speech from 'expo-speech'
import {
  AudioModule,
  RecordingPresets,
  createAudioPlayer,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio'
import { Platform } from 'react-native'
import type { AIProvider } from '@/types/providerContracts'
import { synthesizeProviderSpeech, transcribeProviderAudio } from '@/bootstrap/providerRuntime'
import { useSettingsStore } from '@/store/settingsStore'
import { st } from '@/i18n/service'
import { getPolicyPreferredProviderModel } from '@/bootstrap/providerModelAccess'
import { assertImportFileSizeByUri, MAX_IMPORT_TEXT_FILE_BYTES } from '@/platform/native/boundedImportFile'
import { providerCompatibilityCapabilityCanBeSentForProvider } from '@/modules/providers'

type LocalAudioRecorder = ReturnType<typeof useAudioRecorder>

export type AudioRecordingAvailability = 'available' | 'unavailable' | 'web-insecure' | 'web-unsupported'

export interface MicrophonePermissionResult {
  status: 'granted' | 'denied' | 'undetermined'
  granted: boolean
  canAskAgain: boolean
}

let activeProviderAudioPlayer: ReturnType<typeof createAudioPlayer> | null = null
let activeProviderAudioUri: string | null = null
let activeProviderAudioStatusSubscription: { remove?: () => void } | null = null

export function getAudioRecordingAvailability(): AudioRecordingAvailability {
  if (Platform.OS === 'web') {
    return globalThis.isSecureContext === false ? 'web-insecure' : 'web-unsupported'
  }
  const permissionRequest = (AudioModule as { requestRecordingPermissionsAsync?: unknown }).requestRecordingPermissionsAsync
  return typeof permissionRequest === 'function' ? 'available' : 'unavailable'
}

export function isAudioRecordingAvailable(): boolean {
  return getAudioRecordingAvailability() === 'available'
}

export function useLocalAudioRecorder(): { recorder: LocalAudioRecorder; durationMillis: number; isRecording: boolean } {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const recorderState = useAudioRecorderState(recorder, 200)
  return {
    recorder,
    durationMillis: recorderState.durationMillis,
    isRecording: recorderState.isRecording,
  }
}

export async function requestMicrophonePermission(): Promise<MicrophonePermissionResult> {
  if (getAudioRecordingAvailability() !== 'available') {
    return { status: 'denied', granted: false, canAskAgain: false }
  }
  const result = await AudioModule.requestRecordingPermissionsAsync()
  const status = result.granted
    ? 'granted'
    : result.status === 'denied'
      ? 'denied'
      : 'undetermined'
  return {
    status,
    granted: result.granted,
    canAskAgain: result.canAskAgain,
  }
}

export async function startLocalAudioRecording(recorder: LocalAudioRecorder): Promise<void> {
  try {
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
    await recorder.prepareToRecordAsync()
    recorder.record()
  } catch (error) {
    await restoreLocalAudioMode()
    throw error
  }
}

export async function stopLocalAudioRecording(recorder: LocalAudioRecorder): Promise<string | null> {
  try {
    await recorder.stop()
    return recorder.uri
  } finally {
    await restoreLocalAudioMode()
  }
}

export async function cancelLocalAudioRecording(recorder: LocalAudioRecorder, shouldStopRecorder: boolean): Promise<void> {
  try {
    if (shouldStopRecorder) await recorder.stop()
  } catch {
  } finally {
    await restoreLocalAudioMode()
    await deleteLocalAudioRecording(recorder.uri)
  }
}

export async function deleteLocalAudioRecording(uri: string | null | undefined): Promise<void> {
  if (!uri || Platform.OS === 'web') return
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined)
}

async function restoreLocalAudioMode(): Promise<void> {
  await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined)
}

export async function transcribeLocalAudio(uri: string, provider?: AIProvider | null, signal?: AbortSignal): Promise<string> {
  if (Platform.OS === 'web') throw new Error('Web audio transcription is unsupported')
  throwIfTranscriptionAborted(signal)
  await assertImportFileSizeByUri(uri, { limitBytes: MAX_IMPORT_TEXT_FILE_BYTES })
  throwIfTranscriptionAborted(signal)
  const settings = useSettingsStore.getState().settings
  const sourceProvider = provider ?? await useSettingsStore.getState().getPrimaryConfiguredProvider()
  if (!sourceProvider) throw new Error(st('speech.transcriptionNeedsProvider'))
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 })
  throwIfTranscriptionAborted(signal)
  const transcript = await transcribeProviderAudio({
    provider: sourceProvider,
    audioBase64: base64,
    mimeType: guessAudioMime(uri),
    fileName: uri.split('/').pop() || 'recording.m4a',
    model: sourceProvider.type === 'google' ? getPolicyPreferredProviderModel(sourceProvider, settings) : undefined,
  })
  throwIfTranscriptionAborted(signal)
  return transcript
}

export async function speakText(text: string, provider?: AIProvider | null): Promise<void> {
  if (!text.trim()) return
  const sourceProvider = provider ?? await useSettingsStore.getState().getPrimaryConfiguredProvider()
  const providerSpeechSupported = !!sourceProvider &&
    sourceProvider.capabilities?.speech === true &&
    providerCompatibilityCapabilityCanBeSentForProvider(sourceProvider, 'audio', true)
  if (providerSpeechSupported && FileSystem.cacheDirectory) {
    try {
      const base64 = await synthesizeProviderSpeech({
        provider: sourceProvider,
        text,
      })
      if (base64) {
        await playProviderSpeechBase64(base64)
        return
      }
    } catch {
      // Fall back to local speech below. Remote TTS is optional and should never
      // block quick reading when a provider lacks speech support or rejects it.
    }
  }
  speakTextLocally(text)
}

export function speakTextLocally(text: string): void {
  Speech.stop()
  Speech.speak(text.slice(0, 4000), {
    language: 'zh-CN',
    rate: 0.96,
    pitch: 1,
  })
}

export function stopSpeaking(): void {
  activeProviderAudioStatusSubscription?.remove?.()
  activeProviderAudioStatusSubscription = null
  try {
    activeProviderAudioPlayer?.pause?.()
    activeProviderAudioPlayer?.remove?.()
  } catch {}
  activeProviderAudioPlayer = null
  void clearActiveProviderAudioFile()
  Speech.stop()
}

async function playProviderSpeechBase64(base64: string): Promise<void> {
  const uri = `${FileSystem.cacheDirectory}islemind-tts-${Date.now()}.mp3`
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 })
  stopSpeaking()
  activeProviderAudioPlayer = createAudioPlayer({ uri })
  activeProviderAudioUri = uri
  activeProviderAudioStatusSubscription = activeProviderAudioPlayer?.addListener?.('playbackStatusUpdate', (status: { didJustFinish?: boolean }) => {
    if (!status?.didJustFinish) return
    activeProviderAudioStatusSubscription?.remove?.()
    activeProviderAudioStatusSubscription = null
    try {
      activeProviderAudioPlayer?.remove?.()
    } catch {}
    activeProviderAudioPlayer = null
    void clearActiveProviderAudioFile()
  }) ?? null
  activeProviderAudioPlayer.play()
}

async function clearActiveProviderAudioFile(): Promise<void> {
  const uri = activeProviderAudioUri
  activeProviderAudioUri = null
  if (!uri) return
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined)
}

function guessAudioMime(uri: string): string {
  const lower = uri.split(/[?#]/, 1)[0].toLowerCase()
  if (lower.endsWith('.mp3')) return 'audio/mpeg'
  if (lower.endsWith('.wav')) return 'audio/wav'
  if (lower.endsWith('.webm')) return 'audio/webm'
  return 'audio/mp4'
}

function throwIfTranscriptionAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('Audio transcription was cancelled')
  error.name = 'AbortError'
  throw error
}
