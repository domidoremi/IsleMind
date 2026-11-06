---
id: "models"
slug: "models"
title: "Models & answers"
updatedAt: "2026-11-06"
reviewedAt: "2026-11-06"
reviewedSourceHash: "50f062dcd3440f326c50c5f76d376debe4a69c3f431eaa0ce07287d6b3242a63"
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

Expand Connection references on the Connection tab to see conversations, routes, scenes and model preferences that use this connection, including its current-model, primary or backup role. Open a reference to inspect the corresponding configuration. This reads local configuration without testing a model. The report shows its capture time; refresh it for later changes. Unchecked saved conversations and unreadable configurations are marked separately, and local unsent drafts are included.

Before deleting a provider group, all connections or invalid connections, the confirmation includes reference counts and the checked scope. Retry a failed reference read; that attempt does not delete a connection. Deletion updates an affected default connection and removes its model favorites. Routes, scenes, conversation settings and the last model choice keep their original references until you explicitly choose a different model. Existing messages and execution records are retained.

<a id="routing"></a>
## Routing plans

Open Routing plans from model settings or connection management to save a fixed model or a primary with one backup. Each target uses the exact connection and model ID; display names help you identify it. The preview explains both targets and cross-connection consent. Saving a plan does not send a test request.

Selecting a plan in a chat's model picker stores a copy in that chat. Editing or deleting the saved template does not silently change chats that already use it; select the plan again to apply its new version. A backup on another connection asks by default for each request. Automatic switching requires an explicit choice, and capability, credential, cancellation and tool-continuation restrictions still apply.

Open request details from a reply receipt to inspect actual connection/model attempts, route outcomes and usage sources. Unreported upstream identities and measurements remain unknown. See [Requests and usage](usage.md) for more.

<a id="scenes"></a>
## Scene plans

Open Scene plans in Settings to save named configurations for research, writing or other recurring work. Save as a scene plan in the full AI configuration copies the current conversation's preferences; Choose a scene plan opens saved plans. The editor has Conversation, Resources and Context tabs. Save before selecting a plan.

Each field can Keep current. Use none closes the target conversation's corresponding tool or knowledge scope; Selected requires at least one item. The context threshold and tool declaration mode can inherit global settings or use a conversation override. Skill variables use typed values and defaults; complete required fields. Resource choices still follow permissions and feature switches. Provider built-in search and memory are managed separately in context settings.

Choose an existing or new conversation, then preview the application. Review exact connections and models, primary and backup routes, cross-connection consent, and before/after values. Missing references, access restrictions, invalid variables and a running conversation block application. Refresh the preview after relevant configuration changes. A failed save keeps your draft for Retry; a template conflict offers Reload or Save as new.

Apply saves an independent configuration copy in an existing conversation and retains its historical messages. A new conversation is an unsent draft; you still send its first message yourself. Preview, Save and Apply do not test providers or send a skill's first message. Editing or deleting a plan does not update conversations that already applied it. Last applied records provenance, not a live template link. Skills, tools and knowledge definitions remain in their current owner catalogs; preview and apply again when you want updated configuration.
