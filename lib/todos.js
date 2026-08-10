// Todos are a markdown file too, but a different one — a Todo has no URL, so
// it has no business in the URL-keyed list. See docs/adr/0006.
//
//   # Todos
//
//   - [ ] Call the dentist
//   - [ ] Renew the passport
//
//   ## Done
//
//   - [x] Book the flights
//
// Todos above the Done heading are live; below it they are Done. The box says
// the same thing twice on purpose: it makes the file a working second UI in
// the GitHub mobile app, where ticking a box is the obvious gesture. When the
// two disagree, the box wins — the box is what a hand reaches for.
//
// Identity is the text. Parse and serialize are a matched pair: every document
// this module writes must round-trip through the parser unchanged.

import { collapse, escapeText, unescapeText } from './text.js';

const TITLE_LINE = '# Todos';
const DONE_LINE = '## Done';
const TODO = /^-\s+(?:\[([ xX])\]\s*)?(.*)$/;

/**
 * @typedef {object} Todo
 * @property {string} text  The Todo, and its identity
 * @property {boolean} done
 */

/**
 * Parse the Todos file. Unparseable lines are ignored rather than fatal — the
 * file is hand-editable, and a stray note should not cost you the list.
 * @param {string} text
 * @returns {Todo[]} live Todos first (oldest first), then the Done ones
 */
export function parseTodos(text) {
  const todos = [];
  let done = false;

  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (line.trim().toLowerCase() === DONE_LINE.toLowerCase()) {
      done = true;
      continue;
    }

    const match = line.match(TODO);
    if (!match) continue;

    const [, box, rest] = match;
    const body = collapse(unescapeText(rest));
    if (!body) continue;

    // The box wins where it exists; a bullet typed without one takes the section.
    todos.push({ text: body, done: box === undefined ? done : box.toLowerCase() === 'x' });
  }

  // File order, as written. Live-above-Done is an invariant of the fold and of
  // serialize, not something to impose on a file someone has just hand-edited.
  return dedupe(todos);
}

/**
 * Serialize Todos back to markdown.
 * @param {Todo[]} todos
 * @returns {string}
 */
export function serializeTodos(todos) {
  const ordered = orderTodos(todos);
  const live = ordered.filter((todo) => !todo.done);
  const finished = ordered.filter((todo) => todo.done);

  const lines = [TITLE_LINE, ''];
  for (const todo of live) lines.push(todoLine(todo));
  if (live.length) lines.push('');
  lines.push(DONE_LINE, '');
  for (const todo of finished) lines.push(todoLine(todo));
  if (finished.length) lines.push('');

  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

const todoLine = (todo) => `- [${todo.done ? 'x' : ' '}] ${escapeText(todo.text)}`;

/** Live Todos above Done ones, each group keeping the order it came in. */
export function orderTodos(todos) {
  return [...todos.filter((todo) => !todo.done), ...todos.filter((todo) => todo.done)];
}

/** Later duplicates lose; a hand-edit that types the same Todo twice yields one. */
function dedupe(todos) {
  const seen = new Map();
  for (const todo of todos) if (!seen.has(todo.text)) seen.set(todo.text, todo);
  return [...seen.values()];
}
