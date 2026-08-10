// Everything the app keeps on the device: settings, the cached documents, and
// the queues of ops not yet pushed. The queue is the reason the app works on a
// train; the cache is the reason it paints before the network answers.
//
// There is one queue and one cache per document. The list and the Todos are
// separate files with separate SHAs, so a pending Todo must not ride along
// with a Capture, and neither must block the other.

const PREFIX = 'readinglist.';
const SETTINGS = `${PREFIX}settings`;

const DEFAULT_SETTINGS = { owner: '', repo: '', branch: 'main', token: '' };

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

function drop(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to do about it, and nothing to say.
  }
}

export const settings = {
  get: () => ({ ...DEFAULT_SETTINGS, ...read(SETTINGS, {}) }),
  set: (next) => write(SETTINGS, { ...settings.get(), ...next }),
  clear: () => drop(SETTINGS),
  /**
   * Configured means: we know where the data repo is and we can write to it.
   * This is the whole gate — the Todos are behind it exactly as the list is,
   * because the token is the only thing that opens the private repo at all.
   */
  configured: (s = settings.get()) => Boolean(s.owner && s.repo && s.token),
};

/**
 * The queue of ops for one document.
 * @param {import('./documents.js').Document} document
 */
export function queueFor(document) {
  const key = `${PREFIX}queue.${document.name}`;
  const self = {
    get: () => read(key, []),
    set: (ops) => write(key, ops),
    push(operation) {
      const ops = [...self.get(), operation];
      self.set(ops);
      return ops;
    },
    drop(id) {
      const ops = self.get().filter((operation) => operation.id !== id);
      self.set(ops);
      return ops;
    },
    /** Remove the ops that have been folded in and written. Ops queued during the flush survive. */
    settle(flushed) {
      const done = new Set(flushed.map((operation) => operation.id));
      const ops = self.get().filter((operation) => !done.has(operation.id));
      self.set(ops);
      return ops;
    },
  };
  return self;
}

/**
 * The offline copy of one document.
 * @param {import('./documents.js').Document} document
 */
export function cacheFor(document) {
  const key = `${PREFIX}cache.${document.name}`;
  return {
    get: () => read(key, { items: [], sha: null, at: null }),
    set: (items, sha) => write(key, { items, sha, at: Date.now() }),
    clear: () => drop(key),
  };
}

/** Forget the token, the caches and every queued op, on this device only. */
export function forgetDevice() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    settings.clear();
  }
}

/* The queue and the cache used to be single, unnamespaced keys, from when
 * there was only the list. Move them across once: a stale `path` setting is
 * only noise, but a pending op is a Capture nobody made twice. */
(function migrate() {
  try {
    for (const [legacy, next] of [
      [`${PREFIX}queue`, `${PREFIX}queue.links`],
      [`${PREFIX}cache`, `${PREFIX}cache.links`],
    ]) {
      const held = localStorage.getItem(legacy);
      if (held === null) continue;
      if (localStorage.getItem(next) === null) localStorage.setItem(next, held);
      localStorage.removeItem(legacy);
    }
  } catch {
    // No storage at all. There is nothing to migrate and nothing to lose.
  }
})();
