'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parse } = require('../folds');

const available = spawnSync('vim', ['--version']).status === 0;
const cases = [
  ['// {{{1', 'a', '// {{{3', 'b', '// }}}3', 'c', '// }}}1', 'tail'],
  ['// {{{', 'a', '// {{{3', 'b', '// }}}', 'c', '// }}}', 'tail'],
  ['// {{{2', 'a', '// {{{', 'b', '// }}}', 'c', '// }}}1', 'tail'],
  ['// {{{', 'a', '// }}}2', 'b', 'tail'],
  ['// }}}3', 'b', '// }}}1', 'tail'],
  ['// {{{1', 'a', '// {{{1', 'b', 'tail'],
  ['// {{{', 'a', '// {{{', 'b', '// }}}', '// }}}', 'tail'],
  ['// {{{0', 'a', '// }}}0', 'tail'],
  ['// {{{', 'a', '// }}}', 'tail'],
];
test(
  'marker levels match the real Vim folding engine',
  { skip: !available },
  () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'vim-fold-reference-')
    );
    try {
      for (const [index, lines] of cases.entries()) {
        const output = path.join(directory, `${index}.json`);
        const script = path.join(directory, `${index}.vim`);
        fs.writeFileSync(
          script,
          [
            'set nocompatible foldmethod=marker foldlevel=0',
            `call setline(1, ${JSON.stringify(lines)})`,
            `call writefile([json_encode(map(range(1,line("$")),"foldlevel(v:val)"))], ${JSON.stringify(output)})`,
            'qa!',
          ].join('\n') + '\n'
        );
        const result = spawnSync(
          'vim',
          ['-Nu', 'NONE', '-n', '-es', '-S', script],
          { encoding: 'utf8' }
        );
        assert.equal(result.status, 0, result.stderr);
        const folds = parse(lines);
        const actual = lines.map(
          (_, line) =>
            folds.filter((f) => f.start.line <= line && f.end.line >= line)
              .length
        );
        assert.deepEqual(
          actual,
          JSON.parse(fs.readFileSync(output, 'utf8')),
          JSON.stringify(lines)
        );
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
);
