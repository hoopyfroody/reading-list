// Read the list, fold the queued ops onto whatever is currently there, write
// it back. A stale-SHA rejection means someone else wrote in between — read
// again and fold again. Only transport is injected: the app passes fetch
// against the contents API, the Skill passes `gh api`. The logic is one copy.

import { parse, serialize } from './markdown.js';
import { foldAll } from './fold.js';

/** The remote moved under us. Not an error the user needs to see — just fold again. */
export class StaleError extends Error {}

/**
 * @typedef {object} Transport
 * @property {() => Promise<{text: string, sha: string|null}>} read
 * @property {(text: string, sha: string|null, message: string) => Promise<{sha: string}>} write
 */

/**
 * Replay ops onto fresh remote state.
 * @param {Transport} transport
 * @param {import('./fold.js').Op[]} ops
 * @param {{message?: string, attempts?: number}} [options]
 * @returns {Promise<{items: import('./markdown.js').Item[], sha: string|null, wrote: boolean}>}
 */
export async function commit(transport, ops, options = {}) {
  const { attempts = 4 } = options;
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const { text, sha } = await transport.read();
    const items = foldAll(parse(text), ops);
    const next = serialize(items);

    // Nothing to say: the ops are already reflected in the file — a replay
    // after a write that landed but whose response we never saw.
    if (next === text) return { items, sha, wrote: false };

    try {
      const result = await transport.write(next, sha, options.message ?? messageFor(ops));
      return { items, sha: result.sha, wrote: true };
    } catch (error) {
      if (!(error instanceof StaleError)) throw error;
      lastError = error;
    }
  }

  throw lastError ?? new Error('Could not write the list.');
}

/** Commit subjects that read like a log of what you did. */
export function messageFor(ops) {
  if (ops.length === 0) return 'Update reading list';
  if (ops.length === 1) {
    const [only] = ops;
    const verb =
      only.op === 'add' ? 'Add'
      : only.op === 'remove' ? 'Remove'
      : only.op === 'setRead' ? (only.read ? 'Read' : 'Unread')
      : only.star ? 'Star'
      : 'Unstar';
    return `${verb} ${hostOf(only.url)}`;
  }
  return `Sync ${ops.length} changes`;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
