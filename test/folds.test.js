'use strict';
const { test } = require('node:test'),
  a = require('node:assert/strict');
const {
  parse,
  template,
  appendMarker,
  safeRemoval,
  innermost,
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
  a.equal(
    safeRemoval('// {{{ explanation', { column: 3, length: 3 }, '// %s'),
    null
  );
  a.equal(
    safeRemoval('// explanation {{{', { column: 15, length: 3 }, '// %s'),
    null
  );
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
