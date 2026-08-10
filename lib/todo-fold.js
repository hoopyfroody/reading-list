// The Todo half of "actions are operations, folded onto whatever state is
// current". Same contract as lib/fold.js: ops are recorded locally, then
// replayed onto a fresh read, so every fold must be safe to run more than
// once. It is — identity is the text, so folding add("call the dentist")
// twice yields one Todo.

import { collapse } from './text.js';
import { orderTodos } from './todos.js';

/** @typedef {import('./todos.js').Todo} Todo */

/**
 * @typedef {object} TodoOp
 * @property {'add'|'setDone'|'remove'} op
 * @property {string} text
 * @property {string} [id]
 * @property {number} [at]
 * @property {boolean} [done]
 */

/** Build an op, collapsing the text up front so identity is settled at the door. */
export function todoOp(kind, text, fields = {}) {
  const body = collapse(text);
  if (!body) throw new Error('A Todo needs some text.');
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    op: kind,
    text: body,
    ...fields,
  };
}

/**
 * Fold one op onto a list of Todos, returning a new list.
 * @param {Todo[]} todos
 * @param {TodoOp} operation
 * @returns {Todo[]}
 */
export function foldTodo(todos, operation) {
  const text = collapse(operation.text);
  const existing = todos.find((todo) => todo.text === text);

  switch (operation.op) {
    case 'add':
      // Adding something already live is the no-op that makes replay safe.
      if (existing && !existing.done) return todos;
      // Adding something already Done resurrects it — "water the plants" comes
      // round again, and re-typing it is what you meant.
      return place(todos, { text, done: false });

    case 'setDone':
      // Only add may create a Todo — a queued setDone for something removed on
      // the other device must no-op, not resurrect it.
      if (!existing) return todos;
      return place(todos, { text, done: Boolean(operation.done) });

    case 'remove':
      if (!existing) return todos;
      return todos.filter((todo) => todo.text !== text);

    default:
      return todos;
  }
}

/**
 * @param {Todo[]} todos
 * @param {TodoOp[]} ops
 * @returns {Todo[]}
 */
export function foldAllTodos(todos, ops) {
  return ops.reduce((acc, operation) => foldTodo(acc, operation), todos);
}

/**
 * Put a Todo at the boundary between the live ones and the Done ones — which
 * is the bottom of the live list, and the top of Done. Both are right: a new
 * or resurrected Todo joins the end of the queue, and the thing you just
 * finished is the most recent thing you finished.
 *
 * There is only a boundary to place against once the list is actually
 * partitioned, and it may not be: a file ticked by hand in the GitHub app
 * arrives with a Done Todo still sitting above the live ones, and parse hands
 * it over in that order on purpose. So order it first, here, where the
 * invariant is needed.
 */
function place(todos, todo) {
  const rest = orderTodos(todos.filter((existing) => existing.text !== todo.text));
  const boundary = rest.filter((existing) => !existing.done).length;
  return [...rest.slice(0, boundary), todo, ...rest.slice(boundary)];
}

/** Commit subjects that read like a log of what you did. */
export function messageForTodos(ops) {
  if (ops.length === 0) return 'Update todos';
  if (ops.length === 1) {
    const [only] = ops;
    const verb =
      only.op === 'add' ? 'Add'
      : only.op === 'remove' ? 'Remove'
      : only.done ? 'Done'
      : 'Undone';
    return `${verb} “${shorten(only.text)}”`;
  }
  return `Sync ${ops.length} changes`;
}

function shorten(text, limit = 60) {
  const body = collapse(text);
  if (body.length <= limit) return body;
  const cut = body.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:—-]+$/, '')}…`;
}
