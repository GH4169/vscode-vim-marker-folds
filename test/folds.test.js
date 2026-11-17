'use strict';
const { test } = require('node:test'),
  a = require('node:assert/strict');
const {
  parse,
  template,
  appendMarker,
  safeRemoval,
  innermost,
  selectionLines,
  atCursor,
  deletionTargets,
} = require('../folds');
const { closedFolds } = require('../line-counts');
test('nested and numbered markers', () => {
  const f = parse(['// {{{', '// {{{', 'x', '// }}}', '// }}}']);
  a.equal(f.length, 2);
  a.equal(innermost(f, 2).start.line, 1);
  const numbered = parse(['// {{{1', '// {{{2', 'x', '// }}}1']);
  a.equal(numbered.length, 2);
  a.ok(numbered.every((x) => x.shared));
});
test('safe comments and deletion, no JSON fallback', () => {
  a.equal(template('json'), undefined);
  a.equal(appendMarker('x;', '{{{', '// %s'), 'x; // {{{');
  a.equal(appendMarker('x /* hi */', '{{{', '/* %s */'), 'x /* hi {{{ */');
  a.deepEqual(safeRemoval('x; // {{{', { column: 6, length: 3 }, '// %s'), {
    start: 2,
    end: 9,
  });
  a.deepEqual(
    safeRemoval('// {{{ explanation', { column: 3, length: 3 }, '// %s'),
    { start: 3, end: 6 }
  );
  a.deepEqual(
    safeRemoval('// explanation {{{', { column: 15, length: 3 }, '// %s'),
    { start: 15, end: 18 }
  );
});
test('Vim visual endpoints are inclusive, VS Code ranges are exclusive', () => {
  const selection = {
    start: { line: 2, character: 1 },
    end: { line: 4, character: 0 },
  };
  a.deepEqual(selectionLines(selection, true), { first: 2, last: 4 });
  a.deepEqual(selectionLines(selection), { first: 2, last: 3 });
});
test('delete targets the visible closed fold or the innermost open fold', () => {
  const folds = parse(['// {{{', '// {{{', 'x', '// }}}', '// }}}', 'tail']);
  a.equal(atCursor(folds, [folds[0]], 1), folds[0]);
  a.equal(atCursor(folds, [], 1), folds[1]);
  a.deepEqual(deletionTargets(folds, [folds[0]], 0, 0, true), folds);
  a.deepEqual(deletionTargets(folds, [], 1, 1), [folds[1]]);
});
test('single line folds can be created without overlapping edits', () => {
  const text = appendMarker(appendMarker('x;', '{{{', '// %s'), '}}}', '// %s');
  const folds = parse([text]);
  a.equal(folds.length, 1);
  a.equal(folds[0].start.line, folds[0].end.line);
});
test('append preserves existing whitespace', () => {
  a.equal(appendMarker('x;  ', '{{{', '// %s'), 'x;  // {{{');
  a.equal(appendMarker('  ', '{{{', '// %s'), '  // {{{');
});
test('numbered levels interoperate with unnumbered levels and ignore zero', () => {
  const lines = [
    '// {{{',
    'x',
    '// {{{3',
    'x',
    '// }}}',
    'x',
    '// }}}',
    'tail',
  ];
  const folds = parse(lines);
  const levels = lines.map(
    (_, line) =>
      folds.filter((f) => f.start.line <= line && f.end.line >= line).length
  );
  a.deepEqual(levels, [1, 1, 3, 3, 3, 2, 2, 1]);
  a.equal(parse(['// {{{0', 'x', '// }}}0']).length, 0);
});
test('visible gaps identify collapsed folds without using scrolling', () => {
  const folds = parse(['// {{{', 'a', 'b', '// }}}', 'x']);
  a.equal(
    closedFolds(folds, [
      { start: { line: 0 }, end: { line: 0 } },
      { start: { line: 4 }, end: { line: 4 } },
    ]).length,
    1
  );
  a.equal(
    closedFolds(folds, [{ start: { line: 1 }, end: { line: 4 } }]).length,
    0
  );
});
test('EOF counts rely on observed command state instead of viewport guesses', () => {
  const folds = parse(['// {{{', 'a', '// }}}']);
  const viewport = [{ start: { line: 0 }, end: { line: 0 } }];
  a.equal(closedFolds(folds, viewport).length, 0);
  a.equal(closedFolds(folds, viewport, folds).length, 1);
});
