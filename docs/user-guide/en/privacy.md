---
id: "privacy"
slug: "privacy"
title: "Data & privacy"
updatedAt: "2026-09-24"
reviewedAt: "2026-09-24"
reviewedSourceHash: "6bf383e7288849b79597f1bd3f135e9beb98f8f62d9e11a609325c5dcb86c973"
---
# Data & privacy

<a id="goal"></a>
## Outcome

Back up and restore safely with clear data boundaries.

<a id="steps"></a>
## Steps

![Choose, configure, confirm](../assets/setup-flow.svg)

1. Open Backup & restore, choose categories, and read sensitive-data warnings.

2. Check scope, counts, and differences before restore; back up first if unsure.

3. Edit access, proxy, and logs in their own entry; confirm targets before erase or reset.

<a id="success"></a>
## Success

Keep exported files secure; judge restore by its actual result.

<a id="troubleshooting"></a>
## Common problems

Never publish backups or raw logs; deleting device data does not delete provider copies.

<a id="advanced-policy"></a>
## Saving advanced configuration

Text fields such as proxy addresses, log limits, and access lists require explicit save. Blur, collapsing advanced sections, or reading the guide does not submit them. A Not saved entry reveals pending fields. Reload discards that field's input and reads committed values.

Connection targets, access rules, and log export change data boundaries and have no generic Undo. Before enabling external logs, check the destination and redaction scope. Unknown cost does not mean free. A failed save preserves input, but individual storage writes may already have completed; atomic rollback across credentials is not guaranteed.
