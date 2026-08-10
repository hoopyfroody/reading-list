import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeUrl, firstUrlIn } from '../lib/normalize.js';
import { parse, serialize } from '../lib/markdown.js';
import { fold, foldAll, op, messageFor } from '../lib/fold.js';
import { tidyTitle } from '../lib/title.js';
import { commit, StaleError } from '../lib/sync.js';

/* ── Normalized URL is identity ─────────────────────────────────────────── */

test('normalizes scheme, host and trailing slash', () => {
  assert.equal(normalizeUrl('HTTP://WWW.Example.com/Post/'), 'https://example.com/Post');
  assert.equal(normalizeUrl('example.com'), 'https://example.com');
  assert.equal(normalizeUrl('https://example.com/'), 'https://example.com');
});

test('strips tracking parameters but keeps meaningful ones', () => {
  assert.equal(
    normalizeUrl('https://example.com/a?utm_source=x&id=7&fbclid=abc'),
    'https://example.com/a?id=7',
  );
  assert.equal(normalizeUrl('https://example.com/a?b=2&a=1'), normalizeUrl('https://example.com/a?a=1&b=2'));
});

test('drops position fragments but keeps hashbang routes', () => {
  assert.equal(normalizeUrl('https://example.com/a#section'), 'https://example.com/a');
  assert.equal(normalizeUrl('https://example.com/a#!/route'), 'https://example.com/a#!/route');
});

test('rejects things that are not web pages', () => {
  assert.throws(() => normalizeUrl('mailto:someone@example.com'));
  assert.throws(() => normalizeUrl(''));
});

test('finds the URL inside shared text', () => {
  assert.equal(firstUrlIn('Look at this https://example.com/a thanks'), 'https://example.com/a');
  assert.equal(firstUrlIn('no link here'), null);
});

/* ── The file ───────────────────────────────────────────────────────────── */

const SAMPLE = `# Reading list

- ★ [Starred thing](https://example.com/one)
  Why it matters.
- [Plain thing](https://example.com/two)

## Archive

- [Already read](https://example.com/three)
  Read a while ago.
`;

test('parses items, sections, stars and descriptions', () => {
  const items = parse(SAMPLE);
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], {
    url: 'https://example.com/one',
    title: 'Starred thing',
    description: 'Why it matters.',
    read: false,
    star: true,
  });
  assert.equal(items[1].star, false);
  assert.equal(items[1].description, null);
  assert.equal(items[2].read, true);
});

test('round-trips', () => {
  assert.equal(serialize(parse(SAMPLE)), SAMPLE);
  assert.equal(serialize(parse(serialize(parse(SAMPLE)))), SAMPLE);
});

test('serializes an empty list to a file you can still hand-edit', () => {
  assert.equal(serialize([]), '# Reading list\n\n## Archive\n');
  assert.deepEqual(parse(serialize([])), []);
});

test('survives hand edits and stray prose', () => {
  const items = parse(`# Reading list

Some note I typed on my phone.

- [Fine](https://example.com/a)
- this is not an item
- [Broken](not a url)
- [Also fine](https://example.com/b)
`);
  assert.deepEqual(
    items.map((i) => i.url),
    ['https://example.com/a', 'https://example.com/b'],
  );
});

test('escapes brackets in titles so they round-trip', () => {
  const items = [{ url: 'https://example.com/a', title: 'A [bracketed] title', description: null, read: false, star: false }];
  assert.deepEqual(parse(serialize(items)), items);
});

test('collapses a URL that appears twice by hand', () => {
  const items = parse(`# Reading list

- [First](https://example.com/a)
- [Same page](https://www.example.com/a/)
  With a description.

## Archive
`);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'First');
  assert.equal(items[0].description, 'With a description.');
});

/* ── Folding ────────────────────────────────────────────────────────────── */

const add = (url, fields) => op('add', url, fields);

test('add is idempotent because identity is the URL', () => {
  const once = fold([], add('https://example.com/a', { title: 'A' }));
  const twice = fold(once, add('https://www.example.com/a/', { title: 'A' }));
  assert.equal(twice.length, 1);
});

test('adds land newest first', () => {
  const items = foldAll([], [add('https://example.com/a'), add('https://example.com/b')]);
  assert.deepEqual(
    items.map((i) => i.url),
    ['https://example.com/b', 'https://example.com/a'],
  );
});

test('a non-null description beats a null one, whichever arrives first', () => {
  const shareThenSkill = foldAll(
    [],
    [add('https://example.com/a', { title: 'A' }), add('https://example.com/a', { description: 'Backfilled.' })],
  );
  const skillThenShare = foldAll(
    [],
    [add('https://example.com/a', { description: 'Backfilled.' }), add('https://example.com/a', { title: 'A' })],
  );
  assert.equal(shareThenSkill[0].description, 'Backfilled.');
  assert.equal(skillThenShare[0].description, 'Backfilled.');
  assert.equal(shareThenSkill[0].title, 'A');
  assert.equal(skillThenShare[0].title, 'A');
});

test('an add never changes Read or Star', () => {
  const before = [{ url: 'https://example.com/a', title: 'A', description: null, read: true, star: true }];
  const after = fold(before, add('https://example.com/a', { title: 'A', description: 'New.' }));
  assert.equal(after[0].read, true);
  assert.equal(after[0].star, true);
  assert.equal(after[0].description, 'New.');
});

test('only add may create an Item — setRead on a removed Item no-ops', () => {
  assert.deepEqual(fold([], op('setRead', 'https://example.com/gone', { read: true })), []);
  assert.deepEqual(fold([], op('setStar', 'https://example.com/gone', { star: true })), []);
  assert.deepEqual(fold([], op('remove', 'https://example.com/gone')), []);
});

test('read is a toggle, not a one-way door', () => {
  const items = foldAll(
    [],
    [
      add('https://example.com/a', { title: 'A' }),
      op('setRead', 'https://example.com/a', { read: true }),
      op('setRead', 'https://example.com/a', { read: false }),
    ],
  );
  assert.equal(items[0].read, false);
});

test('remove destroys the record; a later replay does not resurrect it', () => {
  const ops = [add('https://example.com/a', { title: 'A' }), op('remove', 'https://example.com/a')];
  assert.deepEqual(foldAll([], ops), []);
  assert.deepEqual(foldAll(foldAll([], ops), ops), []);
});

/* ── Titles stay scannable ──────────────────────────────────────────────── */

const GITHUB_TITLE =
  'eugeniughelbur/obsidian-second-brain: Persistent memory for Claude Code and 6 other CLI agents, stored as plain markdown in your Obsidian vault.';

test('a short Title is left exactly as the page wrote it', () => {
  assert.equal(tidyTitle('The End of No Code'), 'The End of No Code');
  assert.equal(tidyTitle('Reasonix — DeepSeek-native coding agent for your terminal'), 'Reasonix — DeepSeek-native coding agent for your terminal');
});

test('an over-long Title loses the gloss after the separator', () => {
  assert.equal(tidyTitle(GITHUB_TITLE), 'eugeniughelbur/obsidian-second-brain');
});

test('a Title with no separator is cut at a word boundary and marked', () => {
  const title = tidyTitle(`Why ${'everything '.repeat(12)}matters`);
  assert.ok(title.length <= 81, title);
  assert.ok(title.endsWith('…'));
  assert.ok(!title.includes('  '));
});

test('a stubby head is not mistaken for the Title', () => {
  // "Rust" alone would say nothing; the cut falls back to the length rule.
  const title = tidyTitle(`Rust: ${'a systems language for the long haul '.repeat(4)}`);
  assert.ok(title.startsWith('Rust: a systems'), title);
});

test('folding tidies the Title on every Capture path', () => {
  const items = fold([], add('https://github.com/eugeniughelbur/obsidian-second-brain', { title: GITHUB_TITLE }));
  assert.equal(items[0].title, 'eugeniughelbur/obsidian-second-brain');
});

/* ── Replay onto fresh state ────────────────────────────────────────────── */

function fakeRemote(initial = '') {
  const state = { text: initial, sha: initial ? 'sha-0' : null, writes: 0, interfere: null };
  return {
    state,
    transport: {
      async read() {
        return { text: state.text, sha: state.sha };
      },
      async write(text, sha) {
        state.writes++;
        if (state.interfere) {
          // Another writer got there first — the Skill, or the other device.
          state.text = state.interfere;
          state.sha = 'sha-other';
          state.interfere = null;
          throw new StaleError('stale');
        }
        if (sha !== state.sha) throw new StaleError('stale');
        state.text = text;
        state.sha = `sha-${state.writes}`;
        return { sha: state.sha };
      },
    },
  };
}

test('commit writes the folded list', async () => {
  const { transport, state } = fakeRemote();
  const result = await commit(transport, [add('https://example.com/a', { title: 'A' })]);
  assert.equal(result.wrote, true);
  assert.match(state.text, /\[A\]\(https:\/\/example\.com\/a\)/);
});

test('a concurrent write is folded onto, not clobbered', async () => {
  const { transport, state } = fakeRemote(serialize(parse('# Reading list\n\n## Archive\n')));
  state.interfere = `# Reading list

- [From the Skill](https://example.com/skill)
  Generated by reading the page.

## Archive
`;

  const result = await commit(transport, [add('https://example.com/phone', { title: 'From the phone' })]);
  const urls = result.items.map((i) => i.url);
  assert.ok(urls.includes('https://example.com/skill'), 'the other writer survives');
  assert.ok(urls.includes('https://example.com/phone'), 'our op still lands');
  assert.equal(state.writes, 2, 'one rejected write, then one that sticks');
});

test('replaying ops already reflected in the file writes nothing', async () => {
  const { transport, state } = fakeRemote();
  const ops = [add('https://example.com/a', { title: 'A' })];
  await commit(transport, ops);
  const again = await commit(transport, ops);
  assert.equal(again.wrote, false);
  assert.equal(state.writes, 1);
});

test('commit messages read like a log of what you did', () => {
  assert.equal(messageFor([add('https://www.example.com/a')]), 'Add example.com');
  assert.equal(messageFor([op('setRead', 'https://example.com/a', { read: true })]), 'Read example.com');
  assert.equal(messageFor([op('setStar', 'https://example.com/a', { star: false })]), 'Unstar example.com');
  assert.equal(messageFor([add('https://example.com/a'), add('https://example.com/b')]), 'Sync 2 changes');
});
