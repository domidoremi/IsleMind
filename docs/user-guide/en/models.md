---
id: "models"
slug: "models"
title: "Models & answers"
updatedAt: "2026-10-05"
reviewedAt: "2026-10-05"
reviewedSourceHash: "496acde5496b4415906e6eff3ad43d9e8c654ba156497853070ace000fab6f49"
---
# Models & answers

<a id="goal"></a>
## Outcome

Configure providers and generation parameters.

<a id="steps"></a>
## Steps

![Choose, configure, confirm](../assets/setup-flow.svg)

1. Choose Add in the provider list, then import configuration or add manually. Review names, addresses, models and hidden-credential counts locally before importing. Skip matching connections or save additional copies without overwriting existing settings.

2. After saving, choose a model for new chats on the Models page. Add a model ID manually if necessary; no health probe is required.

3. For daily switching, use the model selector on Home. Connection contains the name, address and credential editor; advanced settings and batch management stay out of the main flow.

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

Connection, credentials and models share one draft; changing tabs keeps the input. Replacement credentials are hidden by default, a blank replacement keeps the saved credential, and Save commits the changes. Persistence failures keep the draft. If another operation changed the configuration, reopen and review it rather than overwriting newer values. Saving and model selection do not run health probes. Selection success means local preferences are durable, not that a network connection succeeded; existing chats are unchanged.

Import is review then save, with no invitation to enable and test every connection. If data was applied but persistence failed, Retry does not duplicate imports or undo subsequent changes. Closing does not undo data already applied. Unsubmitted input is cleared only after explicit discard.

Fetching a model list and manually querying usage are separate network actions; opening a page or saving does not run them. Save the usage configuration before querying. A manual query makes at most one request and displays the returned numbers. Historical failures remain warnings: a network failure does not prove a bad credential or require a new probe before selecting a model.
