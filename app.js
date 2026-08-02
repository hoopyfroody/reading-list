// The app: paint from the local cache, fold the queue on top, flush when
// there is signal. Every user action is an op — nothing writes to the remote
// synchronously, so the interface behaves the same on a train as at a desk.

import { parse } from './lib/markdown.js';
import { foldAll, op } from './lib/fold.js';
import { commit } from './lib/sync.js';
import { githubTransport, AuthError } from './lib/github.js';
import { settings, queue, cache } from './lib/local.js';
import { displayHost, normalizeUrl } from './lib/normalize.js';

const el = (id) => document.getElementById(id);

const dom = {
  items: el('items'),
  archiveItems: el('archive-items'),
  archiveSection: el('archive-section'),
  toggleArchive: el('toggle-archive'),
  unreadCount: el('unread-count'),
  archiveCount: el('archive-count'),
  empty: el('empty'),
  status: el('status'),
  statusText: el('status-text'),
  dot: document.querySelector('.dot'),
  queue: el('queue'),
  fileLine: el('file-line'),
  template: el('item-template'),
  captureDialog: el('capture-dialog'),
  captureForm: el('capture-form'),
  captureError: el('capture-error'),
  captureSource: el('capture-source'),
  settingsDialog: el('settings-dialog'),
  settingsForm: el('settings-form'),
  settingsError: el('settings-error'),
};

const state = {
  remote: cache.get().items, // last known server state
  sha: cache.get().sha,
  ops: queue.get(), // not yet pushed
  sync: 'idle',
  detail: '',
  syncedAt: cache.get().at,
  showArchive: false,
  flushing: false,
};

/* ── Data ───────────────────────────────────────────────────────────────── */

const view = () => foldAll(state.remote, state.ops);

function transport() {
  return githubTransport(settings.get());
}

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
  if (!settings.configured()) return setSync('idle', 'Not connected yet');
  if (!navigator.onLine) return setSync('offline');

  setSync('syncing');
  try {
    const { text, sha } = await transport().read();
    state.remote = parse(text);
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
  if (!settings.configured()) return setSync('idle', 'Not connected yet');
  if (!navigator.onLine) return setSync('offline');

  const pushing = state.ops.slice();
  state.flushing = true;
  setSync('syncing');

  try {
    const result = await commit(transport(), pushing);
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
  if (error instanceof AuthError) {
    setSync('error', error.message);
    openSettings();
    return;
  }
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
  const items = view();
  const unread = items.filter((item) => !item.read);
  const archived = items.filter((item) => item.read);

  // Starred Items are pinned above the others — a rescue from newest-first
  // ordering burying things, not a priority scale.
  const ordered = [...unread.filter((i) => i.star), ...unread.filter((i) => !i.star)];
  const starCount = unread.filter((i) => i.star).length;

  paint(dom.items, ordered, starCount);
  paint(dom.archiveItems, archived, 0);

  dom.unreadCount.textContent = ordered.length ? `${ordered.length}` : '';
  dom.archiveCount.textContent = archived.length ? `${archived.length}` : '';
  dom.empty.hidden = ordered.length > 0 || !settings.configured();
  dom.archiveSection.hidden = !state.showArchive;
  dom.toggleArchive.textContent = state.showArchive ? 'Hide archive' : 'Show archive';
  dom.toggleArchive.setAttribute('aria-expanded', String(state.showArchive));
  dom.toggleArchive.hidden = archived.length === 0 && !state.showArchive;

  renderQueue();
  renderStatus(ordered.length);
}

function paint(list, items, starCount) {
  list.replaceChildren();
  items.forEach((item, index) => {
    const node = dom.template.content.firstElementChild.cloneNode(true);
    node.dataset.url = item.url;
    node.classList.toggle('read', item.read);
    node.classList.toggle('no-description', !item.description);
    node.classList.toggle('last-starred', starCount > 0 && index === starCount - 1);

    const link = node.querySelector('.title');
    link.textContent = item.title || item.url;
    link.href = item.url;

    node.querySelector('.host').textContent = displayHost(item.url);
    node.querySelector('.description').textContent = item.description ?? '';

    const star = node.querySelector('.star');
    star.setAttribute('aria-pressed', String(item.star));
    star.title = item.star ? 'Unstar' : 'Star';
    star.querySelector('.sr').textContent = item.star ? `Unstar ${item.title}` : `Star ${item.title}`;

    const readButton = node.querySelector('[data-action="read"]');
    readButton.textContent = item.read ? 'Unread' : 'Read';

    list.append(node);
  });
}

const OP_LABEL = {
  add: 'capture',
  setRead: 'read',
  setStar: 'star',
  remove: 'remove',
};

function renderQueue() {
  dom.queue.hidden = state.ops.length === 0;
  dom.queue.replaceChildren(
    ...state.ops.map((operation) => {
      const li = document.createElement('li');
      li.dataset.op = operation.id;
      const label = document.createElement('span');
      label.className = 'op';
      label.textContent =
        operation.op === 'setRead' && !operation.read ? 'unread'
        : operation.op === 'setStar' && !operation.star ? 'unstar'
        : OP_LABEL[operation.op];
      const target = document.createElement('span');
      target.className = 'target';
      target.textContent = displayHost(operation.url);
      li.append(label, target);
      return li;
    }),
  );
}

/** Let a pushed op visibly land before it leaves the ledger. */
function markSettled(pushed) {
  for (const operation of pushed) {
    const node = dom.queue.querySelector(`[data-op="${operation.id}"]`);
    node?.classList.add('settled');
  }
}

function renderStatus(unreadCount) {
  const { path } = settings.get();
  const pieces = [];

  if (!settings.configured()) {
    dom.dot.dataset.state = 'idle';
    dom.statusText.textContent = 'Not connected — add your repo and token in Settings';
    dom.fileLine.textContent = '';
    return;
  }

  pieces.push(path);
  pieces.push(`${unreadCount} to read`);

  const phrase = {
    syncing: 'syncing…',
    pending: `${state.ops.length} waiting`,
    offline: state.ops.length ? `offline · ${state.ops.length} waiting` : 'offline',
    error: state.detail || 'sync failed',
    synced: `synced ${ago(state.syncedAt)}`,
    idle: state.syncedAt ? `synced ${ago(state.syncedAt)}` : 'reading the list…',
  }[state.sync];

  pieces.push(phrase);
  dom.dot.dataset.state = state.sync;
  dom.statusText.textContent = pieces.join(' · ');

  const s = settings.get();
  dom.fileLine.textContent = `${s.owner}/${s.repo}/${s.path} @ ${s.branch}`;
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
  const item = event.target.closest('.item');

  if (event.target.closest('.star') && item) {
    const current = view().find((i) => i.url === item.dataset.url);
    act(op('setStar', item.dataset.url, { star: !current?.star }));
    return;
  }

  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action || !item) return;

  if (action === 'read') {
    const current = view().find((i) => i.url === item.dataset.url);
    act(op('setRead', item.dataset.url, { read: !current?.read }));
    return;
  }

  if (action === 'remove') {
    const button = event.target.closest('[data-action="remove"]');
    // Remove destroys the Item and the record that it existed. Ask once,
    // in place, rather than in a modal that gets dismissed by reflex.
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
    act(op('remove', item.dataset.url));
  }
});

dom.toggleArchive.addEventListener('click', () => {
  state.showArchive = !state.showArchive;
  render();
  if (state.showArchive) dom.archiveSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* ── Capture ────────────────────────────────────────────────────────────── */

function openCapture({ url = '', title = '', fromClipboard = false } = {}) {
  dom.captureError.hidden = true;
  dom.captureForm.reset();
  dom.captureSource.hidden = !fromClipboard;
  el('capture-url').value = url;
  el('capture-title').value = title;
  if (!dom.captureDialog.open) dom.captureDialog.showModal();
  // With a URL already in hand, the next thing you might type is the Title.
  (url ? el('capture-title') : el('capture-url')).focus();
}

el('capture').addEventListener('click', async () => {
  openCapture();
  // A URL is almost always already on the clipboard when you reach for this.
  const url = await clipboardUrl();
  const field = el('capture-url');
  // The read is async — do not yank the field out from under someone typing.
  if (!url || field.value || document.activeElement !== field) return;
  field.value = url;
  el('capture-title').focus();
});

/** The clipboard's contents, if they are a single web URL and nothing else. */
async function clipboardUrl() {
  try {
    const text = (await navigator.clipboard?.readText())?.trim();
    if (!text || !/^https?:\/\/\S+$/i.test(text)) return null;
    return normalizeUrl(text);
  } catch {
    // No clipboard permission, or the page is not focused. Typing works.
    return null;
  }
}

/* On arriving at the list with a URL on the clipboard — the usual way a page
 * gets here from a browser on the same machine — offer to Capture it, rather
 * than making you press Capture to be told what you already know. Offered
 * once per URL: declining, or Capturing, settles it for this tab. */

const OFFERED = 'readinglist.clipboardOffered';
const offered = {
  get: () => {
    try {
      return sessionStorage.getItem(OFFERED);
    } catch {
      return null;
    }
  },
  set: (url) => {
    try {
      sessionStorage.setItem(OFFERED, url);
    } catch {
      // Storage blocked. Worst case the offer comes back on the next visit.
    }
  },
};

async function offerClipboardCapture() {
  if (!settings.configured()) return;
  if (document.querySelector('dialog[open]')) return;
  if (document.visibilityState !== 'visible' || !document.hasFocus()) return;

  const url = await clipboardUrl();
  if (!url || url === offered.get()) return;
  // Already on the list — there is nothing to offer.
  if (view().some((item) => item.url === url)) return;
  // The read is async; the ground may have moved under it.
  if (document.querySelector('dialog[open]')) return;

  offered.set(url);
  openCapture({ url, fromClipboard: true });
}

dom.captureForm.addEventListener('submit', (event) => {
  const data = new FormData(dom.captureForm);
  try {
    act(
      op('add', String(data.get('url')), {
        title: String(data.get('title') || '').trim(),
        description: String(data.get('description') || '').trim() || null,
      }),
    );
    dom.captureError.hidden = true;
  } catch (error) {
    event.preventDefault();
    dom.captureError.textContent = error.message;
    dom.captureError.hidden = false;
  }
});

/* ── Settings ───────────────────────────────────────────────────────────── */

function openSettings() {
  const current = settings.get();
  el('settings-owner').value = current.owner;
  el('settings-repo').value = current.repo;
  el('settings-path').value = current.path;
  el('settings-branch').value = current.branch;
  el('settings-token').value = current.token;
  dom.settingsError.hidden = true;
  if (!dom.settingsDialog.open) dom.settingsDialog.showModal();
}

el('open-settings').addEventListener('click', openSettings);

dom.settingsForm.addEventListener('submit', () => {
  const data = new FormData(dom.settingsForm);
  settings.set({
    owner: String(data.get('owner')).trim(),
    repo: String(data.get('repo')).trim(),
    path: String(data.get('path')).trim(),
    branch: String(data.get('branch')).trim(),
    token: String(data.get('token')).trim(),
  });
  cache.clear();
  state.remote = [];
  state.sha = null;
  state.syncedAt = null;
  refresh();
});

el('forget-device').addEventListener('click', () => {
  const button = el('forget-device');
  if (button.dataset.armed !== 'true') {
    button.dataset.armed = 'true';
    button.textContent = 'Forget token and cache?';
    return;
  }
  settings.clear();
  cache.clear();
  queue.set([]);
  state.remote = [];
  state.ops = [];
  state.sha = null;
  state.syncedAt = null;
  dom.settingsDialog.close();
  button.dataset.armed = 'false';
  button.textContent = 'Forget this device';
  render();
});

for (const dialog of document.querySelectorAll('dialog')) {
  dialog.querySelector('[data-close]')?.addEventListener('click', () => dialog.close());
  // Clicking the backdrop closes the sheet.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

/* ── Lifecycle ──────────────────────────────────────────────────────────── */

window.addEventListener('online', () => {
  refresh();
});
window.addEventListener('offline', () => setSync('offline'));

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  refresh();
  offerClipboardCapture();
});

// Coming back from the browser window you copied the URL in does not always
// count as a visibility change; regaining focus does.
window.addEventListener('focus', () => offerClipboardCapture());

// Keep "synced 3m ago" honest without re-reading the list.
setInterval(() => {
  if (state.sync === 'synced' || state.sync === 'idle') renderStatus(view().filter((i) => !i.read).length);
}, 30_000);

render();
if (settings.configured()) refresh();
else openSettings();

// The home-screen shortcut and the Mac bookmarklet both land here.
const launch = new URLSearchParams(location.search);
if (settings.configured() && (launch.has('capture') || launch.has('url'))) {
  if (launch.has('url')) {
    openCapture({ url: launch.get('url'), title: launch.get('title') || '' });
  } else {
    el('capture').click();
  }
  history.replaceState(null, '', location.pathname);
} else if (settings.configured()) {
  // Arriving at the list with a URL already copied is itself the intent to
  // Capture it. Ask, once, instead of waiting to be asked.
  offerClipboardCapture();
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // Offline reading is a bonus, not a precondition.
  });
}
