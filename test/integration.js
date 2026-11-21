'use strict';
const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { parse } = require('../folds');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  const results = [];
  const vim = vscode.extensions.getExtension('vscodevim.vim');
  await vim.activate();
  const api = require(path.resolve(vim.extensionPath, vim.packageJSON.main));
  const barriers = new Map();
  let barrierId = 0;
  vscode.commands.registerCommand('test.markerFolds.idle', (id) => {
    barriers.get(id)?.();
  });
  // VSCodeVim's type/remap commands enqueue work and return immediately.
  // A command at the end of that same queue is a deterministic completion signal.
  async function idle() {
    const id = barrierId++;
    const complete = new Promise((resolve) => barriers.set(id, resolve));
    let timeout;
    const timer = new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Vim queue timeout')), 10000);
    });
    await vscode.commands.executeCommand('vim.remap', {
      commands: [{ command: 'test.markerFolds.idle', args: id }],
    });
    try {
      await Promise.race([complete, timer]);
    } finally {
      clearTimeout(timeout);
      barriers.delete(id);
    }
    await delay(100);
  }
  let editor;
  let serial = 0;
  const record = async (name, callback) => {
    if (
      process.env.MARKER_FOLDS_TEST_FILTER &&
      !new RegExp(process.env.MARKER_FOLDS_TEST_FILTER).test(name)
    )
      return;
    try {
      await callback();
      results.push({ name, passed: true });
    } catch (error) {
      results.push({ name, passed: false, error: error.stack });
    }
    await fs.writeFile(
      path.join(process.env.MARKER_FOLDS_TEST_RESULTS, 'integration.json'),
      JSON.stringify(results, null, 2)
    );
  };
  const type = async (text) => {
    for (const character of text) {
      await vscode.commands.executeCommand('type', { text: character });
      await delay(30);
    }
    await idle();
  };
  const escape = async () => {
    await vscode.commands.executeCommand('extension.vim_escape');
    await idle();
  };
  async function position(line, character = 0) {
    await escape();
    const p = new vscode.Position(line, character);
    editor.selection = new vscode.Selection(p, p);
    editor.revealRange(new vscode.Range(p, p));
    await delay(100);
    await idle();
    const handler = await api.getAndUpdateModeHandler();
    handler.syncCursors();
    return handler;
  }
  async function open(text) {
    const file = path.join(
      process.env.MARKER_FOLDS_TEST_WORKSPACE,
      `sample-${serial++}.v`
    );
    await fs.writeFile(file, text);
    const doc = await vscode.workspace.openTextDocument(file);
    editor = await vscode.window.showTextDocument(doc);
    await vscode.languages.setTextDocumentLanguage(doc, 'verilog');
    await delay(400);
    await position(0);
    return doc;
  }
  const ranges = (doc) =>
    parse(doc.getText().split(/\r?\n/)).map((f) => [f.start.line, f.end.line]);
  const hidden = (line) =>
    !editor.visibleRanges.some(
      (range) => range.start.line <= line && range.end.line >= line
    );
  const sample = 'module x(\n  a,\n  b\n);\ntail\n';
  await open(sample);
  for (const id of ['local.vim-sv-match', 'local.gvim-marker-folds'])
    await vscode.extensions.getExtension(id).activate();

  for (const [name, line, character] of [
    ['forward', 0, 8],
    ['backward', 3, 0],
  ]) {
    await record(
      `zf% parentheses ${name}: markers, collapse, mode and undo`,
      async () => {
        const doc = await open(sample);
        const handler = await position(line, character);
        await type('zf');
        assert.ok(
          handler.vimState.recordedState.operator,
          'zf must wait for a motion'
        );
        assert.equal(doc.getText(), sample);
        await type('%');
        assert.deepEqual(ranges(doc), [[0, 3]]);
        assert.ok(
          hidden(1),
          'created fold must close immediately: ' +
            JSON.stringify({
              visible: editor.visibleRanges,
              selection: editor.selection,
              cursors: handler.vimState.cursors,
            })
        );
        assert.equal(handler.vimState.currentMode, 0);
        await type('u');
        assert.equal(doc.getText(), sample, 'Vim u must remove both markers');
      }
    );
  }
  for (const [keys, line, expected] of [
    ['zf2j', 0, [0, 2]],
    ['2zfj', 0, [0, 2]],
    ['zfk', 2, [1, 2]],
    ['3zF', 0, [0, 2]],
    ['zfG', 0, [0, 5]],
    ['zfi(', 1, [1, 2]],
  ])
    await record(`${keys}: native motion range`, async () => {
      const doc = await open(sample);
      await position(line);
      await type(keys);
      assert.deepEqual(ranges(doc), [expected]);
    });
  await record('zf Escape cancels without modifying text', async () => {
    const doc = await open(sample);
    await type('zf');
    await escape();
    await type('%');
    assert.equal(doc.getText(), sample);
  });
  for (const line of [0, 2])
    await record(`zf% SV begin/end from line ${line + 1}`, async () => {
      const doc = await open('begin\n  x = 1;\nend\ntail\n');
      await position(line);
      await type('zf%');
      assert.deepEqual(ranges(doc), [[0, 2]]);
      assert.ok(hidden(1));
    });
  await record(
    'failed zf% and failed zffind do not create markers',
    async () => {
      const text = 'begin\n  x = 1;\ntail\n';
      const doc = await open(text);
      await type('zf%');
      assert.equal(doc.getText(), text);
      await type('zffZ');
      assert.equal(doc.getText(), text);
    }
  );
  await record('dot repeats a fold and redo restores markers', async () => {
    const doc = await open('a\nb\nc\nd\ne\nf\ntail\n');
    await type('zf2j');
    await position(3);
    await type('.');
    assert.deepEqual(ranges(doc), [
      [0, 2],
      [3, 5],
    ]);
    await type('u');
    assert.deepEqual(ranges(doc), [[0, 2]]);
    await vscode.commands.executeCommand('vim.remap', { after: ['<C-r>'] });
    await delay(500);
    assert.deepEqual(ranges(doc), [
      [0, 2],
      [3, 5],
    ]);
  });
  for (const keys of ['vjjzf', 'Vjjzf'])
    await record(`${keys}: includes final line at column zero`, async () => {
      const doc = await open(sample);
      await type(keys);
      assert.deepEqual(ranges(doc), [[0, 2]]);
      assert.equal(
        (await api.getAndUpdateModeHandler()).vimState.currentMode,
        0
      );
    });
  await record(
    'Normal zo toggles like za; zc closes',
    async () => {
      await open(sample);
      await type('zf2j');
      await type('zo');
      assert.ok(!hidden(1));
      await type('zo');
      assert.ok(hidden(1));
      await type('zo');
      assert.ok(!hidden(1));
      await type('zc');
      assert.ok(hidden(1));
      await type('za');
      assert.ok(!hidden(1));
      await type('za');
      assert.ok(hidden(1));
    }
  );
  const nested = 'a // {{{\nb // {{{\nc\nd // }}}\ne // }}}\ntail\n';
  await record(
    'zd on closed outer fold removes outer markers and preserves nested fold',
    async () => {
      const doc = await open(nested);
      await type('zM');
      await type('zd');
      assert.deepEqual(ranges(doc), [[1, 3]]);
      await type('u');
      assert.equal(doc.getText(), nested);
    }
  );
  await record('zd inside open outer fold removes inner markers', async () => {
    const doc = await open(nested);
    await type('zR');
    await position(2);
    await type('zd');
    assert.deepEqual(ranges(doc), [[0, 4]]);
  });
  await record(
    'zD recursively removes nested folds in one undo operation',
    async () => {
      const doc = await open(nested);
      await type('zM');
      await type('zD');
      assert.deepEqual(ranges(doc), []);
      await type('u');
      assert.equal(doc.getText(), nested);
    }
  );
  await record('zE removes all folds, including disjoint folds', async () => {
    const doc = await open(nested + 'other // {{{\nx\nend // }}}\n');
    await type('zE');
    assert.deepEqual(ranges(doc), []);
  });
  await record(
    'Visual zd removes one level of each intersecting fold',
    async () => {
      const doc = await open(nested + 'other // {{{\nx\nend // }}}\n');
      await type('zRvGzd');
      assert.deepEqual(ranges(doc), [[1, 3]]);
      assert.equal(
        (await api.getAndUpdateModeHandler()).vimState.currentMode,
        0
      );
    }
  );
  await record('zO opens recursively and zC closes recursively', async () => {
    await open(nested);
    await type('zM');
    await type('zO');
    assert.ok(!hidden(2));
    await type('zC');
    assert.ok(hidden(2));
  });
  await record('zM closes all; zR opens all', async () => {
    await open(nested + 'other // {{{\nx\nend // }}}\n');
    await type('zM');
    assert.ok(hidden(2));
    assert.ok(hidden(7));
    await type('zR');
    assert.ok(!hidden(2));
    assert.ok(!hidden(7));
  });
  await record(
    'nested zo toggles one level and za toggles the visible closed fold',
    async () => {
      await open(nested);
      await type('zMzo');
      assert.ok(!hidden(1));
      assert.ok(hidden(2));
      await position(1);
      await type('za');
      assert.ok(!hidden(2));
      await type('za');
      assert.ok(hidden(2));
    }
  );
  await record('zA toggles recursively', async () => {
    await open(nested);
    await type('zMzA');
    assert.ok(!hidden(2));
    await type('zA');
    assert.ok(hidden(2));
  });
  await record('zm/zr change fold level one layer at a time', async () => {
    await open(nested);
    await type('zRzm');
    assert.ok(!hidden(1));
    assert.ok(hidden(2));
    await type('zm');
    assert.ok(hidden(1));
    await type('zr');
    assert.ok(!hidden(1));
    assert.ok(hidden(2));
    await type('zr');
    assert.ok(!hidden(2));
  });
  await record(
    'zn/zN/zi temporarily disable and restore existing folding',
    async () => {
      await open(nested);
      await type('zMzn');
      assert.ok(!hidden(2));
      await type('zN');
      assert.ok(hidden(2));
      await type('zi');
      assert.ok(!hidden(2));
      await type('zi');
      assert.ok(hidden(2));
    }
  );
  await record(
    'zv reveals the cursor fold; zx/zX reapply the fold level',
    async () => {
      await open(nested);
      await type('zMzv');
      assert.ok(!hidden(1));
      assert.ok(hidden(2));
      await type('zX');
      assert.ok(hidden(1));
      await type('zx');
      assert.ok(!hidden(1));
      assert.ok(hidden(2));
    }
  );
  await record('fold jumps zj/zk/[z/]z match Vim boundaries', async () => {
    await open(nested);
    await type('zRzj');
    assert.equal(editor.selection.active.line, 1);
    await position(5);
    await type('zk');
    assert.equal(editor.selection.active.line, 4);
    await position(2);
    await type('[z');
    assert.equal(editor.selection.active.line, 1);
    await type('[z');
    assert.equal(editor.selection.active.line, 0);
    await position(2);
    await type(']z');
    assert.equal(editor.selection.active.line, 3);
    await type(']z');
    assert.equal(editor.selection.active.line, 4);
  });
  await record('Visual zo opens every fold in the selection', async () => {
    await open(nested + 'other // {{{\nx\nend // }}}\n');
    await type('zMvGzo');
    assert.ok(!hidden(1));
    assert.ok(hidden(2));
    assert.ok(!hidden(7));
  });
  await record(
    'named marker deletion preserves explanatory comment',
    async () => {
      const doc = await open('a // {{{ explanation\nx\nb // }}} end\ntail\n');
      await type('zMzd');
      assert.deepEqual(ranges(doc), []);
      assert.match(doc.getText(), /explanation/);
      assert.match(doc.getText(), /end/);
    }
  );
  await record('EOF folding and single-line marker creation', async () => {
    const doc = await open('a\nb\nc');
    await type('zfG');
    assert.deepEqual(ranges(doc), [[0, 2]]);
    assert.ok(hidden(1));
    await type('zd');
    assert.deepEqual(ranges(doc), []);
    await type('u');
    await type('u');
    await position(0);
    await type('zf$');
    assert.deepEqual(ranges(doc), [[0, 0]]);
  });
  await record(
    'EOF collapsed header displays the inclusive folded line count',
    async () => {
      await open('a\nb\nc');
      await type('zfG');
      assert.ok(hidden(1));
      const content = await renderer(`(() => {
      return [...document.styleSheets].some((sheet) => {
        try { return [...sheet.cssRules].some((rule) => rule.cssText.includes('3 lines:')); }
        catch { return false; }
      });
    })()`);
      assert.equal(
        content,
        true,
        'EOF folded count decoration must reach the renderer'
      );
    }
  );
  await record(
    'real ct_lsu_pfu.v module port list zf% uses the exact matching lines',
    async () => {
      const original = await fs.readFile(
        process.env.MARKER_FOLDS_TEST_SOURCE,
        'utf8'
      );
      const doc = await open(original);
      const lines = original.split(/\r?\n/);
      const first = lines.findIndex((line) =>
        line.startsWith('module ct_lsu_pfu(')
      );
      const last = lines.findIndex((line, i) => i > first && /^\);/.test(line));
      await position(first, lines[first].indexOf('('));
      await type('zf%');
      assert.ok(ranges(doc).some(([a, b]) => a === first && b === last));
      assert.ok(hidden(first + 1));
      await type('u');
      assert.equal(doc.getText(), original);
    }
  );
  await record(
    'reload saved file restores provider ranges and split folding stays independent',
    async () => {
      const doc = await open(sample);
      await type('zf2j');
      await doc.save();
      await vscode.commands.executeCommand(
        'workbench.action.closeActiveEditor'
      );
      editor = await vscode.window.showTextDocument(
        await vscode.workspace.openTextDocument(doc.uri)
      );
      await delay(400);
      const provided = await vscode.commands.executeCommand(
        'vscode.executeFoldingRangeProvider',
        editor.document.uri
      );
      assert.ok(provided.some((fold) => fold.start === 0 && fold.end === 2));
      await position(0);
      await type('zc');
      const left = editor;
      await vscode.commands.executeCommand('workbench.action.splitEditorRight');
      await delay(250);
      editor = vscode.window.activeTextEditor;
      assert.notEqual(editor, left);
      await position(0);
      await type('zo');
      assert.ok(!hidden(1));
      assert.ok(
        !left.visibleRanges.some(
          (range) => range.start.line <= 1 && range.end.line >= 1
        )
      );
    }
  );
  if (results.some((result) => !result.passed))
    throw new Error(
      'Marker fold integration failures; see test-results/integration.json'
    );
}
module.exports = { run };

async function renderer(expression) {
  const targets = await (
    await fetch(
      `http://127.0.0.1:${process.env.MARKER_FOLDS_TEST_CDP_PORT}/json/list`
    )
  ).json();
  const target = targets.find(
    (item) => item.type === 'page' && item.url.includes('workbench')
  );
  assert.ok(target, 'isolated renderer');
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('Renderer timeout'));
    }, 4000);
    socket.onopen = () =>
      socket.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true, awaitPromise: true },
        })
      );
    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      if (data.result?.exceptionDetails)
        reject(new Error(JSON.stringify(data.result.exceptionDetails)));
      else resolve(data.result?.result?.value);
    };
    socket.onerror = reject;
  });
}
