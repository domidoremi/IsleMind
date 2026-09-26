---
id: "search"
slug: "search"
title: "Search & retrieval"
updatedAt: "2026-09-25"
reviewedAt: "2026-09-25"
reviewedSourceHash: "c872ff6bcde90cafba49be57672f20256167b9f984d8a8fae70164f019f8aa75"
---
# Search & retrieval

<a id="goal"></a>
## Outcome

Choose an appropriate retrieval scope.

<a id="steps"></a>
## Steps

![Choose, configure, confirm](../assets/setup-flow.svg)

1. Open Knowledge & web → Context.

2. Choose an existing fast, balanced, deep, or offline profile and check its dependencies.

3. Try a question requiring references and inspect sources, not just answer length.

<a id="success"></a>
## Success

Retrieval uses sources permitted by the profile. Offline retrieval is not an app-wide network block.

<a id="troubleshooting"></a>
## Common problems

For empty results check indexing, search services, and access policies. More sources do not guarantee correctness.

<a id="dependencies"></a>
## Check the retrieval dependencies

Follow question → retrieval → relevant material → model answer. Check one stage at a time instead of changing every advanced parameter together.

| Stage | Check first |
|---|---|
| Local knowledge | Knowledge switch, completed indexing, filters excluding sources |
| Long-term memory | Memory switch, confirmed and active items |
| Web search | Selected service, required credentials and endpoint, network and access rules |
| Vectors and ranking | Model status shown on the page; absent or disabled does not mean ready |
| Final answer | Current chat model availability and whether references support the claims |

Start with an existing profile, then adjust advanced options for a specific need. A profile does not install missing models, configure credentials, or grant permission. Offline retrieval is not a privacy firewall: the chat model may still use a remote provider.

<a id="search-credentials"></a>
## Save search connection details

After choosing a search service, fill only the fields it requires. Google services may need both a key and search engine ID; a custom service may require an endpoint or Bearer credential. Follow the fields actually shown.

Save explicitly after entering the details. Blur and reading the guide do not submit them; resolve unsaved changes before switching services or leaving. Failed saves retain input. Do not paste keys again just because another page still shows the previous value. Connection tests, searches, and model calls may incur charges; unknown cost does not mean free.

See [Knowledge & memory](knowledge.md#import-and-check) for importing and review, and [Models & answers](models.md#troubleshooting) for errors such as 401 and 403.

<a id="context-compression"></a>
## Choose context compression

In Context, “Compress context with the current model” lets the selected model summarize earlier turns when the provider has no native compaction. Each model compaction sends one additional request, counts toward usage, and may incur charges. Turning it off uses local structured compression; it does not disable the chat model's normal requests.

Choose the switch according to your cost and context needs. No test request is sent when changing it. The switch shows the applied preference; check Usage after a conversation to see recorded requests. Unknown prices do not mean the service is free. If earlier details are missing, restate them in the conversation; compression cannot guarantee preserving every detail.

<a id="model-download-mirror"></a>
## Set a local model download mirror

Search settings for “mirror address”, or open Context → Retrieval mode → Local models. Enter a trusted mirror address and choose Save; an empty value uses the existing default download source. Saving the address does not start a download.

Collapsing the section or reading the guide retains unsaved input; blur does not submit it. When leaving, choose to keep editing or discard changes. Downloads use only the committed address, so an unsaved draft cannot be used to test a mirror.

If the summary says “Has errors”, reopen the section to check. Retry a failed save; if the address has changed elsewhere, reload the latest value before editing to avoid overwriting it. “Saved” appears only after persistence completes.
