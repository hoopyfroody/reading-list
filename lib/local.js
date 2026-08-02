// Everything the app keeps on the device: settings, the cached list, and the
// queue of ops not yet pushed. The queue is the reason the app works on a
// train; the cache is the reason it paints before the network answers.

const KEYS = {
  settings: 'readinglist.settings',
  queue: 'readinglist.queue',
  cache: 'readinglist.cache',
};

const DEFAULT_SETTINGS = { owner: '', repo: '', path: 'links.md', branch: 'main', token: '' };

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked. The in-memory state is still correct for this
    // session; there is nothing useful to say to the user about it.
  }
}

export const settings = {
  get: () => ({ ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) }),
  set: (next) => write(KEYS.settings, { ...settings.get(), ...next }),
  clear: () => localStorage.removeItem(KEYS.settings),
  /** Configured means: we know where the list lives and we can write to it. */
  configured: (s = settings.get()) => Boolean(s.owner && s.repo && s.path && s.token),
};

export const queue = {
  get: () => read(KEYS.queue, []),
  set: (ops) => write(KEYS.queue, ops),
  push(operation) {
    const ops = [...queue.get(), operation];
    queue.set(ops);
    return ops;
  },
  drop(id) {
    const ops = queue.get().filter((operation) => operation.id !== id);
    queue.set(ops);
    return ops;
  },
  /** Remove the ops that have been folded in and written. Ops queued during the flush survive. */
  settle(flushed) {
    const done = new Set(flushed.map((operation) => operation.id));
    const ops = queue.get().filter((operation) => !done.has(operation.id));
    queue.set(ops);
    return ops;
  },
};

export const cache = {
  get: () => read(KEYS.cache, { items: [], sha: null, at: null }),
  set: (items, sha) => write(KEYS.cache, { items, sha, at: Date.now() }),
  clear: () => localStorage.removeItem(KEYS.cache),
};
