# Production QA Matrix

## Acceptance Evidence

| Evidence | Path | Required State |
| --- | --- | --- |
| Release APK provenance | `dist-apk/IsleMind-1.0.6-x86_64-no-model.apk` | Version `1.0.6`, `versionCode=106`, SHA256 `91563700d732dac746f749110dd9a1893de1a2fa461e2310489dd54f90ae7afb`, size `80382583 bytes`, modified `2026-06-04T03:06:42.052Z`. Source freshness is current against `assets/favicon.png` modified `2026-06-04T02:34:59.943Z`. Clean install on `emulator-5554` records `2026-06-04 03:10:34` for first install and `2026-06-04 03:10:34` for last update. |
| Current audit report | `test-evidence/qa/coverage-report.md` | Latest generated audit records `173 UIA snapshots`, `19 parsed result-evidence files`, and `200 scanned text evidence files`. |
| Architecture boundary audit | `test-evidence/qa/architecture-boundary-audit-results.json` | `architecture-boundary-audit-results.json` records `10 architecture boundary checks`, `0 architecture blocking issues`, and `0 architecture review findings` before release delivery. |
| Fresh route smoke | `test-evidence/qa/fresh-route-smoke/route-smoke-results.json` | Result file must exist and pass before release delivery. |
| Fresh home keyboard avoidance | `test-evidence/qa/fresh-keyboard-smoke-after-fix/home-keyboard-open-results.json` | Result file must exist and pass before release delivery. |
| Settings child-page Back | `test-evidence/qa/settings-back-dynamic-results.json` | Result file must exist and pass for Providers, Context, Memory, Knowledge, Preferences, Skills, and MCP child pages before release delivery. |
| Fresh provider Back regression | `test-evidence/qa/fresh-back-smoke-after-fix/providers-back-fixed-results.json` | Result file must exist and pass before release delivery. |
| Imported memory review | `test-evidence/qa/memory-review-smoke-results.json` | Result file must exist and pass before release delivery. |
| Structured work artifact | `test-evidence/qa/work-artifact-smoke-results.json` | Result file must exist and pass before release delivery. |
| Provider Runtime Android | `test-evidence/qa/provider-runtime-android-results.json` | Result file must exist and pass before release delivery. |

## Execution Policy

- Production QA evidence must include current APK provenance, runtime UIA/screenshot coverage, result evidence files, sensitive-evidence scan counts, and architecture boundary audit results before release delivery.
- Release sign-off must block when source/resource files are newer than the APK or installed package provenance is missing.
- Current production QA freshness checks must compare this matrix with generated QA evidence before release sign-off.
