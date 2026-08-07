# Reading list

A single-user list of web pages to read later, captured from a Mac or an
Android phone and readable on both. The interface is a static site on GitHub
Pages; the list itself is `links.md` in a separate private repo.

The language of the app — Item, Capture, Backfill, Read, Remove, Star, Reading
List, Archive — is defined in [CONTEXT.md](./CONTEXT.md). The decisions behind
it are in [docs/adr](./docs/adr). This file is only about running it.

## What is here

```
index.html  app.js        the Reading List and the Archive
add.html    add.js        the Share Target — the phone's two-tap Capture
lib/                      parse, fold, serialize — shared by the app and the Skill
  normalize.js            the Normalized URL, and therefore Item identity
  markdown.js             the file format, hand-editable on purpose
  fold.js                 add / setRead / setStar / remove, folded onto state
  sync.js                 read → fold → write, retried against fresh state
  github.js               the browser's transport: contents API + PAT
  local.js                settings, the op queue, the offline cache
sw.js                     offline shell
.claude/skills/reading-list/   the Skill: the Mac's high-quality Capture path
tools/                    icon generation and a local preview server
test/                     the format, the fold, and concurrent writes
```

Two transports, one set of rules: the browser uses `fetch`, the Skill shells
out to `gh api`, and both drive `lib/`. Nothing in `lib/` imports anything.

## Set it up

### 1. The data repo

Create a **private** repo — `reading-list-data` is a reasonable name — with a
file `links.md` containing:

```markdown
# Reading list

## Archive
```

It must be separate from the repo serving the site, so that saving a link does
not trigger a Pages rebuild.

### 2. The site

Push this repo to GitHub and turn on Pages (Settings → Pages → deploy from
branch, root). There is no build step; the files are served as they are.

The site is normally at `https://<owner>.github.io/<repo>/`. If the account
already serves a Pages site on a custom domain, project sites inherit it
instead — this one is deployed at **https://hoopyfrood.dev/reading-list/**.
Whichever it is, that URL is what goes into Settings, the phone's home screen,
and the bookmarklet below. `gh api repos/<owner>/<repo>/pages --jq .html_url`
tells you which you got.

### 3. The token

Create a **fine-grained** personal access token
(github.com/settings/personal-access-tokens):

- Repository access: **only** the data repo
- Permissions: **Contents → Read and write**, nothing else
- Expiration: never — see [ADR-0001](./docs/adr/0001-private-github-repo-as-data-store.md)
  for why, and revoke it rather than rotating it

Open the site, and paste the owner, repo and token into Settings. They are
stored in that browser's local storage and nowhere else. Repeat once per
device.

### 4. The phone

Open the site in Chrome on Android and install it to the home screen. The
Share Target only appears in the system share sheet once the PWA is installed.
Sharing a page then Captures URL and Title in two taps. The Description
arrives about a minute later: the Capture commits `links.md`, and that commit
triggers `.github/workflows/backfill.yml` in the data repo, which Backfills it
without the Mac being involved.

### 5. The Skill

```bash
brew install gh && gh auth login
node .claude/skills/reading-list/list.mjs where hoopyfroody/reading-list-data links.md
```

The Skill authenticates as you, through `gh` — it never sees the browser's
token. It therefore only works where `gh` is authenticated, in practice the
Mac. Then, in Claude Code: *"save https://… to my reading list"*, or
*"backfill my reading list"*.

### A bookmarklet, if the Skill is too heavy on the desktop

```javascript
javascript:location.href='https://hoopyfrood.dev/reading-list/?url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title)
```

## Working on it

```bash
npm test        # the format, the fold, and two writers hitting one file
npm run serve   # http://localhost:4173
npm run icons   # regenerate the PWA PNGs from tools/make-icons.mjs
```

There is no toolchain: no bundler, no framework, no dependencies. The browser
loads `lib/` as ES modules directly, and Node runs the same files.

If you are iterating locally, unregister the service worker in DevTools first —
it serves the shell cache-first, so an edit otherwise shows up one reload late.

## Known inconsistency in the ADRs

[ADR-0002](./docs/adr/0002-two-capture-paths-with-backfill.md) refers to
`list.json` twice. ADR-0001 and ADR-0003 say `links.md`, and ADR-0001 argues
for markdown over JSON at length. The implementation follows the markdown
decision; the `list.json` mentions in ADR-0002 read as leftovers from an
earlier draft.
