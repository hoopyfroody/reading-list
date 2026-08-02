# Two Capture paths, reconciled by Backfill

A static browser app cannot read a cross-origin page, so it cannot derive a Description from a bare URL — CORS forbids it. Rather than introduce a proxy or metadata service, Capture happens through two paths that each sidestep the constraint: a **Claude Code Skill**, which can fetch the page and generate a Description, and an Android **Share Target**, which gets URL and Title free from the sharing app. Items Captured via the Share Target have no Description until the Skill **Backfills** them.

## Considered Options

- **Skill only** — rejected: one code path and uniformly good Descriptions, but Capture costs ~30s and needs connectivity. Links encountered in passing would simply be lost, and an empty reading list is a failed one.
- **Share Target / paste only** — rejected: cheap Capture, but Titles alone make the list a wall of links.
- **CORS proxy or metadata service** — rejected: sends every saved URL to a third party and adds a dependency that can rate-limit or vanish, in an app whose premise is having no backend.

## Consequences

- **`description` is nullable in the Item schema,** and the UI must read well without one.
- **There are two independent writers** to `list.json` — the browser (contents API, PAT in local storage) and the Skill (`gh`, using existing local auth). Stale-SHA conflict handling from [ADR-0001](./0001-private-github-repo-as-data-store.md) is therefore load-bearing, not theoretical.
- **The app needs an `/add` route** to receive share-sheet intents, and must be installed to the Android home screen for the Share Target to appear.
- **A Mac bookmarklet is nearly free** once `/add` exists, should the Skill prove too heavy on the desktop.
