#!/usr/bin/env node
// The reading list Skill's front door. The `gh` transport and the data repo
// config live in tools/gh.mjs, shared with the Todos Skill; the parse, fold
// and serialize logic is the same lib/ the browser runs.
//
//   list.mjs where                          — show the configured data repo
//   list.mjs where <owner/repo>             — set it
//   list.mjs show [--json] [--archive]      — print the list
//   list.mjs missing [--json]               — Items with no Description
//   list.mjs add <url> [--title T] [--description D]
//   list.mjs describe <url> --description D — Backfill one Item
//   list.mjs read <url> | unread <url> | star <url> | unstar <url> | remove <url>
//
// The file it writes is links.md, always. Todos live in todos.md and have
// their own Skill — see .claude/skills/todos.

import { op } from '../../../lib/fold.js';
import { commit } from '../../../lib/sync.js';
import { LINKS } from '../../../lib/documents.js';
import { normalizeUrl, displayHost } from '../../../lib/normalize.js';
import { loadConfig, saveConfig, requireConfig, ghTransport, argsOf } from '../../../tools/gh.mjs';

const { command, positional, flag, has } = argsOf(process.argv.slice(2));
const config = loadConfig();

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

async function main() {
  if (!command || has('help')) return usage();

  if (command === 'where') {
    if (positional.length) {
      const [owner, repo] = positional[0].split('/');
      if (!owner || !repo) throw new Error('Give the data repo as owner/repo.');
      saveConfig({ owner, repo, branch: config.branch });
      console.log(`Data repo: ${owner}/${repo} @ ${config.branch}`);
      return;
    }
    if (!config.owner) throw new Error('No data repo set. Run: list.mjs where owner/repo');
    console.log(`${config.owner}/${config.repo}/${LINKS.path} @ ${config.branch}`);
    return;
  }

  requireConfig(config);
  const transport = ghTransport(config, LINKS);

  if (command === 'show' || command === 'missing') {
    const { text } = await transport.read();
    const items = LINKS.parse(text);
    const chosen =
      command === 'missing'
        ? items.filter((item) => !item.read && !item.description)
        : items.filter((item) => (has('archive') ? item.read : !item.read));

    if (has('json')) {
      console.log(JSON.stringify(chosen, null, 2));
      return;
    }
    if (!chosen.length) {
      console.log(command === 'missing' ? 'Every Item has a Description.' : 'Nothing here.');
      return;
    }
    for (const item of chosen) {
      console.log(`${item.star ? '★ ' : '  '}${item.title}`);
      console.log(`  ${item.url}`);
      if (item.description) console.log(`  ${item.description}`);
      console.log('');
    }
    return;
  }

  const url = positional[0];
  if (!url) throw new Error(`Give a URL: list.mjs ${command} <url>`);

  const operation = {
    add: () => op('add', url, { title: flag('title') ?? '', description: flag('description') || null }),
    describe: () => {
      const description = flag('description');
      if (!description) throw new Error('Give the Description: --description "…"');
      return op('add', url, { title: flag('title') ?? '', description });
    },
    read: () => op('setRead', url, { read: true }),
    unread: () => op('setRead', url, { read: false }),
    star: () => op('setStar', url, { star: true }),
    unstar: () => op('setStar', url, { star: false }),
    remove: () => op('remove', url),
  }[command];

  if (!operation) return usage(1);

  const pending = operation();
  const result = await commit(transport, [pending], { document: LINKS });
  const item = result.items.find((i) => i.url === normalizeUrl(url));

  const said = {
    add: item?.description ? 'Captured with a Description' : 'Captured — no Description yet',
    describe: 'Backfilled',
    read: 'Read',
    unread: 'Back on the reading list',
    star: 'Starred',
    unstar: 'Unstarred',
    remove: 'Removed',
  }[command];

  console.log(`${said}: ${item ? item.title : displayHost(normalizeUrl(url))}`);
  if (!result.wrote) console.log('(the list already said so)');
}

function usage(code = 0) {
  console.log(`reading list

  where [owner/repo]               show or set the private data repo
  show [--archive] [--json]        print the Reading List, or the Archive
  missing [--json]                 Items with no Description — the Backfill worklist
  add <url> [--title T] [--description D]
  describe <url> --description D   Backfill one Item
  read|unread|star|unstar|remove <url>

Todos are a different thing in a different file: .claude/skills/todos.
`);
  process.exit(code);
}
