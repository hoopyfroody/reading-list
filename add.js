// The Share Target: two taps, URL and Title, no Description. The Skill
// Backfills the Description later. This page queues the op and gets out of
// the way — it must work with no signal, because the share sheet does not
// wait for a network.

import { op } from './lib/fold.js';
import { commit } from './lib/sync.js';
import { githubTransport, AuthError } from './lib/github.js';
import { settings, queue, cache } from './lib/local.js';
import { displayHost, firstUrlIn } from './lib/normalize.js';

const params = new URLSearchParams(location.search);
const statusText = document.getElementById('status-text');
const dot = document.querySelector('.dot');
const note = document.getElementById('note');
const undoButton = document.getElementById('undo');

// Android share sheets are inconsistent about which field holds what: some
// send the URL in `url`, some fold it into `text` alongside the title.
const rawUrl = params.get('url') || firstUrlIn(params.get('text')) || firstUrlIn(params.get('title'));
const sharedTitle = (params.get('title') || stripUrl(params.get('text')) || '').trim();

let queued = null;

if (!rawUrl) {
  fail('No web page in that share. Share a link, or capture it from the list.');
} else if (!settings.configured()) {
  fail('Not connected yet. Open the reading list and add your repo and token first.');
} else {
  try {
    queued = op('add', rawUrl, { title: sharedTitle, description: null });
    queue.push(queued);
    preview(queued);
    push();
  } catch (error) {
    fail(error.message);
  }
}

function preview(operation) {
  const list = document.getElementById('preview');
  const item = document.createElement('li');
  item.className = 'item no-description';

  const gutter = document.createElement('div');
  gutter.className = 'gutter';

  const body = document.createElement('div');
  body.className = 'body';

  const link = document.createElement('a');
  link.className = 'title';
  link.href = operation.url;
  link.target = '_blank';
  link.rel = 'noreferrer noopener';
  link.textContent = operation.title || operation.url;

  const host = document.createElement('p');
  host.className = 'host mono';
  host.textContent = displayHost(operation.url);

  body.append(link, host);
  item.append(gutter, body);
  list.append(item);

  note.textContent = 'No description yet. Backfill it from the Mac with the Skill.';
}

async function push() {
  if (!navigator.onLine) {
    dot.dataset.state = 'offline';
    statusText.textContent = 'saved here · pushes when you have signal';
    return;
  }

  dot.dataset.state = 'syncing';
  statusText.textContent = 'pushing…';

  const pushing = queue.get();
  try {
    const result = await commit(githubTransport(settings.get()), pushing);
    queue.settle(pushing);
    cache.set(result.items, result.sha);
    dot.dataset.state = 'synced';
    statusText.textContent = `on the list · ${result.items.filter((i) => !i.read).length} to read`;
  } catch (error) {
    dot.dataset.state = error instanceof AuthError ? 'error' : 'offline';
    statusText.textContent =
      error instanceof AuthError ? error.message : 'saved here · pushes when you have signal';
  }
}

undoButton.addEventListener('click', async () => {
  if (!queued) return;
  undoButton.disabled = true;

  const stillQueued = queue.get().some((o) => o.id === queued.id);
  queue.drop(queued.id);

  document.getElementById('preview').replaceChildren();
  note.textContent = 'Not captured.';
  dot.dataset.state = 'idle';
  statusText.textContent = 'undone';

  // The add never left this device: dropping it from the queue is the whole
  // undo. Otherwise it landed, and undoing means removing it again.
  if (stillQueued) return;

  const undoOp = op('remove', queued.url);
  queue.push(undoOp);
  if (!navigator.onLine) {
    statusText.textContent = 'undone here · pushes when you have signal';
    return;
  }
  try {
    const result = await commit(githubTransport(settings.get()), [undoOp]);
    queue.settle([undoOp]);
    cache.set(result.items, result.sha);
  } catch {
    statusText.textContent = 'undone here · pushes when you have signal';
  }
});

function fail(message) {
  dot.dataset.state = 'error';
  statusText.textContent = 'not captured';
  note.textContent = message;
  undoButton.hidden = true;
}

function stripUrl(text) {
  if (!text) return '';
  return text.replace(/https?:\/\/\S+/gi, '').trim();
}
