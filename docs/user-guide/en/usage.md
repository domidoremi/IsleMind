---
id: "usage"
slug: "usage"
title: "Usage & costs"
updatedAt: "2026-09-25"
reviewedAt: "2026-09-25"
reviewedSourceHash: "b43e329a9501465dc19acfc4a96a3213893d9799a85ab0800d904cfdf3b77567"
---
# Usage & costs

<a id="goal"></a>
## Outcome

Distinguish usage records from provider bills.

<a id="steps"></a>
## Steps

![Choose, configure, confirm](../assets/setup-flow.svg)

1. Open Models & answers → Usage and select the available period and scope.

2. Inspect requests and tokens, including failures, cancellations, and missing records.

3. Use provider bills for estimated or unknown costs; unknown is not free.

<a id="success"></a>
## Success

Metrics show trends, not authoritative billing.

<a id="troubleshooting"></a>
## Common problems

Check time range, pricing, and completeness; deleting local records does not cancel charges.

<a id="pricing-overrides"></a>
## Set an estimated price

1. Find Price overrides on the usage page and add an entry or edit an existing one.
2. Check the provider and model, then enter separate input and output prices per million tokens. The UI uses USD; this affects in-app estimates, not the provider's prices.
3. Choose Save and wait for the form to close. Negative, nonnumeric, and out-of-range values cannot be saved.

Input stays in the current editor. Blur and reading the guide do not save it. Closing or going back lets you keep editing or discard changes; Cancel discards the draft directly. While saving, the form cannot be submitted again or closed.

A failed save shows an error and retains input for correction and retry. If another edit or backup restore changed the price, reload the latest value before deciding what to change. Check unknown costs against the provider's bill; do not enter zero just to remove an unknown-cost indication.
