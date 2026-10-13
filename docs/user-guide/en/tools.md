---
id: "tools"
slug: "tools"
title: "Tools & automation"
updatedAt: "2026-10-05"
reviewedAt: "2026-10-05"
reviewedSourceHash: "a96a0e72441574fc6b7aee6b79e347a068f4d3c582f4613100c79f9e176bd995"
---
# Tools & automation

<a id="unified-work"></a>
## Tools and code in one chat

Home has one input. Ordinary answers need no extra planning or independent review. Tool work uses the same Model + Harness, with existing permissions, budgets and per-operation approval. Reusable Agent definitions are advanced options, not a prerequisite for a first chat.

Code & files under the input’s + button lists app-owned workspace paths only when opened. Choosing a path adds it to the draft without sending or granting permission; after Send, authorized tools may read relevant content. Attachments or pasted code can also be used for advice. Where writing is supported, small-file changes show a complete diff before approval and recheck the revision. An unsafe or incomplete preview cannot be approved. Unsupported execution or tests are never claimed as completed.

The answer comes first. Actual activity is collapsed by default, and unused capabilities do not appear. Expand to inspect real records; pending approval, failures and uncertain effects remain visible. Collapsing does not stop work, and expanding does not retry requests.

<a id="goal"></a>
## Outcome

Configure Skills, MCP, agents, and execution limits.

<a id="steps"></a>
## Steps

![Choose, configure, confirm](../assets/setup-flow.svg)

1. Select the capability in Tools & automation.

2. Install an MCP template or enter a name and address and save. Check connection and tool permissions. Template installation may contact a remote service.

3. Limit workflow steps, calls per step, and output; validate with a low-risk task first.

<a id="success"></a>
## Success

Connection and execution approval are separate. Enabling does not mean every answer calls a tool.

<a id="troubleshooting"></a>
## Common problems

Check endpoint, network, approvals, and global switches. Deletion, paid actions, and external messages remain consequential.

<a id="skill-editor"></a>
## Edit a Skill

Start with the name, description, and system prompt. Expand advanced options only for model bindings, tool scope, or variables. Collapsing them keeps your input. Variables must use the JSON array format required by the editor; resolve the error state before saving.

Other pages use changes only after explicit save. Switching Skills or cancelling offers keep editing or discard. Unsaved drafts do not survive process termination. Importing a workflow does not approve execution; review permissions and approval status.

<a id="mcp-permissions"></a>
## MCP connection and authorization

Save a name and server address, then refresh the manifest when needed. Saving an address is not a connection check. Installing a template may immediately contact its remote address; review authentication and tool scope first.

Connected means a manifest is available, not that every tool is authorized. Approve tools individually and check the global MCP switch. Do not enable all write or destructive permissions just to fix an unavailable tool.

<a id="agent-tasks"></a>
## Agent tasks (advanced)

Create an Agent in Settings → Tools and automation → Agents, then open **Agent tasks**
from a conversation's options. Select an Agent and task type; ordinary chat does not
add independent review. Models without reliable action capability cannot mount tools.
Skills and imported definitions do not grant permissions or configure server credentials.

The task screen shows progress, shared model/tool/token budgets, children, reported
sources and any pending confirmation. Review the concrete operation and parameters
before approving. A source reported by a model is not automatically verified. Save a
completed result to Documents only with the explicit save action.

A single reply may propose several operations. The item position is a confirmation
queue, not approval for the entire batch. Check each source, destination and action.
Declining or expiry blocks that item and the remaining batch; completed operations
are not rolled back. An expired confirmation can only return a non-execution receipt.
A model's success claim is not proof of a file change: inspect each operation's target
URI, copied byte count and completed steps. For partial writes, missing receipts or
unknown outcomes, inspect the actual target before requesting another operation.

Background execution is optional and must be enabled for each run. Android battery
“Unrestricted” and locking the app in Recents may help, but OEMs can still kill it.
Waiting for you releases execution resources. A notification only opens the task.
After interruption, Continue rechecks admission; an unknown external effect cannot
be automatically replayed. Legacy records are read-only: start a new run with fresh
authorization instead. Agent definitions are included in Settings backups, but approvals
are not restored. Token totals may contain estimates; unknown prices are not zero.

Restarting a paused or confirmation-waiting run does not resume it automatically or
extend its approval deadline. Only resumable paused runs allow explicit continuation;
runs needing external-effect reconciliation and stopped runs cannot continue.
Stopping locally does not guarantee the provider stops billing. Interrupted requests
without complete usage may retain reserved or estimated budget across restarts.
