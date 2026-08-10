// The Skills' half of the transport: `gh api` against the same contents
// endpoint the browser uses, authenticated with the existing GitHub login.
// There is no second copy of the PAT — revoking the browser's token does not
// touch this path, and nothing needs keeping in sync.
//
// Both Skills — the reading list and the Todos — come through here. Transport
// differs from the browser's; logic does not. Parse, fold and serialize come
// from the same lib/ modules the app runs.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

import { StaleError } from '../lib/sync.js';

const run = promisify(execFile);

export const CONFIG = join(homedir(), '.config', 'reading-list', 'config.json');

/** Where the data repo is. The file names inside it are fixed — see lib/documents.js. */
export function loadConfig() {
  let stored = {};
  try {
    stored = JSON.parse(readFileSync(CONFIG, 'utf8'));
  } catch {
    // Not configured yet.
  }
  const [owner, repo] = (
    process.env.READING_LIST_REPO ?? `${stored.owner ?? ''}/${stored.repo ?? ''}`
  ).split('/');
  return {
    owner: owner || '',
    repo: repo || '',
    branch: process.env.READING_LIST_BRANCH ?? stored.branch ?? 'main',
  };
}

export function saveConfig(config) {
  mkdirSync(dirname(CONFIG), { recursive: true });
  writeFileSync(CONFIG, `${JSON.stringify(config, null, 2)}\n`);
}

export function requireConfig(config) {
  if (!config.owner || !config.repo) {
    throw new Error('No data repo set. Run: list.mjs where owner/repo');
  }
}

/**
 * @param {{owner: string, repo: string, branch: string}} config
 * @param {import('../lib/documents.js').Document} document
 * @returns {import('../lib/sync.js').Transport}
 */
export function ghTransport({ owner, repo, branch }, document) {
  const endpoint = `repos/${owner}/${repo}/contents/${document.path}`;

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

export async function gh(args) {
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

/** The flags both Skills parse the same way. */
export function argsOf(argv) {
  return {
    command: argv[0],
    positional: argv.slice(1).filter((a) => !a.startsWith('--')),
    flag: (name) => {
      const index = argv.indexOf(`--${name}`);
      return index === -1 ? null : argv[index + 1] ?? '';
    },
    has: (name) => argv.includes(`--${name}`),
  };
}
