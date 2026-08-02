# Actions are queued operations, replayed onto fresh state

The app must work with no signal (a reading list is most useful on a train) and must tolerate two independent writers (browser and Skill) hitting one file. Rather than solve these separately, user actions are recorded as **operations** — `add`, `setRead`, `setStar`, `remove` — queued locally and flushed by re-reading `links.md`, folding the queued ops onto whatever is currently there, and writing back. A stale-SHA 409 from the contents API simply means fold again against fresher content.

## Considered Options

- **Read offline, write online-only** — rejected: materially less code, but the one thing you want to do after reading something offline is mark it Read, and that is exactly what it forbids.
- **Online-only, last-write-wins** — rejected: smallest possible implementation, but a concurrent Skill write is silently discarded. Items you saved vanish with no error, which is the worst failure mode available.

## Consequences

- **Ops are idempotent for free,** because identity is the Normalized URL rather than a synthetic ID. Folding `add(url)` twice yields one Item, so replay needs no dedup bookkeeping. This is a direct payoff of choosing URL-as-identity.
- **Only `add` may create an Item.** A queued `setRead` for something removed on the other device must no-op, not resurrect it.
- **When folding an `add` onto an existing Item, a non-null Description beats a null one** regardless of arrival order. This is what lets Share Target Capture and Skill Backfill compose without ordering rules.
- **The UI needs a sync state** — pending ops must be visible, or the user cannot tell "saved" from "saved locally, not yet pushed."
- **Fold, parse and serialize are one shared module** used by both the app and the Skill. Two implementations of a hand-rolled markdown format would drift.
