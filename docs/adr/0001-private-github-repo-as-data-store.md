# Private GitHub repo as the data store

The app is a static site on GitHub Pages, so there is no server to hold state — but the list must be shared across a Mac and an Android phone. We store the list as a **markdown file in a separate private GitHub repo**, read and written from the browser via the GitHub contents API using a fine-grained PAT that is pasted once per device and kept in local storage.

Markdown rather than JSON is deliberate: diffs stay readable, the file can be annotated by hand, and — because the repo is private but still a GitHub repo — `links.md` is viewable and editable in the GitHub mobile app, giving a free emergency UI that a JSON blob would not.

## Considered Options

- **GitHub Issues as the store** — rejected: if Issues already models this, the app has little reason to exist, and ordering/API shape are awkward.
- **Supabase or similar BaaS** — rejected: real auth and realtime sync, but adds an account, a vendor, and free-tier terms that can change. More machinery than the problem needs.
- **Secret Gist** — rejected: simpler API, but "secret" means unguessable-URL, not access-controlled.
- **Public data repo** — rejected: reads would need no token at all (instant paint, survives PAT expiry), but it publishes both the list and a timestamped commit log of reading habits. A local cache recovers most of the read-latency benefit anyway.

## Consequences

- **The data repo is separate from the Pages repo on purpose.** Data commits must not trigger a Pages rebuild.
- **Conflict detection comes free.** The contents API requires the blob SHA on write and rejects stale ones, giving optimistic concurrency without inventing a protocol.
- **A repo-write token lives in the browser on a public origin.** The PAT must be fine-grained and scoped to contents:read+write on the data repo only. The app must never render item text as HTML — an XSS on the Pages origin exfiltrates the token.
- **The app cannot show anything on a fresh device until the token is pasted.**
- **The PAT is deliberately set to never expire.** Rotation every 366 days across two devices is a chore that would eventually go undone, leaving the app broken rather than secure. The accepted blast radius is contents:read+write on one private repo of saved links; the mitigation is revocation-on-demand, not expiry. Revisit if the token ever gains scope beyond the data repo.
- **The contents API caps inline blobs at 1 MB.** That is the ceiling on list size before the blobs API becomes necessary.
