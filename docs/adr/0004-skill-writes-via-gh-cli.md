# The Skill writes via `gh`, and is therefore Mac-only

The Skill uses `gh api` against the same contents endpoint the browser uses, authenticating with the existing GitHub login rather than a second copy of the PAT. `gh` is not currently installed, so setup requires `brew install gh` plus `gh auth login`.

## Consequences

- **No second copy of the credential.** The PAT exists only in browser local storage; the Skill never sees it, and there is nothing to keep in sync when it is revoked.
- **The Skill only works where `gh` is authenticated — in practice, the Mac.** Cloud and mobile Claude Code environments cannot run it. This is acceptable *only because* Android Capture goes through the Share Target ([ADR-0002](./0002-two-capture-paths-with-backfill.md)). If the Share Target were ever dropped, this decision would need revisiting first.
- **Backfill is a desktop activity.** Items Captured on the phone stay Description-less until you are next at the Mac.
- **Transport differs, logic does not.** The Skill shells out to `gh api` while the app uses `fetch`, but both drive the same parse/fold/serialize module. Only the transport layer is written twice.
