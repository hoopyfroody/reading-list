#!/usr/bin/env node
// The Todos Skill's front door. Same engine as the reading list — the `gh`
// transport and the data repo config come from tools/gh.mjs, and the fold is
// the same one the browser runs — but a different file and a different set of
// verbs, because a Todo is not an Item.
//
//   todos.mjs list [--json] [--done]   — print the Todos, or the Done ones
//   todos.mjs add <text>
//   todos.mjs done <text> | undone <text> | remove <text>
//
// Identity is the text, matched loosely on the way in so you do not have to
// retype a Todo exactly to tick it off.

import { commit } from '../../../lib/sync.js';
import { TODOS } from '../../../lib/documents.js';
import { todoOp } from '../../../lib/todo-fold.js';
import { loadConfig, requireConfig, ghTransport, argsOf } from '../../../tools/gh.mjs';

const { command, positional, has } = argsOf(process.argv.slice(2));
const config = loadConfig();

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

async function main() {
  if (!command || has('help')) return usage();

  requireConfig(config);
  const transport = ghTransport(config, TODOS);

  if (command === 'list') {
    const { text } = await transport.read();
    const todos = TODOS.parse(text);
    const chosen = todos.filter((todo) => (has('done') ? todo.done : !todo.done));

    if (has('json')) return console.log(JSON.stringify(chosen, null, 2));
    if (!chosen.length) return console.log(has('done') ? 'Nothing Done yet.' : 'Nothing to do.');
    for (const todo of chosen) console.log(`${todo.done ? '[x]' : '[ ]'} ${todo.text}`);
    return;
  }

  const given = positional.join(' ').trim();
  if (!given) throw new Error(`Give the Todo: todos.mjs ${command} "<text>"`);

  if (command === 'add') {
    const operation = todoOp('add', given);
    const result = await commit(transport, [operation], { document: TODOS });
    const todo = result.items.find((t) => t.text === operation.text);
    console.log(`Added: ${todo?.text ?? operation.text}`);
    if (!result.wrote) console.log('(already on the list)');
    return;
  }

  const verb = { done: 'setDone', undone: 'setDone', remove: 'remove' }[command];
  if (!verb) return usage(1);

  // Ticking something off should not require retyping it exactly. Resolve what
  // was typed against what is actually there, and refuse rather than guess
  // when it is ambiguous.
  const { text } = await transport.read();
  const match = resolve(TODOS.parse(text), given);

  const fields = command === 'done' ? { done: true } : command === 'undone' ? { done: false } : {};
  const result = await commit(transport, [todoOp(verb, match.text, fields)], { document: TODOS });

  const said = { done: 'Done', undone: 'Back on the list', remove: 'Removed' }[command];
  console.log(`${said}: ${match.text}`);
  if (!result.wrote) console.log('(the list already said so)');
}

/** Exact first, then unique substring. Never a guess between two candidates. */
function resolve(todos, given) {
  const wanted = given.toLowerCase();
  const exact = todos.find((todo) => todo.text.toLowerCase() === wanted);
  if (exact) return exact;

  const near = todos.filter((todo) => todo.text.toLowerCase().includes(wanted));
  if (near.length === 1) return near[0];
  if (near.length > 1) {
    throw new Error(
      `That matches ${near.length} Todos:\n${near.map((t) => `  ${t.text}`).join('\n')}\nSay which one.`,
    );
  }
  throw new Error(`No Todo matches “${given}”. Run: todos.mjs list`);
}

function usage(code = 0) {
  console.log(`todos

  list [--done] [--json]     print the Todos, or the Done ones
  add <text>                 add a Todo
  done <text>                tick it off — moves it to Done
  undone <text>              put it back on the list
  remove <text>              destroy it and the record it existed

The data repo is the reading list's: set it with
  node .claude/skills/reading-list/list.mjs where owner/repo
`);
  process.exit(code);
}
