---
id: "models"
slug: "models"
title: "Models & answers"
updatedAt: "2026-09-24"
reviewedAt: "2026-09-24"
reviewedSourceHash: "fc35fbf27b3169c3642377e0e1958f2555f812a9e671b420389eee34c1c63e3c"
---
# Models & answers

<a id="goal"></a>
## Outcome

Configure providers and generation parameters.

<a id="steps"></a>
## Steps

![Choose, configure, confirm](../assets/setup-flow.svg)

1. Choose a provider, then enter connection details. Use an API base address, not the sign-in page.

2. Enter credentials and models, review, and save. Reading the guide does not submit drafts; leaving offers keep editing or discard.

3. Keep model defaults or explicitly customize temperature and output limits.

<a id="success"></a>
## Success

Other screens read committed values. Saving does not imply connectivity or free usage.

<a id="troubleshooting"></a>
## Common problems

For 401/403 check credentials and permission; for 404 check address, protocol, and model. Redact keys from screenshots.

<a id="generation"></a>
## Generation parameters

- **Model default** omits the custom value. The model and provider decide; this is not one universal number.
- **Custom** offers a preview slider, step buttons, and exact input. Releasing the slider commits once; interrupted gestures do not write. Exact input requires Save and uses the existing range validation. Blur, folding, and reading the guide do not submit it.
- Save or reload pending exact input before using the slider, step buttons, or default selector, so those actions cannot overwrite your draft. Workflow numbers and the assistant name also require explicit saving.
- Temperature affects sampling, not factual accuracy. A larger output ceiling can increase usage; the model may impose a lower effective limit.
- Undo restores committed preferences only where a later edit has not changed the same field.

<a id="editing"></a>
## Connection drafts and save failures

Open an existing provider to edit its connection, credentials, and models directly. The guide opens above the current editor without saving. Leaving or closing offers Keep editing or Discard changes.

Saved means persistence completed. A failure keeps your input for retry. On an external-change warning, discard the draft and reopen rather than overwriting newer configuration. Saving does not automatically test or enable a provider. Model tests and usage queries are separate explicit actions and may contact or incur charges from the provider.

Batch import also waits for saving to finish before asking whether to enable providers. If configuration was applied but saving failed, the window keeps your input and offers Retry without adding duplicates or overwriting later changes. Closing at that point does not undo applied data. Discarding an unsubmitted draft clears it; late file or clipboard reads cannot restore it.
