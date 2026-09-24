---
id: "models"
slug: "models"
title: "Models & answers"
updatedAt: "2026-09-24"
reviewedAt: "2026-09-24"
reviewedSourceHash: "0a20fa683aa80c243aec783ba6d1fd3fcc9f9d956f0fa8f464d119045dafd906"
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
- **Custom** offers a preview slider, step buttons, and exact input. Releasing the slider commits once; interrupted gestures do not write. Completed exact input uses the existing range validation.
- Temperature affects sampling, not factual accuracy. A larger output ceiling can increase usage; the model may impose a lower effective limit.
- Undo restores committed preferences only where a later edit has not changed the same field.

<a id="editing"></a>
## Connection drafts and save failures

Open an existing provider to edit its connection, credentials, and models directly. The guide opens above the current editor without saving. Leaving or closing offers Keep editing or Discard changes.

Saved means persistence completed. A failure keeps your input for retry. On an external-change warning, discard the draft and reopen rather than overwriting newer configuration. Saving does not automatically test or enable a provider. Model tests and usage queries are separate explicit actions and may contact or incur charges from the provider.
