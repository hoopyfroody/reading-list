// The browser half of the transport: the GitHub contents API, authenticated
// with a fine-grained PAT held in local storage. Scoped to contents:read+write
// on the data repo and nothing else.

import { StaleError } from './sync.js';

const API = 'https://api.github.com';

export class AuthError extends Error {}
export class MissingFileError extends Error {}

/**
 * @param {{owner: string, repo: string, path: string, branch: string, token: string}} settings
 * @returns {import('./sync.js').Transport}
 */
export function githubTransport(settings) {
  const { owner, repo, path, branch, token } = settings;
  const base = `${API}/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;

  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };

  return {
    async read() {
      const response = await fetch(`${base}?ref=${encodeURIComponent(branch)}&t=${Date.now()}`, {
        headers,
        cache: 'no-store',
      });

      if (response.status === 404) {
        // The list file does not exist yet. An empty list is a valid start.
        return { text: '', sha: null };
      }
      await assertOk(response);

      const body = await response.json();
      if (Array.isArray(body)) throw new MissingFileError(`${path} is a folder, not the list file.`);
      return { text: decode(body.content ?? ''), sha: body.sha ?? null };
    },

    async write(text, sha, message) {
      const response = await fetch(base, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, content: encode(text), branch, ...(sha ? { sha } : {}) }),
      });

      // 409 is the documented stale-SHA conflict; 422 is what you get when you
      // omit the sha for a file that has since been created.
      if (response.status === 409 || response.status === 422) {
        throw new StaleError('The list changed on the server.');
      }
      await assertOk(response);

      const body = await response.json();
      return { sha: body.content?.sha ?? null };
    },
  };
}

async function assertOk(response) {
  if (response.ok) return;

  const detail = await response
    .clone()
    .json()
    .then((body) => body?.message)
    .catch(() => null);

  if (response.status === 401) throw new AuthError('GitHub rejected the token. Paste a new one in Settings.');
  if (response.status === 403 && /rate limit/i.test(detail ?? '')) {
    throw new Error('GitHub rate limit reached. Try again in a few minutes.');
  }
  if (response.status === 403 || response.status === 404) {
    throw new AuthError('The token cannot reach that repo. Check the owner, repo and token scope in Settings.');
  }
  throw new Error(detail ? `GitHub: ${detail}` : `GitHub returned ${response.status}.`);
}

/** base64 of UTF-8 — the list holds titles in every language a page might be in. */
function encode(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decode(base64) {
  const binary = atob(base64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
