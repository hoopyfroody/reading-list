#!/usr/bin/env node
// The Skill's half of the transport: `gh api` against the same contents
// endpoint the browser uses, authenticated with the existing GitHub login.
// There is no second copy of the PAT — revoking the browser's token does not
// touch this path, and nothing needs keeping in sync.
//
// Transport differs; logic does not. Parse, fold and serialize come from the
// same module the app runs.
//
//   list.mjs where                          — show the configured data repo
//   list.mjs where <owner/repo> [path]      — set it
//   list.mjs show [--json] [--archive]      — print the list
//   list.mjs missing [--json]               — Items with no Description
//   list.mjs add <url> [--title T] [--description D]
//   list.mjs describe <url> --description D — Backfill one Item
//   list.mjs read <url> | unread <url> | star <url> | unstar <url> | remove <url>

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

import { parse } from '../../../lib/markdown.js';
import { op } from '../../../lib/fold.js';
import { commit, StaleError } from '../../../lib/sync.js';
import { normalizeUrl, displayHost } from '../../../lib/normalize.js';

const run = promisify(execFile);
const CONFIG = join(homedir(), '.config', 'reading-list', 'config.json');

/* ── Configuration ──────────────────────────────────────────────────────── */

function loadConfig() {
  const fromEnv = process.env.READING_LIST_REPO;
  let stored = {};
  try {
    stored = JSON.parse(readFileSync(CONFIG, 'utf8'));
  } catch {
    // Not configured yet.
  }
  const [owner, repo] = (fromEnv ?? `${stored.owner ?? ''}/${stored.repo ?? ''}`).split('/');
  return {
    owner: owner || '',
    repo: repo || '',
    path: process.env.READING_LIST_PATH ?? stored.path ?? 'links.md',
    branch: process.env.READING_LIST_BRANCH ?? stored.branch ?? 'main',
  };
}

function saveConfig(config) {
  mkdirSync(dirname(CONFIG), { recursive: true });
  writeFileSync(CONFIG, `${JSON.stringify(config, null, 2)}\n`);
}

/* ── Transport ──────────────────────────────────────────────────────────── */

function ghTransport({ owner, repo, path, branch }) {
  const endpoint = `repos/${owner}/${repo}/contents/${path}`;

  return {
    async read() {
      try {
        const { stdout } = await gh(['api', `${endpoint}?ref=${branch}`]);
        const body = JSON.parse(stdout);
        return { text: Buffer.from(body.content ?? '', 'base64').toString('utf8'), sha: body.sha ?? null };
      } catch (error) {
        if (/HTTP 404/.test(error.message)) return { text: '', sha: null };
        throw error;
      }
    },

    async write(text, sha, message) {
      const args = [
        'api',
        '--method',
        'PUT',
        endpoint,
        '-f',
        `message=${message}`,
        '-f',
        `content=${Buffer.from(text, 'utf8').toString('base64')}`,
        '-f',
        `branch=${branch}`,
      ];
      if (sha) args.push('-f', `sha=${sha}`);

      try {
        const { stdout } = await gh(args);
        return { sha: JSON.parse(stdout).content?.sha ?? null };
      } catch (error) {
        // Someone wrote in between — the browser on the phone, most likely.
        if (/HTTP (409|422)/.test(error.message)) throw new StaleError(error.message);
        throw error;
      }
    },
  };
}

async function gh(args) {
  try {
    return await run('gh', args, { maxBuffer: 8 * 1024 * 1024 });
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('`gh` is not installed. Run: brew install gh && gh auth login');
    }
    const detail = `${error.stderr ?? ''}`.trim() || error.message;
    if (/gh auth login|authentication/i.test(detail)) {
      throw new Error('`gh` is not authenticated. Run: gh auth login');
    }
    throw new Error(detail);
  }
}

/* ── Commands ───────────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const command = argv[0];
const positional = argv.slice(1).filter((a) => !a.startsWith('--'));
const flag = (name) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? null : argv[index + 1] ?? '';
};
const has = (name) => argv.includes(`--${name}`);

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
      const [slug, path] = positional;
      const [owner, repo] = slug.split('/');
      if (!owner || !repo) throw new Error('Give the data repo as owner/repo.');
      saveConfig({ owner, repo, path: path ?? config.path, branch: config.branch });
      console.log(`Data repo: ${owner}/${repo}/${path ?? config.path} @ ${config.branch}`);
      return;
    }
    if (!config.owner) throw new Error('No data repo set. Run: list.mjs where owner/repo');
    console.log(`${config.owner}/${config.repo}/${config.path} @ ${config.branch}`);
    return;
  }

  requireConfig();
  const transport = ghTransport(config);

  if (command === 'show' || command === 'missing') {
    const { text } = await transport.read();
    const items = parse(text);
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
  const result = await commit(transport, [pending]);
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

function requireConfig() {
  if (!config.owner || !config.repo) {
    throw new Error('No data repo set. Run: list.mjs where owner/repo');
  }
}

function usage(code = 0) {
  console.log(`reading list

  where [owner/repo] [path]        show or set the private data repo
  show [--archive] [--json]        print the Reading List, or the Archive
  missing [--json]                 Items with no Description — the Backfill worklist
  add <url> [--title T] [--description D]
  describe <url> --description D   Backfill one Item
  read|unread|star|unstar|remove <url>
`);
  process.exit(code);
}
