// Actions are operations, folded onto whatever state is current.
//
// Ops are recorded locally, then replayed onto a fresh read of the list. A
// stale-SHA conflict just means fold again against fresher content, so the
// fold must be safe to run more than once. It is: identity is the Normalized
// URL, so folding add(url) twice yields one Item.

import { normalizeUrl } from './normalize.js';
import { tidyTitle } from './title.js';

/** @typedef {import('./markdown.js').Item} Item */

/**
 * @typedef {object} Op
 * @property {'add'|'setRead'|'setStar'|'remove'} op
 * @property {string} url
 * @property {string} [id]
 * @property {number} [at]
 * @property {string} [title]
 * @property {string|null} [description]
 * @property {boolean} [read]
 * @property {boolean} [star]
 */

/** Build an op, normalizing the URL up front so a bad URL fails at Capture, not at flush. */
export function op(kind, url, fields = {}) {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    op: kind,
    url: normalizeUrl(url),
    ...fields,
  };
}

/**
 * Fold one op onto a list of items, returning a new list.
 * @param {Item[]} items
 * @param {Op} operation
 * @returns {Item[]}
 */
export function fold(items, operation) {
  const url = normalizeUrl(operation.url);
  const index = items.findIndex((item) => item.url === url);
  const existing = index === -1 ? null : items[index];
  // Every Capture path — Share Target, Skill, app, unattended Backfill — folds
  // an add, so this is the one place a Title has to be made scannable.
  const offered = tidyTitle(operation.title);

  switch (operation.op) {
    case 'add': {
      if (!existing) {
        // Newest first.
        return [
          {
            url,
            title: offered || url,
            description: operation.description || null,
            read: false,
            star: false,
          },
          ...items,
        ];
      }
      // A non-null Description beats a null one whichever arrives first: this is
      // what lets Share Target Capture and Skill Backfill compose without
      // ordering rules. An add never changes Read or Star.
      const merged = {
        ...existing,
        title: existing.title && existing.title !== existing.url ? existing.title : offered || existing.title,
        description: existing.description || operation.description || null,
      };
      return replace(items, index, merged);
    }

    case 'setRead':
      // Only `add` may create an Item — a queued setRead for something removed
      // on the other device must no-op, not resurrect it.
      if (!existing) return items;
      return replace(items, index, { ...existing, read: Boolean(operation.read) });

    case 'setStar':
      if (!existing) return items;
      return replace(items, index, { ...existing, star: Boolean(operation.star) });

    case 'remove':
      if (!existing) return items;
      return items.filter((_, i) => i !== index);

    default:
      return items;
  }
}

/**
 * @param {Item[]} items
 * @param {Op[]} ops
 * @returns {Item[]}
 */
export function foldAll(items, ops) {
  return ops.reduce((acc, operation) => fold(acc, operation), items);
}

function replace(items, index, item) {
  const next = items.slice();
  next[index] = item;
  return next;
}
