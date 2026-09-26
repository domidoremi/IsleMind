---
id: "documents"
slug: "documents"
title: "Documents"
updatedAt: "2026-09-25"
reviewedAt: "2026-09-25"
reviewedSourceHash: "fa8e0cec78f51097eeee6463ce8de767fa63293860030e27d08e09928d38c23f"
---
# Documents

<a id="goal"></a>
## Outcome

Keep material for further editing.

<a id="steps"></a>
## Steps

![Choose, configure, confirm](../assets/setup-flow.svg)

1. Create or open a document in the document list.

2. Edit title and body, preview, and save.

3. For revision conflicts, reload or save a copy instead of overwriting newer content.

<a id="success"></a>
## Success

Saved documents can be reopened; unsaved input is not a backup.

<a id="troubleshooting"></a>
## Common problems

Retain input on save failure and inspect the error. Check privacy and credentials before sharing.

<a id="save-and-reuse"></a>
## Turn a chat answer into a document

Create a blank document from the library, or turn a finished assistant response into a document draft. Review its title and body, then save. Opening a draft or switching to preview does not acknowledge a successful save.

A document is independent: editing it does not rewrite chat, and deleting the chat does not delete a saved document. Documents created from responses can show their origin and original status. Origin information does not certify accuracy or task success.

Preview does not automatically load remote images. Copying the body copies text without the attached origin records. Check for private information before copying, sharing, or opening external links.

<a id="review-revisions"></a>
## Review a model's proposed changes

1. Open revision suggestions, choose an available model, and enter a specific instruction. Generating a suggestion calls the selected provider and may incur charges.
2. To use references, read and check their current content before selecting them for this request. Sources may have changed since the original answer.
3. Compare the original and proposed text; check facts, omissions, and citations. Accepting changes updates only the current draft. Save separately.
4. Only the explicit option to accept with review context attaches snapshots of the selected sources to the draft. Ordinary acceptance does not retain those additional copies.

Leaving the page or moving the app to the background cancels ongoing suggestion generation. If a proposal is stale or another operation changed the document, check the current version before generating again. Do not overwrite newer content with an old proposal.

<a id="save-conflicts"></a>
## Handle save failures and conflicts

On failure, retain the input, inspect the error, and retry. For a version conflict, Reload reads the latest saved version and discards local changes; Save a copy keeps the current content as a separate document. Decide which content to retain before choosing.

Unsaved drafts do not survive process termination. Saving a document and [backing up data](privacy.md#steps) are different actions; a save is not an off-device backup.
