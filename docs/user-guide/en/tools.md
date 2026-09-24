---
id: "tools"
slug: "tools"
title: "Tools & automation"
updatedAt: "2026-09-24"
reviewedAt: "2026-09-24"
reviewedSourceHash: "57e861ba74d188877734d46287c894cede667274b2cb79563b01956781607a4a"
---
# Tools & automation

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
## Agent tasks

Create an Agent in Settings → Tools and automation → Agents, then open **Agent tasks**
from a conversation's options. Select an Agent and task type; ordinary chat does not
add independent review. Models without reliable action capability cannot mount tools.
Skills and imported definitions do not grant permissions or configure server credentials.

The task screen shows progress, shared model/tool/token budgets, children, reported
sources and any pending confirmation. Review the concrete operation and parameters
before approving. A source reported by a model is not automatically verified. Save a
completed result to Documents only with the explicit save action.

Background execution is optional and must be enabled for each run. Android battery
“Unrestricted” and locking the app in Recents may help, but OEMs can still kill it.
Waiting for you releases execution resources. A notification only opens the task.
After interruption, Continue rechecks admission; an unknown external effect cannot
be automatically replayed. Legacy records are read-only: start a new run with fresh
authorization instead. Agent definitions are included in Settings backups, but approvals
are not restored. Token totals may contain estimates; unknown prices are not zero.
