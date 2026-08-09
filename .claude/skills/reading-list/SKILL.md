---
name: reading-list
description: Capture a web page to the reading list with a generated Description, backfill Descriptions for pages captured on the phone, or mark items read, starred or removed. Use when the user asks to save/read later/add a link, or says "backfill", "what's on my reading list", "mark X as read".
allowed-tools: Bash, WebFetch, mcp__claude-in-chrome__tabs_context_mcp, mcp__claude-in-chrome__navigate, mcp__claude-in-chrome__get_page_text
---

# Reading list

The high-quality Capture path. The list is a markdown file in a private GitHub
repo; this skill reads and writes it through `gh api`, using the existing
GitHub login. It never sees the browser's token.

All commands go through one script. Paths are relative to this skill's folder:

```bash
node .claude/skills/reading-list/list.mjs <command>
```

## Before anything else

The script needs to know which private repo holds the list:

```bash
node .claude/skills/reading-list/list.mjs where            # shows it
node .claude/skills/reading-list/list.mjs where me/reading-list-data links.md
```

If `gh` is missing or unauthenticated the script says so. The fix is
`brew install gh && gh auth login` — this skill only works where `gh` is
authenticated, in practice the Mac. Do not try to work around that; Capture
from the phone goes through the app's share sheet instead.

Unattended Backfill does not run here at all. It runs in GitHub Actions, in
the data repo — see `.github/workflows/backfill.yml` there. A phone Capture
commits `links.md`; that commit runs `captured.yml`, whose completion is what
starts Backfill (`claude-code-action` refuses to run on a `push` event). So an
Item usually has its Description within a minute of being Captured and nothing
has to be awake.
`gh` and `node` are preinstalled on the runner and `gh` authenticates from the
per-run `GITHUB_TOKEN`, so this same script runs there unmodified.

A scheduled *cloud routine* is not the place for it: that sandbox has no `gh`
binary and reaches GitHub only through the Claude GitHub App, not through a
credential a script can use.

## Capture

**Always generate a Description unless the user supplied one.** That is the
entire reason this path exists — the app cannot read a cross-origin page, so a
Description can only come from here.

1. Fetch the page with WebFetch.
2. Write the Description yourself: at most two sentences, plain, concrete.
   Never write a third sentence. Say what the page *is* and what it argues or
   offers — not "this article discusses". Never invent facts the page does
   not carry.
3. **Always write the Description in English**, whatever language the page is
   in and whatever language the user is speaking. A Dutch page gets an English
   Description. This keeps the list scannable as one thing.
4. Take the Title verbatim from the page. Never invent or improve it — the
   Title stays in the page's own language. Take only the part that *names* the
   page, though: many pages append a gloss after a separator, and a GitHub repo
   titles itself `owner/repo: <the entire repo description>`. The Title there
   is `owner/repo`; the description belongs in the Description, if anywhere.
   The script shortens anything over 80 characters anyway, so a Title that
   comes back with a `…` on the end means you passed a paragraph.

```bash
node .claude/skills/reading-list/list.mjs add "https://example.com/post" \
  --title "The exact page title" \
  --description "What it is, in a sentence or two."
```

If the page cannot be fetched (paywall, login, dead host), capture it anyway
with just the URL and whatever title you can honestly attribute, and tell the
user the Description is missing.

**Medium is a special case.** WebFetch hits Medium's login-wall redirect loop
(medium.com → the publication's custom domain → back to medium.com/m/global-identity-2)
and never reaches the article. Before giving up, try the user's actual browser
session instead — they may be logged in there:

```
mcp__claude-in-chrome__tabs_context_mcp   (createIfEmpty: true)
mcp__claude-in-chrome__navigate           (the article URL)
mcp__claude-in-chrome__get_page_text      (reads the rendered article text)
```

This reads through the user's real login, so it clears the paywall for
subscriber content. Write the Title and Description from that text the same
way as any other Capture. If the browser tools aren't available or the article
still isn't reachable, fall back to the URL-only capture above.

## Backfill

Items captured on the phone arrive with no Description, and their Title is
just the raw URL. Fill in both:

```bash
node .claude/skills/reading-list/list.mjs missing --json
```

Then, for each one, fetch the page and write the Title and Description the
same way Capture does: Title verbatim from the page, Description at most two
sentences, plain, concrete, and in English whatever the page's language.
**Always pass `--title`** — omitting it leaves the URL as the Title.

```bash
node .claude/skills/reading-list/list.mjs describe "https://example.com/post" \
  --title "The exact page title" \
  --description "What it is, in a sentence or two."
```

Work through them one at a time and report what you filled in. If the user
asks to backfill "the list" without qualification, do all of them, and say
which ones you could not reach.

Usually there is nothing to do, because the Action in the data repo has
already been through the list. Say so plainly rather than treating an empty
worklist as a problem.

## The rest

```bash
node .claude/skills/reading-list/list.mjs show               # the reading list
node .claude/skills/reading-list/list.mjs show --archive     # what has been read
node .claude/skills/reading-list/list.mjs read   "<url>"     # mark Read → moves to the Archive
node .claude/skills/reading-list/list.mjs unread "<url>"     # back onto the reading list
node .claude/skills/reading-list/list.mjs star   "<url>"     # pin above the rest
node .claude/skills/reading-list/list.mjs remove "<url>"     # destroy it and the record it existed
```

`remove` is destructive and distinct from `read`. Marking something Read keeps
it forever in the Archive; Remove does not. Never run `remove` because the user
said they finished something — confirm first if the wording is at all
ambiguous.

## Vocabulary

Use the app's words when you talk to the user: Item, Capture, Backfill, Read,
Remove, Star, Reading List, Archive, Description, Title. Say "Captured", not
"added" or "saved". Say "marked Read", not "removed" or "done".
