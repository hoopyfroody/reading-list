// Normalized URL: the identity of an Item.
//
// lowercase host, no `www.`, `https` scheme, tracking parameters stripped,
// no trailing slash. Two URLs that normalize alike are the same Item.

const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'gbraid',
  'wbraid',
  'msclkid',
  'twclid',
  'yclid',
  'igshid',
  'igsh',
  'mc_cid',
  'mc_eid',
  'oly_anon_id',
  'oly_enc_id',
  'vero_id',
  'vero_conv',
  '_hsenc',
  '_hsmi',
  'hsctatracking',
  'ref_src',
  'ref_url',
  'spm',
  'scid',
  'trk',
  'trkcampaign',
  'cmpid',
  'ncid',
  'ito',
  's_cid',
  'wtrid',
  'at_medium',
  'at_campaign',
  'sourceid',
]);

const isTracking = (key) => {
  const k = key.toLowerCase();
  return k.startsWith('utm_') || k.startsWith('pk_') || k.startsWith('mtm_') || TRACKING_PARAMS.has(k);
};

/**
 * Normalize a URL to its identity form.
 * @param {string} input
 * @returns {string} the Normalized URL
 * @throws {Error} when the input is not an http(s) URL
 */
export function normalizeUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw) throw new Error('No URL given.');

  // Bare hosts ("example.com/x") are common in shared text; assume https.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;

  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`Not a URL: ${raw}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Not a web page: ${raw}`);
  }

  url.protocol = 'https:';
  url.username = '';
  url.password = '';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  if (url.port === '443' || url.port === '80') url.port = '';

  const params = [...url.searchParams.entries()].filter(([key]) => !isTracking(key));
  // Sort so that two orderings of the same parameters are one Item.
  params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  url.search = params.length ? `?${params.map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&')}` : '';

  // Fragments address a position within a page, not a different page — except
  // hashbang routes, where they address the page itself.
  if (!url.hash.startsWith('#!')) url.hash = '';

  if (url.pathname !== '/' && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }

  // A bare host keeps no trailing slash either: example.com and example.com/
  // are one Item. (The URL class insists on a "/" path, so trim the string.)
  return url.toString().replace(/^(https:\/\/[^/?#]+)\/$/, '$1');
}

const enc = (s) => encodeURIComponent(s).replace(/%20/g, '+');

/** The host as shown in the UI: no scheme, no `www.`, no path. */
export function displayHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Pull the first http(s) URL out of shared text. Android often sends URL and title as one blob. */
export function firstUrlIn(text) {
  const match = String(text ?? '').match(/https?:\/\/[^\s<>"']+/i);
  return match ? match[0] : null;
}
