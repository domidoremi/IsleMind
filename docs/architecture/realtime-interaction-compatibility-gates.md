# Realtime Interaction Compatibility Gates

## Scope

Realtime interaction is the boundary between push-to-talk transcription, speech playback, provider-native duplex audio, visible text fallback, and session-state safety. This gate prevents IsleMind from treating realtime voice as simple STT + TTS until transport, interruption, transcript, cost, privacy, and cleanup behavior are explicit.

Local gate:

- Schema: `islemind.realtime-interaction-compatibility-eval.v1`
- Service: `src/services/realtimeInteractionCompatibilityEvaluation.ts`
- Script: `scripts/realtime-interaction-compatibility-tests.js`
- Package entry: `bun run test:realtime-interaction-compatibility`

Architecture stance:

- Current voice input remains push-to-talk transcription unless a dedicated realtime adapter proves low-latency duplex behavior.
- Provider-native realtime voice needs provider contract evidence, duplex transport, request adapter, interruption events, turn boundaries, and transcript partial/final separation.
- Speech output must stay cancellable and clean temporary provider audio files.
- Realtime failure must degrade visibly to text chat or push-to-talk voice notes without preserving cross-session audio state.
- Raw audio, transcripts, session ids, response ids, and provider audio buffers must not leak into diagnostics, cache, export, or another chat session.

## Fixture Set

| Fixture | Purpose | Required behavior |
| --- | --- | --- |
| `push-to-talk-transcription-fallback` | Current voice input | Uses microphone permission, bounded audio read, transcript boundary, temp cleanup, and text insertion fallback. |
| `provider-realtime-duplex-transport` | Realtime provider path | Requires provider contract, duplex transport, low latency budget, and a dedicated request adapter. |
| `barge-in-interruption-control` | Barge-in | Requires interruption, cancellation, speaker control, and transcript repair behavior. |
| `turn-taking-and-vad-boundary` | Turn taking | Requires VAD, turn end, silence timeout, and user override boundaries. |
| `streaming-transcript-partial-final-boundary` | Streaming transcript | Keeps partial hypotheses separate from final persisted transcript chunks. |
| `speech-output-cancellation-cleanup` | Speech playback | Keeps speech cancellable and cleans generated provider audio on finish or replacement. |
| `local-offline-voice-note-mode` | Offline voice note | Allows bounded local draft capture without claiming realtime conversation. |
| `visible-fallback-to-text-chat` | Fallback | Degrades visibly to text chat without carrying provider audio state. |
| `blocked-missing-microphone-permission` | Permission block | Blocks voice capture without microphone permission. |
| `blocked-unbounded-audio-buffer` | Budget block | Blocks missing duration, audio buffer, token, or cost budgets. |
| `blocked-realtime-without-interrupt` | Control block | Blocks realtime voice when users cannot interrupt or cancel model speech. |
| `blocked-raw-audio-retention` | Retention block | Blocks unbounded raw audio retention in cache, diagnostics, or export. |
| `blocked-cross-session-audio-state` | Session block | Blocks realtime session ids, audio buffers, and transcripts across sessions/providers. |

## Diagnostic Contract

Each diagnostic records:

- surface, mode, transport, readiness, and description,
- docs mapping, user consent, microphone permission, and speaker control,
- provider realtime contract and request adapter status,
- latency budget and observed latency,
- VAD boundary, turn boundary, and partial/final transcript boundary,
- interruption and cancellation controls,
- audio buffer, duration, token, and cost budgets,
- temp cleanup, raw audio retention, transcript redaction,
- fallback mode and fallback visibility,
- same-session audio state, audit event, local/offline status, and failure codes.

## Adoption Rule

Before adding provider-native realtime voice, streaming transcript UI, barge-in, local offline voice notes, audio session persistence, or new speech playback behavior, extend this gate with a fixture for the interaction path. Any path without permission, consent, bounded buffers, interruption, cancellation, transcript boundaries, visible fallback, cleanup, redaction, audit, and same-session state isolation must stay blocked or degraded with a visible reason.
