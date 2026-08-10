// The two documents in the data repo, and everything that differs between
// them. `commit` takes one of these and is otherwise blind to which it is
// driving — read, fold, serialize, write is one piece of logic.
//
// The paths are fixed. There was once a setting for the list's path; it earned
// nothing but a field to paste on every device. See docs/adr/0006.

import { parse, serialize } from './markdown.js';
import { foldAll, messageFor } from './fold.js';
import { parseTodos, serializeTodos } from './todos.js';
import { foldAllTodos, messageForTodos } from './todo-fold.js';

/**
 * @typedef {object} Document
 * @property {string} name  How local storage names this document's queue and cache
 * @property {string} path  Where it lives in the data repo
 * @property {(text: string) => object[]} parse
 * @property {(entries: object[]) => string} serialize
 * @property {(entries: object[], ops: object[]) => object[]} foldAll
 * @property {(ops: object[]) => string} messageFor
 */

/** @type {Document} */
export const LINKS = { name: 'links', path: 'links.md', parse, serialize, foldAll, messageFor };

/** @type {Document} */
export const TODOS = {
  name: 'todos',
  path: 'todos.md',
  parse: parseTodos,
  serialize: serializeTodos,
  foldAll: foldAllTodos,
  messageFor: messageForTodos,
};
