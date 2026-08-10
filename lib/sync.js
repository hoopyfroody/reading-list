// Read the document, fold the queued ops onto whatever is currently there,
// write it back. A stale-SHA rejection means someone else wrote in between —
// read again and fold again.
//
// Two things are injected and nothing else is: the transport (the app passes
// fetch against the contents API, the Skill passes `gh api`) and the document
// (the list, or the Todos). The logic is one copy.

import { LINKS } from './documents.js';

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
 * @param {object[]} ops
 * @param {{message?: string, attempts?: number, document?: import('./documents.js').Document}} [options]
 * @returns {Promise<{items: object[], sha: string|null, wrote: boolean}>}
 */
export async function commit(transport, ops, options = {}) {
  const { attempts = 4, document = LINKS } = options;
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const { text, sha } = await transport.read();
    const items = document.foldAll(document.parse(text), ops);
    const next = document.serialize(items);

    // Nothing to say: the ops are already reflected in the file — a replay
    // after a write that landed but whose response we never saw.
    if (next === text) return { items, sha, wrote: false };

    try {
      const result = await transport.write(next, sha, options.message ?? document.messageFor(ops));
      return { items, sha: result.sha, wrote: true };
    } catch (error) {
      if (!(error instanceof StaleError)) throw error;
      lastError = error;
    }
  }

  throw lastError ?? new Error('Could not write the file.');
}
