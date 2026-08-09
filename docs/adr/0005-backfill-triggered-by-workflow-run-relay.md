# Backfill is triggered by a relay workflow, not by the commit itself

Unattended Backfill ([ADR-0004](./0004-skill-writes-via-gh-cli.md) left it a desktop activity; it since moved to GitHub Actions) is driven by `anthropics/claude-code-action`, which **refuses to run on the `push` event** — it throws `Unsupported event type: push` before doing any work. Its supported set is the comment, issue and pull-request events plus `schedule`, `workflow_dispatch`, `repository_dispatch` and `workflow_run`.

So the commit reaches Backfill second-hand. A phone Capture commits `links.md`, which runs `captured.yml` — a workflow whose only job is to succeed. Backfill triggers on `workflow_run` of `Captured`.

## Considered Options

- **`push` directly** — this is what we had, and it never worked. The failure was invisible for a while because the "Any Items missing a Description?" gate skips the Claude step when the list is complete, so runs with nothing to do were green.
- **`gh workflow run` from the push** — rejected: a `workflow_dispatch` sent with `GITHUB_TOKEN` does not start a new run, so this needs a PAT stored as a second secret. The relay needs no credential at all.
- **`schedule` alone** — rejected: the five-minute floor is not honoured in practice, and a Description arriving an unpredictable number of minutes after a Capture is a different product from one arriving in about a minute. The daily `schedule` stays as a backstop.

## Consequences

- **Two workflow files describe one behaviour.** `captured.yml` does nothing and exists only to be a supported event. Anyone reading `backfill.yml` alone will not see what starts it, so both files carry a comment pointing at the other.
- **One extra run per Capture, and a few seconds of latency.** `Captured` takes about five seconds. Well inside the "about a minute" the README promises.
- **Loop safety is unchanged, for the same reason as before.** Backfill writes with `GITHUB_TOKEN`, and commits made with that token start no workflow runs — so Backfill's own write never starts `Captured`, and cannot retrigger itself.
- **The trigger is now coupled to a workflow *name*.** Renaming `Captured` silently stops Backfill; the `workflows:` list matches on the name, not the filename.
- **Revisit if the action ever supports `push`.** The relay is a workaround for one missing case in someone else's event switch, not a design we would choose.
