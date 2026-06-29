# Multimodal Workflow Compatibility Gates

## Scope

Multimodal features should enter IsleMind as bounded workflows, not as generic "upload anything to the model" paths. This gate records which image, document, audio, speech, realtime voice, video, and screen-understanding paths are ready, which need adapters, and which stay blocked.

Local gate:

- Schema: `islemind.multimodal-workflow-compatibility-eval.v1`
- Service: `src/services/multimodalWorkflowCompatibilityEvaluation.ts`
- Script: `scripts/multimodal-workflow-compatibility-tests.js`
- Package entry: `bun run test:multimodal-workflow-compatibility`

Architecture stance:

- Provider chat receives image/audio/file controls only when provider and model metadata prove support.
- Documents enter context through ingestion, chunking, provenance, and citation traces before retrieval.
- Audio and speech require permission, duration limits, cancellation, transcript boundaries, and temp-file cleanup.
- Realtime voice requires a dedicated low-latency, interruptible, consented adapter before adoption.
- Video and screen understanding require frame budgets, redaction, provenance, and worker or capture adapters before adoption.
- Raw media must not be retained in cache, diagnostics, traces, or exports without an explicit retention policy.

## Fixture Set

| Fixture | Purpose | Required behavior |
| --- | --- | --- |
| `image-chat-provider-routing` | Image input for provider chat | Sends image parts only when provider/model metadata and request shaping support them. |
| `document-ingestion-before-context` | File/document context | Routes files through ingestion chunks, provenance, and citation traces before context injection. |
| `audio-transcription-permissioned` | Audio to text | Requires native permission, duration limits, temp cleanup, and transcript boundaries. |
| `speech-output-temp-cleanup` | Text to speech | Keeps generated speech cancellable, temporary, and cleaned after playback or replacement. |
| `realtime-voice-adapter-required` | Duplex voice | Stays `needs-adapter` until realtime transport, interruption, permission, transcript, and retention boundaries are implemented. |
| `video-frame-worker-required` | Video understanding | Stays `needs-adapter` until frame sampling, worker execution, latency, size, and thermal budgets are proven. |
| `screen-understanding-user-consent` | Screen context | Stays `needs-adapter` until explicit consent, capture scope, frame budget, redaction, and provenance are implemented. |
| `unsupported-modality-overclaim-blocked` | Provider overclaim | Blocks generic multimodal payloads without provider/model capability evidence. |
| `raw-media-retention-blocked` | Raw media retention | Blocks cache, trace, diagnostic, or export paths that retain raw media without policy. |
| `unbounded-media-payload-blocked` | Unbounded payload | Blocks media paths without size, duration, frame, and token budgets. |

## Diagnostic Contract

Each diagnostic records:

- provider family, workflow surface, docs, input/output modalities, and request shape,
- provider/model metadata support and app request-control status,
- readiness: `ready`, `needs-adapter`, or `blocked`,
- adapter requirement status,
- consent, native permission, size budget, duration budget, frame budget, token budget, temp cleanup, retention policy, redaction, provenance, citation trace, cancellation, interruption, transcript boundary, realtime transport, worker allowance, artifact manifest, audit event, and failure codes.

## Adoption Rule

Before adding new multimodal provider routing, camera/audio capture, realtime voice, video understanding, screen context, media generation, or media artifact workflows, extend this gate with a fixture for the new path. Any path without provider/model evidence, explicit consent, bounded payload policy, cancellation, provenance, redaction, cleanup, and audit must stay blocked or `needs-adapter`.
