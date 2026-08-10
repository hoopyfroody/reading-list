---
name: todos
description: Add a Todo, tick one off, or say what is on the todo list. Use when the user says "remind me to…", "add a todo", "put X on my todo list", "what do I have to do", "mark X done", or "I finished X". Not for web pages to read later — that is the reading-list skill.
allowed-tools: Bash
---

# Todos

A Todo is a thing to do. It has no URL, and it is **not** an Item — it lives in
`todos.md`, a different file in the same private data repo, and nothing about
the reading list applies to it. If the user hands you a web page to read later,
that is a Capture: use the `reading-list` skill instead.

All commands go through one script. Paths are relative to this skill's folder:

```bash
node .claude/skills/todos/todos.mjs <command>
```

## Before anything else

The script uses the reading list's data repo. If it says none is set:

```bash
node .claude/skills/reading-list/list.mjs where me/reading-list-data
```

If `gh` is missing or unauthenticated the script says so. The fix is
`brew install gh && gh auth login` — this skill only works where `gh` is
authenticated, in practice the Mac. On the phone, the Todos page in the app is
the way in.

## Add

```bash
node .claude/skills/todos/todos.mjs add "Call the dentist"
```

Write the Todo the way the user said it. Do not expand it, do not add a date
the user did not give, and do not turn one sentence into three. "Call the
dentist" is a finished Todo; "Call the dentist to arrange the six-month
check-up" is you inventing the appointment.

One Todo per command. If the user lists several things, run the command once
per thing.

A Todo may mention a URL — "read https://… before Thursday" — and that is
fine, it stays plain text. But a bare URL with nothing else is a page to read,
not a Todo: Capture it with the `reading-list` skill instead, and say that you
did.

Adding text that is already Done brings it back to the live list. That is
deliberate — recurring chores come round again.

## Tick things off

```bash
node .claude/skills/todos/todos.mjs done   "dentist"    # → Done
node .claude/skills/todos/todos.mjs undone "dentist"    # → back on the list
node .claude/skills/todos/todos.mjs remove "dentist"    # → destroyed
```

You do not have to retype a Todo exactly: the script matches an exact text
first, then a unique substring, and refuses when more than one Todo matches
rather than guessing. If it refuses, show the user the candidates it listed and
ask which one.

`remove` is destructive and distinct from `done`. Done keeps the Todo forever
under the Done heading; Remove does not. Never run `remove` because the user
said they finished something — that is `done`. If the wording is at all
ambiguous, confirm first.

## What is on the list

```bash
node .claude/skills/todos/todos.mjs list            # what is still to do
node .claude/skills/todos/todos.mjs list --done     # what has been finished
node .claude/skills/todos/todos.mjs list --json     # for when you need to pick one
```

The list runs oldest first, on purpose: the thing at the top is the thing that
has been waiting longest. Read it back in that order — do not sort it, and do
not editorialise about how long something has been there.

## Vocabulary

Use the app's words: **Todo**, **Done**, **Remove**. Say "added a Todo", not
"created a task" or "set a reminder". Say "marked it Done", not "completed" or
"checked it off the list". A Todo is never an Item, and the Todos are never the
Reading List.
