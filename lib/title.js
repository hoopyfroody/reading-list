// A Title is captured verbatim, but "verbatim" has a limit.
//
// Some pages title themselves with a whole paragraph. GitHub is the worst
// offender: a repo page's title is `owner/repo: <the entire repo description>`,
// which arrives as a 300-character Title through every Capture path — the
// Share Target reads it from the sharing app, and the Skill reads it from the
// page. The list is meant to be scannable, and one Item wrapping over four
// lines ruins that.
//
// So a Title is shortened, never rewritten. What survives is always a literal
// prefix of what the page said, and a trailing `…` marks any cut.

/** Longer than this and a Title stops being scannable. */
const LIMIT = 80;

/** Below this, a head is too stubby to stand as the Title on its own. */
const MIN_HEAD = 15;

// Ordered by how strongly each one separates a name from its gloss. A page
// says `owner/repo: description` or `Post — Site`; in both the name is first.
const SEPARATORS = [' — ', ' – ', ' | ', ' · ', ' :: ', ': ', ' - '];

/**
 * Shorten a page's Title to something scannable.
 * @param {string} input the Title exactly as the page or share sheet gave it
 * @returns {string} a prefix of it, at most LIMIT characters plus an ellipsis
 */
export function tidyTitle(input) {
  const text = String(input ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= LIMIT) return text;

  // Only over-long Titles get split. Under the limit a subtitle is usually
  // saying something, and dropping it would lose more than it saves.
  return truncate(dropGloss(text));
}

/** Keep the part before the first separator that leaves a usable head. */
function dropGloss(text) {
  let best = null;
  for (const separator of SEPARATORS) {
    const at = text.indexOf(separator);
    if (at >= MIN_HEAD && (best === null || at < best)) best = at;
  }
  return best === null ? text : text.slice(0, best);
}

/** Cut at a word boundary, so the Title never ends mid-word. */
function truncate(text) {
  if (text.length <= LIMIT) return text;
  const cut = text.slice(0, LIMIT);
  const space = cut.lastIndexOf(' ');
  return `${(space >= MIN_HEAD ? cut.slice(0, space) : cut).trimEnd()}…`;
}
