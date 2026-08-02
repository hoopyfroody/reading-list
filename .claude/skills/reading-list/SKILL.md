---
name: reading-list
description: Capture a web page to the reading list with a generated Description, backfill Descriptions for pages captured on the phone, or mark items read, starred or removed. Use when the user asks to save/read later/add a link, or says "backfill", "what's on my reading list", "mark X as read".
allowed-tools: Bash, WebFetch
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

## Capture

**Always generate a Description unless the user supplied one.** That is the
entire reason this path exists — the app cannot read a cross-origin page, so a
Description can only come from here.

1. Fetch the page with WebFetch.
2. Write the Description yourself: one or two sentences, plain, concrete. Say
   what the page *is* and what it argues or offers — not "this article
   discusses". Never invent facts the page does not carry.
3. **Always write the Description in English**, whatever language the page is
   in and whatever language the user is speaking. A Dutch page gets an English
   Description. This keeps the list scannable as one thing.
4. Take the Title verbatim from the page. Never invent or improve it — the
   Title stays in the page's own language.

```bash
node .claude/skills/reading-list/list.mjs add "https://example.com/post" \
  --title "The exact page title" \
  --description "What it is, in a sentence or two."
```

If the page cannot be fetched (paywall, login, dead host), capture it anyway
with just the URL and whatever title you can honestly attribute, and tell the
user the Description is missing.

## Backfill

Items captured on the phone arrive with no Description, and their Title is
just the raw URL. Fill in both:

```bash
node .claude/skills/reading-list/list.mjs missing --json
```

Then, for each one, fetch the page and write the Title and Description the
same way Capture does: Title verbatim from the page, Description plain,
concrete, and in English whatever the page's language. **Always pass
`--title`** — omitting it leaves the URL as the Title.

```bash
node .claude/skills/reading-list/list.mjs describe "https://example.com/post" \
  --title "The exact page title" \
  --description "What it is, in a sentence or two."
```

Work through them one at a time and report what you filled in. If the user
asks to backfill "the list" without qualification, do all of them, and say
which ones you could not reach.

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
