// The escaping both documents share. Titles and Todo text are written into
// markdown a human edits by hand, so a bracket someone typed must survive the
// round trip and must not turn into a link or a checkbox.

/** One line, one space between words — the file has no use for the rest. */
export const collapse = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

export function escapeText(s) {
  return collapse(s).replace(/([\\[\]])/g, '\\$1');
}

export function unescapeText(s) {
  return String(s ?? '').replace(/\\([\\[\]])/g, '$1');
}
