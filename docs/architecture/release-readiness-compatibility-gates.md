# Release Readiness Compatibility Gates

## Scope

Release readiness modernization covers the delivery control plane above source stability, APK build artifacts, Android install handoff, smoke validation, update manifests, and QA evidence. It makes release promotion a versioned compatibility gate instead of a set of scattered scripts.

Local gate:

- Schema: `islemind.release-readiness-compatibility-eval.v1`
- Service: `src/services/releaseReadinessCompatibilityEvaluation.ts`
- Script: `scripts/release-readiness-compatibility-tests.js`
- Package entry: `bun run test:release-readiness-compatibility`

Architecture stance:

- Release inputs must be stable before a release APK can be treated as current evidence.
- Promoted APK artifacts must prove path resolution, source freshness, SHA256, sidecar hash, byte size, and 16 KB Android compatibility.
- Update manifests and APK asset URLs must pass explicit HTTP(S) safety checks before download.
- Staged APK files must be deleted on failures and registered for cleanup after installer handoff.
- Current APK smoke evidence must prove clean install, launch success, fatal-log absence, package/version parity, and 16 KB validation.
- QA evidence must stay under `test-evidence/qa` and the compatibility evaluation itself must stay local/offline.
- Stale APKs, unverified artifacts, and releases without smoke evidence must stay blocked.

## Fixture Set

| Fixture | Purpose | Required behavior |
| --- | --- | --- |
| `source-stability-window` | Source stability | Requires sampled release inputs, source snapshot expectations, local evidence, and no network dependency. |
| `apk-artifact-freshness` | APK freshness | Requires current source freshness or a matching release source snapshot. |
| `release-manifest-contract` | Manifest contract | Requires manifest parsing, version/package parity, and versioned release metadata. |
| `apk-url-safety` | Download safety | Requires manifest and asset URLs to pass explicit HTTP(S) URL validation. |
| `apk-integrity-verification` | Artifact integrity | Requires SHA256, sidecar hash, and positive size verification before install. |
| `staged-apk-cleanup` | Download lifecycle | Requires failed downloads to be discarded and successful installer handoffs to register cleanup. |
| `installer-handoff-evidence` | Install handoff | Requires visible installer handoff, installer-opened record, clean install proof, package match, and version match. |
| `current-apk-smoke` | Runtime smoke | Requires launch success, fatal-log check, clean install, expected package/version, and smoke evidence. |
| `android-16kb-validation` | Android compatibility | Requires strict 16 KB validation, ZIP page alignment, and 64-bit ELF LOAD alignment. |
| `qa-evidence-retention` | Evidence location | Requires local QA evidence under `test-evidence/qa` with no network call dependency. |
| `blocked-stale-apk-artifact` | Stale artifact | Blocks release candidates where source/resource inputs are newer than the APK. |
| `blocked-unverified-apk-artifact` | Missing integrity | Blocks release candidates missing SHA256, sidecar SHA256, or byte-size verification. |
| `blocked-release-without-smoke-evidence` | Missing smoke | Blocks release candidates without smoke, clean-install, launch, fatal-log, and 16 KB evidence. |

## Diagnostic Contract

Each diagnostic records:

- surface,
- readiness: `ready` or `blocked`,
- source stability, source snapshot, artifact path, artifact freshness, manifest parsing, URL safety, version/package parity, SHA256, sidecar hash, size verification, 16 KB validation, ZIP/ELF alignment, installer handoff, staged cleanup, clean install, launch smoke, fatal-log check, QA evidence path, smoke evidence, local/offline status, and failure codes.

## Adoption Rule

Before adding release channels, APK variants, update manifest fields, installer flows, CI promotion steps, Android compatibility checks, or release evidence formats, extend this gate with a fixture for the new path. A release path that cannot prove source freshness, artifact integrity, URL safety, staged-file cleanup, install handoff, launch smoke, 16 KB compatibility, and QA evidence must stay blocked.
