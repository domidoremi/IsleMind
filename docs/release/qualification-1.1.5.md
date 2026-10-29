# 1.1.5 Candidate Preparation

Target: `1.1.5 / Android 130`, package `com.islemind.app`.
This is candidate preparation, not public artifact availability, Google Play
approval, or complete native feature qualification.

## Scope

- Configurable foreground checks and eligible release channels.
- Default-off APK preparation with separate network-policy consent.
- Quiet-time reminders and consent-bound idle installer handoff.
- Cumulative notes, cancellation fencing, and file revalidation.
- Top-only, single-surface, opacity-only transient feedback.
- Material empty-state action alignment and setup spacing.

## Evidence Boundaries

The preceding `1.1.4 / 129` debug-signed QA build passed source-matched host
regression and scoped native startup/Toast checks. Those receipts do not certify
the `1.1.5 / 130` production-signed APK or the full native feature matrix.
New results must identify their exact source revision and artifact digest.

The public download identity remains `1.1.2 / 127` until a new independently
qualified artifact is actually published. Do not update `updates/android.json`
to advertise a file that is only a local or Actions candidate.

## Build And Publication

The existing tag-bound Android workflow validates signing and uploads an Actions
artifact. Its `publish_release` input defaults to `false`. Public upload requires
separate approval, an existing owner-managed Release, and an unchanged build tag.
No candidate operation replaces existing public attachments.

An immutable source tag alone does not qualify startup, recovery, Providers,
themes, keyboard behavior, power/thermal behavior, privacy retention, or bundled
models. Keep R8/resource shrinking off until the documented exact-current
physical-device matrix qualifies that optimization.

Do not install a production-signed candidate over the user's debug-signed
installation without checking signer compatibility. A mismatch is not permission
to uninstall, clear data, migrate private storage, or change the production key.

## Publication Baseline

The release planner's publication state is independently owned. Public
source-only version labels do not establish a qualified APK/runtime receipt.
Keep `publication-state-required` unresolved rather than inventing a production
baseline, checkpoint, trust root, or catalog signature. Explicitly approved
candidate builds are a separate operation and do not set
`publicationApproved` or activate the signed-catalog runtime.
