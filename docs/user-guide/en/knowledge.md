---
id: "knowledge"
slug: "knowledge"
title: "Knowledge & memory"
updatedAt: "2026-09-25"
reviewedAt: "2026-09-25"
reviewedSourceHash: "a8511d985a8fdcc56dc4337f19a997f2fc3df3952710ad6df6636336876ee8be"
---
# Knowledge & memory

<a id="goal"></a>
## Outcome

Import reference material and review long-term memory.

<a id="steps"></a>
## Steps

![Choose, configure, confirm](../assets/setup-flow.svg)

1. Open Knowledge & web → Knowledge, import material, and track parsing and indexing.

2. Check content and filters, then verify relevant references in chat.

3. Review pending memories and approve only accurate information worth retaining.

<a id="success"></a>
## Success

Indexed material is retrievable; approved memories follow current policy.

<a id="troubleshooting"></a>
## Common problems

For import failures check format, capacity, and model dependencies. Rejecting memory does not delete source files.

<a id="import-and-check"></a>
## Import your first source

1. In Knowledge, choose the file import action. For a text excerpt, expand the paste-text area, enter its title and body, then import it.
2. Check the source list. **Indexing** is unfinished; **Failed** needs an error check; **Empty content** is not usable material. A file appearing in the list does not mean processing succeeded.
3. For a large library, expand filters and search by status or keyword. Clear filters before importing a file again just because no matching item appears.
4. Return to chat, ask about a specific fact in the source, and open the answer's references to check the original. Successful indexing makes a source searchable; it does not guarantee a match for every question.

See [Search & retrieval](search.md#dependencies) for scope and model requirements. Sources may enter model context; check for information that should not be sent to the selected provider before importing.

<a id="review-memory"></a>
## Review and disable memories

Open Memory and check pending, active, and disabled counts before expanding the review queue. Filter by source or low confidence when helpful. Confidence is a signal, not proof of accuracy.

Review each item before confirming it. Before a batch action, check whether its label refers to the current filter or all pending items, and verify the count. Disable outdated memories and restore them when appropriate; these actions do not edit the original chat or knowledge file.

If a memory is absent from an answer, check the memory switch, item status, and retrieval scope first. Do not approve incorrect information to increase matches.
