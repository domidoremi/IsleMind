---
id: "chat"
slug: "chat"
title: "Chat & attachments"
updatedAt: "2026-09-25"
reviewedAt: "2026-09-25"
reviewedSourceHash: "cb468bb15e4f3efbf9f990677c1d96a08335f2fa92df2364c8448e46a9242152"
---
# Chat & attachments

<a id="goal"></a>
## Outcome

Send messages and use files safely.

<a id="steps"></a>
## Steps

![Choose, configure, confirm](../assets/setup-flow.svg)

1. Choose or create a conversation and check the current model.

2. Attach a file and review its content and model compatibility before sending.

3. Stop generation if needed; use a new conversation for separate context.

<a id="success"></a>
## Success

Messages remain in the conversation. Successful parsing does not guarantee model understanding.

Activities above the reply follow the order in which they actually occur. Live labels update to completed wording after success; absent stages are not invented. Tap an activity with an arrow to independently expand or collapse its thinking summary, tool input, execution result, or search result. Only explicitly supplied display summaries are shown, never raw internal reasoning. Awaiting confirmation, failure, stopping, and skipping are not shown as successful execution; a model's tool request does not mean the tool has run.

<a id="troubleshooting"></a>
## Common problems

Check format, size, and permissions. Attachments may reach your provider; local deletion does not delete provider copies.
