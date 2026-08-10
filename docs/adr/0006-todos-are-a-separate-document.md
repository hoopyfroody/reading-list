# Todos are a separate document, not a kind of Item

The app now holds a second thing: Todos. A Todo is a sentence you wrote to yourself — "call the dentist" — and it has no URL.

That single fact decides everything. An Item's identity *is* its Normalized URL ([ADR-0001](./0001-private-github-repo-as-data-store.md)), and the whole codebase leans on it: `dedupe()` collapses by URL, `fold()` finds by URL, the op queue replays safely because folding `add(url)` twice yields one Item, and the Skill addresses everything by URL. A URL-less thing in that world needs a synthetic key, and a synthetic key that is never a real URL turns every one of those invariants into "URL, except when it isn't".

So Todos get their own document — `todos.md`, in the same private data repo — their own page (`todos.html`), their own parse/serialize pair, their own fold, and their own Skill. What they share is the plumbing: the transport, the token, the op queue, the replay-on-conflict loop, and the PWA shell. `commit()` now takes a *document* — parse, serialize, foldAll, messageFor — and is blind to which one it is driving.

## Considered Options

- **A `## Todos` section inside `links.md`** — rejected. One file means one SHA, so every tick of a Todo races every Capture for the same write, and each retry re-reads a document twice the size for no reason. It also puts non-Items inside the file whose entire contract is "these are Items", and it would wake the Backfill relay in the data repo on every Todo write — `captured.yml` filters on `paths: ['links.md']`, so a separate file costs nothing there.
- **Todos as Items with a synthetic URL** (`todo:call-the-dentist`) — rejected. `normalizeUrl` refuses non-http schemes on purpose, and loosening it to admit a fake one would weaken Item identity to buy a shortcut.
- **A separate repo for Todos** — rejected. A second repo means a second token, a second Settings dialog, and a second thing to configure on every device, in exchange for an isolation that separate files already provide.
- **A tab inside `index.html`** — rejected. `app.js` would carry two domains, and Todos would have no URL of their own to put on a home screen.

## Consequences

- **The path setting is gone.** There were two documents to name and no reason to name either; `links.md` and `todos.md` are now fixed in `lib/documents.js`. Settings holds owner, repo, branch and token, and `configured()` no longer asks about a path. `list.mjs where` takes just `owner/repo`, and `READING_LIST_PATH` — read by `backfill.yml` in the data repo — is no longer read by anything.
- **The token gates both documents, and nothing else does.** The data repo is private, so there is no read path without the PAT. Todos inherit that gate rather than adding one: `todos.html` redirects to the list when there is no token, and the list hides its Todos link until there is one. A second passphrase was considered and rejected as theatre — anyone holding the token can read the file on github.com anyway.
- **One queue and one cache per document**, namespaced in local storage, so a pending Todo never rides along with a Capture. The old unnamespaced keys are migrated once, because a queued op is a Capture nobody made twice.
- **Two Skills, one engine.** `tools/gh.mjs` holds the `gh` transport and the data-repo config; `list.mjs` and `todos.mjs` are front doors over it. Splitting them keeps each skill's `description` sharp — "save this link" and "remind me to call the dentist" should never pick the same one.
- **`Done` is now a reserved word.** CONTEXT.md banned it as a synonym for Read, to protect the Read/Remove distinction. It now belongs to Todos and stays out of the Item vocabulary entirely, which is a stronger rule than before, not a weaker one.
- **Todos run oldest first**, opposite to the Reading List. Different pathology: an unread article going stale at the bottom of a list is fine, and a Todo you are dodging sinking out of sight is the failure mode.
- **Revisit if a Todo ever needs a due date.** It has none deliberately — there is no server, so nothing can fire a reminder, and a date you have to remember to look at is not a reminder. Adding one later is easy; removing one you have started relying on is not.
