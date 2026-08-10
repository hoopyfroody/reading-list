import test from 'node:test';
import assert from 'node:assert/strict';

import { parseTodos, serializeTodos } from '../lib/todos.js';
import { foldTodo, foldAllTodos, todoOp, messageForTodos } from '../lib/todo-fold.js';
import { commit, StaleError } from '../lib/sync.js';
import { TODOS } from '../lib/documents.js';

/* ── The file ───────────────────────────────────────────────────────────── */

const SAMPLE = `# Todos

- [ ] Call the dentist
- [ ] Renew the passport

## Done

- [x] Book the flights
`;

test('parses Todos, sections and the box', () => {
  const todos = parseTodos(SAMPLE);
  assert.deepEqual(todos, [
    { text: 'Call the dentist', done: false },
    { text: 'Renew the passport', done: false },
    { text: 'Book the flights', done: true },
  ]);
});

test('round-trips', () => {
  assert.equal(serializeTodos(parseTodos(SAMPLE)), SAMPLE);
  assert.equal(serializeTodos(parseTodos(serializeTodos(parseTodos(SAMPLE)))), SAMPLE);
});

test('serializes an empty list to a file you can still hand-edit', () => {
  assert.equal(serializeTodos([]), '# Todos\n\n## Done\n');
  assert.deepEqual(parseTodos(serializeTodos([])), []);
});

test('the box wins over the section, because ticking it is the natural hand-edit', () => {
  const todos = parseTodos(`# Todos

- [x] Ticked in the GitHub app
- [ ] Still to do

## Done

- [ ] Unticked in the GitHub app
`);
  assert.deepEqual(todos, [
    { text: 'Ticked in the GitHub app', done: true },
    { text: 'Still to do', done: false },
    { text: 'Unticked in the GitHub app', done: false },
  ]);
});

test('a bullet typed without a box takes the section', () => {
  const todos = parseTodos(`# Todos

- Typed in a hurry

## Done

- Finished in a hurry
`);
  assert.deepEqual(todos, [
    { text: 'Typed in a hurry', done: false },
    { text: 'Finished in a hurry', done: true },
  ]);
});

test('survives hand edits and stray prose', () => {
  const todos = parseTodos(`# Todos

A note to myself that is not a Todo.

- [ ] Fine
- [ ]
- [ ] Also fine
`);
  assert.deepEqual(
    todos.map((t) => t.text),
    ['Fine', 'Also fine'],
  );
});

test('escapes brackets so a Todo about a [thing] round-trips', () => {
  const todos = [{ text: 'Reply to [Sam] about \\ escapes', done: false }];
  assert.deepEqual(parseTodos(serializeTodos(todos)), todos);
});

test('the same text twice by hand is one Todo', () => {
  const todos = parseTodos(`# Todos

- [ ] Water the plants
- [ ] Water   the plants

## Done
`);
  assert.equal(todos.length, 1);
});

/* ── Folding ────────────────────────────────────────────────────────────── */

const addTodo = (text) => todoOp('add', text);
const setDone = (text, done) => todoOp('setDone', text, { done });

test('add is idempotent because identity is the text', () => {
  const once = foldTodo([], addTodo('Call the dentist'));
  const twice = foldTodo(once, addTodo('Call  the dentist'));
  assert.equal(twice.length, 1);
});

test('adds land oldest first — the thing you have been dodging stays visible', () => {
  const todos = foldAllTodos([], [addTodo('First'), addTodo('Second')]);
  assert.deepEqual(
    todos.map((t) => t.text),
    ['First', 'Second'],
  );
});

test('Done Todos sit below the live ones, newest Done first', () => {
  const todos = foldAllTodos(
    [],
    [addTodo('A'), addTodo('B'), addTodo('C'), setDone('A', true), setDone('B', true)],
  );
  assert.deepEqual(todos, [
    { text: 'C', done: false },
    { text: 'B', done: true },
    { text: 'A', done: true },
  ]);
});

test('Done is a toggle, and un-Done goes back to the bottom of the live list', () => {
  const todos = foldAllTodos(
    [],
    [addTodo('A'), addTodo('B'), setDone('A', true), setDone('A', false)],
  );
  assert.deepEqual(todos, [
    { text: 'B', done: false },
    { text: 'A', done: false },
  ]);
});

test('adding a Todo that is already Done resurrects it', () => {
  const todos = foldAllTodos([], [addTodo('Water the plants'), setDone('Water the plants', true), addTodo('Water the plants')]);
  assert.deepEqual(todos, [{ text: 'Water the plants', done: false }]);
});

test('only add may create a Todo — setDone on a removed Todo no-ops', () => {
  assert.deepEqual(foldTodo([], setDone('Gone', true)), []);
  assert.deepEqual(foldTodo([], todoOp('remove', 'Gone')), []);
});

test('remove destroys the record; a later replay does not resurrect it', () => {
  const ops = [addTodo('A'), todoOp('remove', 'A')];
  assert.deepEqual(foldAllTodos([], ops), []);
  assert.deepEqual(foldAllTodos(foldAllTodos([], ops), ops), []);
});

test('folding the same ops twice lands in the same place', () => {
  const ops = [addTodo('A'), addTodo('B'), setDone('A', true)];
  assert.deepEqual(foldAllTodos([], ops), foldAllTodos(foldAllTodos([], ops), ops));
});

test('an empty Todo is not a Todo', () => {
  assert.throws(() => todoOp('add', '   '));
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

test('commit writes the folded Todos', async () => {
  const { transport, state } = fakeRemote();
  const result = await commit(transport, [addTodo('Call the dentist')], { document: TODOS });
  assert.equal(result.wrote, true);
  assert.match(state.text, /- \[ \] Call the dentist/);
});

test('a concurrent write is folded onto, not clobbered', async () => {
  const { transport, state } = fakeRemote(serializeTodos([]));
  state.interfere = `# Todos

- [ ] Added on the Mac

## Done
`;

  const result = await commit(transport, [addTodo('Added on the phone')], { document: TODOS });
  const texts = result.items.map((t) => t.text);
  assert.ok(texts.includes('Added on the Mac'), 'the other writer survives');
  assert.ok(texts.includes('Added on the phone'), 'our op still lands');
  assert.equal(state.writes, 2, 'one rejected write, then one that sticks');
});

test('replaying ops already reflected in the file writes nothing', async () => {
  const { transport, state } = fakeRemote();
  const ops = [addTodo('A')];
  await commit(transport, ops, { document: TODOS });
  const again = await commit(transport, ops, { document: TODOS });
  assert.equal(again.wrote, false);
  assert.equal(state.writes, 1);
});

test('commit messages read like a log of what you did', () => {
  assert.equal(messageForTodos([addTodo('Call the dentist')]), 'Add “Call the dentist”');
  assert.equal(messageForTodos([setDone('Call the dentist', true)]), 'Done “Call the dentist”');
  assert.equal(messageForTodos([setDone('Call the dentist', false)]), 'Undone “Call the dentist”');
  assert.equal(messageForTodos([todoOp('remove', 'Call the dentist')]), 'Remove “Call the dentist”');
  assert.equal(messageForTodos([addTodo('A'), addTodo('B')]), 'Sync 2 changes');
  assert.equal(
    messageForTodos([addTodo('A todo with a really quite long piece of text that would not read well in a git log at all')]),
    'Add “A todo with a really quite long piece of text that would…”',
  );
});
