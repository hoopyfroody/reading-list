// The list is a markdown file. Parse and serialize are a matched pair: every
// document this module writes must round-trip through the parser unchanged.
//
//   # Reading list
//
//   - ★ [Title](https://example.com/a)
//     A short description of the page.
//   - [Title](https://example.com/b)
//
//   ## Archive
//
//   - [Something already read](https://example.com/c)
//
// Items above the Archive heading are on the Reading List; items below it are
// Read. Star is the ★ before the link. Description is the indented line under
// it. The format is hand-editable in the GitHub mobile app on purpose.

import { normalizeUrl } from './normalize.js';
import { collapse, escapeText, unescapeText } from './text.js';

const TITLE_LINE = '# Reading list';
const ARCHIVE_LINE = '## Archive';
const ITEM = /^-\s+(★\s+)?\[(.*)\]\(<?(\S*?)>?\)\s*$/;
const CONTINUATION = /^\s+\S/;

/**
 * @typedef {object} Item
 * @property {string} url         Normalized URL — the Item's identity
 * @property {string} title       Captured verbatim; never invented
 * @property {string|null} description
 * @property {boolean} read
 * @property {boolean} star
 */

/**
 * Parse the list file. Unparseable lines are ignored rather than fatal — the
 * file is hand-editable, and a stray note should not cost you the list.
 * @param {string} text
 * @returns {Item[]} Reading List first (newest first), then the Archive
 */
export function parse(text) {
  const items = [];
  let read = false;
  let current = null;

  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (line.trim().toLowerCase() === ARCHIVE_LINE.toLowerCase()) {
      current = null;
      read = true;
      continue;
    }

    const match = line.match(ITEM);
    if (match) {
      const [, star, title, href] = match;
      let url;
      try {
        url = normalizeUrl(unescapeText(href));
      } catch {
        current = null;
        continue;
      }
      current = {
        url,
        title: unescapeText(title).trim(),
        description: null,
        read,
        star: Boolean(star),
      };
      items.push(current);
      continue;
    }

    if (current && CONTINUATION.test(line)) {
      const extra = line.trim();
      current.description = current.description ? `${current.description} ${extra}` : extra;
      continue;
    }

    if (!line.trim()) continue;
    current = null;
  }

  return dedupe(items);
}

/**
 * Serialize items back to markdown.
 * @param {Item[]} items
 * @returns {string}
 */
export function serialize(items) {
  const unread = items.filter((item) => !item.read);
  const archived = items.filter((item) => item.read);

  const lines = [TITLE_LINE, ''];
  for (const item of unread) lines.push(...itemLines(item));
  if (unread.length) lines.push('');
  lines.push(ARCHIVE_LINE, '');
  for (const item of archived) lines.push(...itemLines(item));
  if (archived.length) lines.push('');

  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

function itemLines(item) {
  const star = item.star ? '★ ' : '';
  const title = escapeText(item.title || item.url);
  const lines = [`- ${star}[${title}](${escapeHref(item.url)})`];
  if (item.description) lines.push(`  ${escapeText(collapse(item.description))}`);
  return lines;
}

/** Later duplicates lose; a hand-edit that pastes the same URL twice yields one Item. */
function dedupe(items) {
  const seen = new Map();
  for (const item of items) {
    const existing = seen.get(item.url);
    if (!existing) {
      seen.set(item.url, item);
      continue;
    }
    existing.description ??= item.description;
    existing.star ||= item.star;
  }
  return [...seen.values()];
}

function escapeHref(url) {
  return url.replace(/[()\s]/g, (c) => encodeURIComponent(c));
}
