---
id: "troubleshooting"
slug: "troubleshooting"
title: "Troubleshooting"
updatedAt: "2026-09-24"
reviewedAt: "2026-09-24"
reviewedSourceHash: "31bd832db7b810a2067acce75931425f681faf8db19db7f47e33300122054e9b"
---
# Troubleshooting

<a id="goal"></a>
## Outcome

Identify the failing stage before repair.

<a id="steps"></a>
## Steps

![Choose, configure, confirm](../assets/setup-flow.svg)

1. Open Help & maintenance → Diagnostics & repair.

2. Distinguish connection, permission, indexing, and tool failures; run only relevant repairs.

3. Report version, reproduction steps, and redacted errors. Back up before updates and use trusted sources.

<a id="success"></a>
## Success

Retry the original action; successful diagnostics do not prove every feature works.

<a id="troubleshooting"></a>
## Common problems

Avoid changing many settings at once; never share credentials. Reset and deletion are not universal repairs.

On Android, close the Network offline notice to keep editing settings or reading the offline guide. Closing only dismisses the notice; it does not reconnect or retry requests.

Changing Android's system font size may recreate the page and discard unsaved drafts. Save before changing the system font size.

### App updates

- In the GitHub APK edition, use Settings → Updates to check for updates. You can cancel during download or verification. Leaving this page also stops an update that has not reached the system installer; retrying downloads the file again.
- Failed checks can be retried immediately; repeated clicks do not start parallel downloads. No incompatible APK is downloaded when a matching device architecture is unavailable.
- File size and SHA-256 must pass verification before the installer opens. Opening the installer does not mean installation succeeded: follow the system prompts, or cancel there.
- The Google Play edition updates only through the store. Select “Update in Google Play” to open its listing; if it cannot open, search for IsleMind in the store.
