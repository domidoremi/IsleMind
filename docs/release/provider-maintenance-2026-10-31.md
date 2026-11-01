# Provider maintenance and local remediation

Reviewed: 2026-10-31, Asia/Taipei. Owner: project-maintainer.
Next review: 2026-11-07; security exceptions have their own earlier-or-equal
review deadlines. This is an engineering maintenance record, not release
approval or a promise of a publication date.

The machine-readable record is
[`scripts/fixtures/provider-maintenance-ledger.json`](../../scripts/fixtures/provider-maintenance-ledger.json).
It owns the current source reviews, finding/goal statuses, individual advisory
dispositions, original focus-failure triage, review deadlines and external
validation boundaries. The final local verification counters live in
`regression.lastLocalVerification`; raw receipts are retained separately.

## Remediation scope

| Finding | Local change | Permanent behavior evidence |
| --- | --- | --- |
| F01 | Protocol-aware completed/failed/incomplete/interrupted outcomes; missing-terminal EOF is not success; caller cancellation remains cancellation | Real executor lifecycle fixtures and parser unit tests |
| F02 | Compatible locked-version upgrades plus explicit, scoped, expiring exceptions | Security behavior tests and an isolated public-registry scan |
| F03 | Request shaping uses the actual wire adapter; an explicit schema is serialized or rejected, never silently lost | Request-shape unit tests, capability-matrix and SambaNova focuses |
| F04 | Shared Fireworks reasoning choices cover explicit remote metadata and legacy persistence; evidence-free compatible discovery retains an empty effort list | Discovery persistence tests and the Fireworks focus |
| F05 | Exact GPT-5 mini/nano standard prices; unknown siblings and relays do not inherit an unproven price | Pricing and historical-usage tests |
| F06 | Messages URL completion preserves full endpoints and custom prefixes without OpenAI-specific `/v1` normalization | Host/base/full endpoint and trailing-slash matrix |
| F07 | Dotted/slashed model-not-found IDs are recognized conservatively | Error-classification tests, including HTML and echoed-text counterexamples |
| F08 | Sourced Deprecated warnings for GPT-5 mini/nano, without deleting saved models or inventing shutdown dates | Catalog lifecycle tests |

F01 retains already emitted text and available usage on failure, interruption
and token/safety limits. Non-success terminal results cannot start automatic
tool replay or be reported as successful completion. Terminal transport cleanup
releases readers, timers and abort listeners. Chat Completions permits a bounded
usage-trailer window after `finish_reason`; an indefinitely open connection does
not keep the operation pending indefinitely.

Shared response/stream types live below both implementations in
`providerResponseContracts.ts`. Existing public import paths remain re-exported;
the include-type dependency gate prevents a parsing/lifecycle cycle from
returning. The transport architecture marker also checks malformed SSE data
alongside data/terminal framing.

Model/display-name recognition is not endpoint parameter evidence. Generic
compatible Grok/Qwen/GLM labels cannot restore supplier-specific effort controls
after JSON persistence. Explicit request-control metadata, manual declarations
and existing supplier-identity rules remain separately tested. Unknown controls
remain conservative; Novita's explicit reasoning-effort denial is authoritative.

`providerFireworksReasoning.ts` owns the Fireworks effort enum and wire
normalization; the existing public utility wrappers delegate to it. Explicit
remote `reasoning_effort` evidence for GLM-5.2 selects `none/high/max`, including
the namespaced model ID. Persisted legacy remote OpenAI enums resolve through
the same supplier policy instead of hiding `max`. Manual declaration and
endpoint-evidence boundaries remain separately tested.

OpenAI's official model pages were reviewed on 2026-10-31:

| Model | Input / 1M tokens | Cached input / 1M tokens | Output / 1M tokens |
| --- | --- | --- | --- |
| [GPT-5 mini](https://developers.openai.com/api/docs/models/gpt-5-mini) | USD 0.25 | USD 0.025 | USD 2.00 |
| [GPT-5 nano](https://developers.openai.com/api/docs/models/gpt-5-nano) | USD 0.05 | USD 0.005 | USD 0.40 |

Both pages show Deprecated, not a service shutdown date. Local price-table
estimates are not provider charges. Existing recorded costs are not retroactively
repriced. Resellers, unreviewed model variants, service/time tiers, search/tool
fees and missing usage need independent pricing evidence or remain unavailable.

## Security dispositions

The original audit identified 12 distinct GHSA identities. Ten are no longer
matched after compatible locked-version upgrades. Two original identities and
two follow-up identities remain visible in the registry scan. A passing review
means the exact exceptions are still valid, not that the lockfile is clean.

| Package | Reviewed locked versions | Disposition |
| --- | --- | --- |
| decode-uri-component | 0.5.1 | Compatible upgrade; existing query-string backport retained |
| markdown-it | 14.3.3 | Both reference-parser and HTML-parser advisories addressed |
| shell-quote | 1.11.0 | Compatible upgrade; regressions construct strings without executing a shell |
| node-forge | 1.4.2 | Compatible upgrade; RSA/PEM verification interoperability retained |
| compression | 1.8.2 | Compatible upgrade; aborted HTTP gzip cleanup exercised |
| source-map-js | 1.2.2 | Compatible upgrade; indexed-offset resource guard exercised |
| brace-expansion | 1.1.21 and 5.0.12 | Both CommonJS legacy and modern consumer branches exercised |
| deepmerge | 4.3.1 | Local source/CJS/UMD own-property-write backport; registry advisory remains |
| zod | 3.25.76 | Local v3 CJS/ESM bounded-validation backport; registry advisory remains |

Remaining exact exceptions:

| GHSA | Package/version matches | Scope | Expires, Asia/Taipei |
| --- | --- | --- | --- |
| [gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) | deepmerge 4.3.1 | Mitigated tooling static review | 2026-11-14 00:00 |
| [mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) | zod 3.25.76 | Mitigated tooling static review | 2026-11-14 00:00 |
| [3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) | glob 13.0.6 | Unpatched tooling static review | 2026-11-07 00:00 |
| [g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | minimatch 3.1.5 and 10.2.6 | Unpatched tooling static review | 2026-11-07 00:00 |

Each of the 14 dispositions records previous/current versions, locked consumers,
entrypoint, Native/Web/build reachability limits, owner, source, regressions and
next review. The registry still reports four identities and five affected
locked-version matches. Unpatched glob/minimatch risks have not been eliminated.
The Zod mitigation does not cover bundled v4 entrypoints or every collection
type; the deepmerge backport is not an exhaustive prototype-pollution proof.

The gate fails closed for unknown advisory IDs, new affected versions, severity
changes, expired/overdue exceptions, changed locked consumers, direct production
imports, missing patch registration and patch SHA-256 drift. Static source and
lock review do not certify exact APK/Web/build reachability.

[`scripts/dependency-advisory-audit.js`](../../scripts/dependency-advisory-audit.js)
copies only reviewed manifests, lockfile and patches to an isolated temporary
workspace. It uses the pinned Bun version, public npm registry, an empty profile,
no dotenv or inherited credentials/proxies/runtime options, and no lifecycle
scripts. Scanner/network/JSON/exit-code failures cannot be overridden by an
exception. Use a new durable `--report-dir` for each scan.

## Regression and CI

[`scripts/provider-compatibility-tests.js`](../../scripts/provider-compatibility-tests.js)
runs the complete current inventory of 62 focuses in separate processes, retains
every original audited focus and continues after an individual failure. All 14
original first failures have an individual code-versus-fixture disposition in
the ledger. Original behavioral assertions are preserved or corrected to the
current documented contract; unsafe behavior is not restored to make tests green.

An exit code of zero alone is insufficient: every process must emit its stdout
completion marker and have no error, timeout or signal. Children use an
allowlisted OS environment and an offline guard. The report records Node version,
time, source revision, exact inventory and source fingerprints. Source changes
during the run invalidate verification even if every process exits successfully.
The separately reviewed ledger is excluded from that runtime/harness fingerprint
so final verification receipts can be recorded without changing tested code.
The advisory report independently fingerprints the ledger.

The SQLite entrypoint has 12 explicit `./src/...test.ts` targets, disables
automatic dotenv loading and preloads the same offline guard. It does not scan
archived copies or use substring filters. For credential-free local verification,
use a dotenv-free checkout/source snapshot; do not rely on a CLI flag as the only
environment-isolation boundary.

Keep `test` before the separate `--preload` argument. On the pinned Bun version,
putting that preload argument before the command can dispatch the package's
same-named `test` script instead of native tests. A real CLI-dispatch fixture
with a harmless package-script sentinel permanently checks this boundary.

### Complete local verification, 2026-10-31

| Check | Actual result |
| --- | --- |
| Independent focuses | 62/62 passed; all original 58 retained, all 14 original failures individually verified |
| Full Jest | 351 suites, 4,472 tests passed; no failed or skipped tests |
| Targeted maintenance/discovery/lifecycle Jest | 3 suites, 86 tests passed |
| Actual SQLite package entrypoint | 94 tests across exactly 12 current-source files passed |
| Related offline checks | 20/20 passed, including live-plan and Android-collector self-tests only |
| Type/dependency/transport architecture | Type check, include-type gate with zero cycles, transport gate and architecture self-test passed |
| Separate module architecture | One pre-existing document-set conflict; document preserved and no waiver |
| Isolated public-registry review | Four advisory identities / five locked-version matches remain under exact expiring exceptions |

The runtime/harness source revision is
`59aefb6207a9bed70ee6b73e1ac10fe8f140a30c`, with dirty-input SHA-256
`6f817fafbb83440a2bc2a69147bc2dacbc700e7778bef27ae065088b12588eee`.
Complete receipts share that identity and report stable source inputs. Local
verification uses Node 24.21.0 and Bun 1.4.2; the SQLite snapshot reuses a clean
frozen install only after dependency inputs, lockfile, all patches and the
paired UI manifest match.

`regression.lastLocalVerification` records the durable raw-receipt paths and
digests. Earlier failed, interrupted or superseded attempts are preserved and
are not final-current-tree certifications. The final advisory receipt
independently fingerprints the finalized ledger, without a self-referential
ledger hash.

[`provider-maintenance.yml`](../../.github/workflows/provider-maintenance.yml)
defines PR/manual-only jobs:

- Offline: pinned paired RN workspace, frozen install without lifecycle scripts,
  type check, architecture dependency/transport checks, independent focuses, lifecycle, exact SQLite targets, dependency
  behavior, full Jest, transport/protocol/request boundaries and collector self-tests.
- Advisories: isolated public-registry review and raw scanner evidence.
- Both retain evidence on failure with read-only repository permissions and no
  persisted checkout credentials. No publish/install or billed provider smoke
  runs in these jobs.

Workflow YAML/contracts and offline verification commands are tested locally,
not as a complete hosted checkout/provision/build job. A remote CI run and required
branch-protection check have not been verified/configured. No scheduled
automation, Dependabot or Renovate policy is installed by this work.

The separate module architecture gate still has its pre-existing
`architecture-document-set` conflict for `complete-ui-experience.md`. That
document is preserved; the canonical document policy is not relaxed or waived
by the provider maintenance workflow.

## Upstream review and unresolved evidence

Manual owners are expected to follow the ledger's weekly review and urgent triage policy.
Main-route source age is at most 14 days; other identities are reviewed monthly.
Review must record the source/date, affected provider/model/endpoint, impact,
test or decision, owner and next review. Compatible upstream fixes should retire
backports only after equivalent behavior regressions pass.

Current SambaNova OpenAPI 1.2.0 has a documentation conflict: the HTTP 200 summary
says `response.completed`, while the `stream` property says `data: [DONE]`.
`upstreamObservations` records this as live-evidence-needed, not a confirmed
production defect or successful live certification. An approved, cost-capped
wire receipt must resolve it; protocol completion checks are not weakened based
on ambiguous prose.

## Performance and release boundaries

[`scripts/provider-performance-baseline.js`](../../scripts/provider-performance-baseline.js)
records at least 30 raw samples, excluded warmups and nearest-rank p50/p95 for the
real Chat/Responses parser and Usage summary/snapshot logic on synthetic host
inputs. GC, CPU/OS/runtime, workload scales and memory-sampling conditions are
recorded. Memory is observed RSS/heap at operation boundaries, not in-operation
peak memory. Host load and thermal state are not certified.

The comparison guard requires matching environment, workload and sampling
conditions; the default p95/observed-memory ceiling is 110% of a comparable
baseline. A host-only parser/Usage result is not Android startup, scrolling or
memory qualification.

The latest host run starts after all owned test jobs finish. Each scenario has
30 raw latency samples and five excluded warmups, with forced GC before each
sample. Parser inputs have 1,000 text events per protocol; Usage uses 10,000
synthetic records, with a 100-record page for the in-memory snapshot repository.

| Host-only scenario | p50, ms | p95, ms |
| --- | --- | --- |
| Chat SSE parsing | 5.599 | 6.817 |
| Responses SSE parsing | 5.340 | 6.283 |
| Usage summary | 0.332 | 3.186 |
| Usage snapshot | 2.667 | 3.613 |

The raw report retains all 120 latency samples and RSS/heap observations.
Process memory includes Node and the TypeScript test harness, not just the
provider operation; these boundary observations are not application peak
memory. This establishes a baseline only: no comparison against mismatched
conditions or performance improvement is claimed.

G8 and the device portion of G9 remain pending. Required evidence includes:

- Explicit supplier/credential/model/endpoint/region approval and a fee ceiling,
  followed by actual streaming/tools/schema/replay receipts.
- Exact source revision plus dirty-input fingerprints, APK SHA-256, signing
  certificate and installed-package identity.
- Fixed device/OS/build/ABI, history/record/event scale, display conditions,
  cold/warm startup, Usage UI load, stream refresh and sampled peak memory.
- At least 30 raw latency samples per native scenario and independently reviewed
  raw-evidence digests, with measurement method/interval recorded.

Live-plan and Android-collector self-tests only validate those tools. Native
receipt schema/digest validation does not prove measurement truth or grant release
approval. No supplier inference, device qualification, APK publication, commit or
push is performed as part of this local verification.
