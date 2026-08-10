// The Todos page. Same shape as the list: paint from the local cache, fold the
// queue on top, flush when there is signal. Different document, different
// queue, so a Todo never rides along with a Capture.
//
// There is no Settings here. The token is the gate for both documents, and it
// is asked for in one place — arriving without one sends you there.

import { commit } from './lib/sync.js';
import { githubTransport, AuthError } from './lib/github.js';
import { settings, queueFor, cacheFor } from './lib/local.js';
import { TODOS } from './lib/documents.js';
import { parseTodos } from './lib/todos.js';
import { foldAllTodos, todoOp } from './lib/todo-fold.js';

if (!settings.configured()) location.replace('./index.html');

const queue = queueFor(TODOS);
const cache = cacheFor(TODOS);

const el = (id) => document.getElementById(id);

const dom = {
  todos: el('todos'),
  doneTodos: el('done-todos'),
  doneSection: el('done-section'),
  toggleDone: el('toggle-done'),
  todoCount: el('todo-count'),
  doneCount: el('done-count'),
  empty: el('empty'),
  statusText: el('status-text'),
  dot: document.querySelector('.dot'),
  queue: el('queue'),
  fileLine: el('file-line'),
  template: el('todo-template'),
  form: el('new-todo-form'),
  input: el('new-todo'),
  formError: el('new-todo-error'),
};

const state = {
  remote: cache.get().items,
  sha: cache.get().sha,
  ops: queue.get(),
  sync: 'idle',
  detail: '',
  syncedAt: cache.get().at,
  showDone: false,
  flushing: false,
};

/* ── Data ───────────────────────────────────────────────────────────────── */

const view = () => foldAllTodos(state.remote, state.ops);

const transport = () => githubTransport(settings.get(), TODOS);

function act(operation) {
  state.ops = queue.push(operation);
  render();
  scheduleFlush(250);
}

let flushTimer;
function scheduleFlush(delay = 800) {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, delay);
}

async function refresh() {
  if (!navigator.onLine) return setSync('offline');

  setSync('syncing');
  try {
    const { text, sha } = await transport().read();
    state.remote = parseTodos(text);
    state.sha = sha;
    state.syncedAt = Date.now();
    cache.set(state.remote, sha);
    setSync(state.ops.length ? 'pending' : 'synced');
    if (state.ops.length) flush();
  } catch (error) {
    fail(error);
  }
}

async function flush() {
  if (state.flushing || !state.ops.length) return;
  if (!navigator.onLine) return setSync('offline');

  const pushing = state.ops.slice();
  state.flushing = true;
  setSync('syncing');

  try {
    const result = await commit(transport(), pushing, { document: TODOS });
    state.remote = result.items;
    state.sha = result.sha;
    state.syncedAt = Date.now();
    state.ops = queue.settle(pushing);
    cache.set(state.remote, state.sha);
    markSettled(pushing);
    setSync(state.ops.length ? 'pending' : 'synced');
  } catch (error) {
    fail(error);
  } finally {
    state.flushing = false;
  }
}

function fail(error) {
  // A token that no longer works is a Settings problem, and Settings is on the
  // list page. Say so rather than showing a second copy of it here.
  if (error instanceof AuthError) return setSync('error', error.message);
  const offline = !navigator.onLine || error instanceof TypeError;
  setSync(offline ? 'offline' : 'error', offline ? '' : error.message);
}

function setSync(sync, detail = '') {
  state.sync = sync;
  state.detail = detail;
  render();
}

/* ── Rendering ──────────────────────────────────────────────────────────── */

function render() {
  const todos = view();
  const live = todos.filter((todo) => !todo.done);
  const finished = todos.filter((todo) => todo.done);

  paint(dom.todos, live);
  paint(dom.doneTodos, finished);

  dom.todoCount.textContent = live.length ? `${live.length}` : '';
  dom.doneCount.textContent = finished.length ? `${finished.length}` : '';
  dom.empty.hidden = live.length > 0;
  dom.doneSection.hidden = !state.showDone;
  dom.toggleDone.textContent = state.showDone ? 'Hide done' : 'Show done';
  dom.toggleDone.setAttribute('aria-expanded', String(state.showDone));
  dom.toggleDone.hidden = finished.length === 0 && !state.showDone;

  renderQueue();
  renderStatus(live.length);
}

function paint(list, todos) {
  list.replaceChildren();
  for (const todo of todos) {
    const node = dom.template.content.firstElementChild.cloneNode(true);
    node.dataset.text = todo.text;
    node.classList.toggle('done', todo.done);

    node.querySelector('.todo-text').replaceChildren(...linkify(todo.text));

    const tick = node.querySelector('.tick');
    tick.setAttribute('aria-pressed', String(todo.done));
    tick.title = todo.done ? 'Not done after all' : 'Done';
    tick.querySelector('.sr').textContent = todo.done ? `Undo ${todo.text}` : `Done: ${todo.text}`;

    node.querySelector('[data-action="done"]').textContent = todo.done ? 'Undone' : 'Done';

    list.append(node);
  }
}

/* A Todo may mention a page — "read x before Thursday". That is a Todo that
 * happens to carry a URL, not an Item, so the text is stored verbatim and only
 * made clickable here. */
function linkify(text) {
  const nodes = [];
  let at = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    if (match.index > at) nodes.push(document.createTextNode(text.slice(at, match.index)));
    const link = document.createElement('a');
    link.href = match[0];
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    link.textContent = match[0];
    nodes.push(link);
    at = match.index + match[0].length;
  }
  if (at < text.length) nodes.push(document.createTextNode(text.slice(at)));
  return nodes;
}

const OP_LABEL = { add: 'add', setDone: 'done', remove: 'remove' };

function renderQueue() {
  dom.queue.hidden = state.ops.length === 0;
  dom.queue.replaceChildren(
    ...state.ops.map((operation) => {
      const li = document.createElement('li');
      li.dataset.op = operation.id;
      const label = document.createElement('span');
      label.className = 'op';
      label.textContent =
        operation.op === 'setDone' && !operation.done ? 'undone' : OP_LABEL[operation.op];
      const target = document.createElement('span');
      target.className = 'target';
      target.textContent = operation.text;
      li.append(label, target);
      return li;
    }),
  );
}

/** Let a pushed op visibly land before it leaves the ledger. */
function markSettled(pushed) {
  for (const operation of pushed) {
    dom.queue.querySelector(`[data-op="${operation.id}"]`)?.classList.add('settled');
  }
}

function renderStatus(liveCount) {
  const phrase = {
    syncing: 'syncing…',
    pending: `${state.ops.length} waiting`,
    offline: state.ops.length ? `offline · ${state.ops.length} waiting` : 'offline',
    error: state.detail || 'sync failed',
    synced: `synced ${ago(state.syncedAt)}`,
    idle: state.syncedAt ? `synced ${ago(state.syncedAt)}` : 'reading the Todos…',
  }[state.sync];

  dom.dot.dataset.state = state.sync;
  dom.statusText.textContent = [TODOS.path, `${liveCount} to do`, phrase].join(' · ');

  const s = settings.get();
  dom.fileLine.textContent = `${s.owner}/${s.repo}/${TODOS.path} @ ${s.branch}`;
}

function ago(at) {
  if (!at) return 'never';
  const seconds = Math.round((Date.now() - at) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/* ── Actions ────────────────────────────────────────────────────────────── */

document.addEventListener('click', (event) => {
  const node = event.target.closest('.todo');
  if (!node) return;
  const { text } = node.dataset;

  const tick = event.target.closest('.tick');
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!tick && !action) return;

  if (tick || action === 'done') {
    const current = view().find((todo) => todo.text === text);
    act(todoOp('setDone', text, { done: !current?.done }));
    return;
  }

  if (action === 'remove') {
    const button = event.target.closest('[data-action="remove"]');
    // Remove destroys the Todo and the record that it existed — it is not
    // "I did it". Ask once, in place, rather than in a modal dismissed by reflex.
    if (button.dataset.armed !== 'true') {
      button.dataset.armed = 'true';
      button.textContent = 'Remove for good?';
      setTimeout(() => {
        if (!button.isConnected) return;
        button.dataset.armed = 'false';
        button.textContent = 'Remove';
      }, 4000);
      return;
    }
    act(todoOp('remove', text));
  }
});

dom.toggleDone.addEventListener('click', () => {
  state.showDone = !state.showDone;
  render();
  if (state.showDone) dom.doneSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

dom.form.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    act(todoOp('add', dom.input.value));
    dom.input.value = '';
    dom.formError.hidden = true;
  } catch (error) {
    dom.formError.textContent = error.message;
    dom.formError.hidden = false;
  }
  dom.input.focus();
});

/* ── Lifecycle ──────────────────────────────────────────────────────────── */

window.addEventListener('online', refresh);
window.addEventListener('offline', () => setSync('offline'));

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh();
});

// Keep "synced 3m ago" honest without re-reading the file.
setInterval(() => {
  if (state.sync === 'synced' || state.sync === 'idle') {
    renderStatus(view().filter((todo) => !todo.done).length);
  }
}, 30_000);

// The redirect above is already on its way; painting a page nobody will see,
// against a repo we cannot reach, would only produce a spurious error.
if (settings.configured()) {
  render();
  refresh();
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // Offline is a bonus, not a precondition.
  });
}
