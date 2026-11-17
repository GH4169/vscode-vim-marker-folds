'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('../folds');
const { FoldState, depths, navigationTarget } = require('../fold-state');
const folds = parse([
  'a // {{{',
  'b // {{{',
  'c',
  'd // }}}',
  'e // }}}',
  'tail',
]);

test('tracked fold state detects opening without mistaking viewport edges for folding', () => {
  const state = new FoldState();
  state.set(folds, true);
  assert.equal(
    state.getClosed(folds, [{ start: { line: 0 }, end: { line: 0 } }]).length,
    2
  );
  assert.deepEqual(
    state.getClosed(folds, [
      { start: { line: 0 }, end: { line: 1 } },
      { start: { line: 4 }, end: { line: 5 } },
    ]),
    [folds[1]]
  );
  assert.deepEqual(
    state.getClosed(folds, [{ start: { line: 0 }, end: { line: 5 } }]),
    []
  );
});
test('depth is reset between disjoint folds', () => {
  const other = parse([
    'a // {{{',
    'b',
    'c // }}}',
    'd // {{{',
    'e',
    'f // }}}',
  ]);
  assert.deepEqual(
    depths(folds).map((entry) => entry.depth),
    [1, 2]
  );
  assert.deepEqual(
    depths(other).map((entry) => entry.depth),
    [1, 1]
  );
});
test('fold navigation hides nested destinations inside closed folds', () => {
  assert.equal(navigationTarget(folds, [], 0, 'nextFold'), 1);
  assert.equal(navigationTarget(folds, [folds[0]], 0, 'nextFold'), undefined);
  assert.equal(navigationTarget(folds, [], 5, 'previousFold'), 4);
  assert.equal(navigationTarget(folds, [folds[0]], 5, 'previousFold'), 0);
  assert.equal(navigationTarget(folds, [], 2, 'foldStart'), 1);
  assert.equal(navigationTarget(folds, [], 1, 'foldStart'), 0);
  assert.equal(navigationTarget(folds, [], 2, 'foldEnd'), 3);
});
