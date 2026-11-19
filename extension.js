'use strict';
const vscode = require('vscode');
const {
  parse,
  template,
  appendMarker,
  safeRemoval,
  selectionLines,
  atCursor,
  deletionTargets,
} = require('./folds');
const { closedFolds } = require('./line-counts');
const { getVim, install } = require('./vim-adapter');
const { FoldState, depths, navigationTarget, key } = require('./fold-state');

async function activate(context) {
  let vimApi;
  const change = new vscode.EventEmitter();
  const output = vscode.window.createOutputChannel('GVim Marker Folds');
  const decoration = vscode.window.createTextEditorDecorationType({
    before: {
      color: new vscode.ThemeColor('editorCodeLens.foreground'),
      margin: '0 0.7em 0 0',
    },
  });
  context.subscriptions.push(change, output, decoration);
  const cache = new WeakMap();
  const states = new WeakMap();
  const initialized = new WeakSet();
  const stateFor = (editor) => {
    if (!states.has(editor)) states.set(editor, new FoldState());
    return states.get(editor);
  };
  const initializeFolds = async (editor) => {
    if (
      initialized.has(editor) ||
      !vscode.workspace
        .getConfiguration('gvimMarkerFolds')
        .get('collapseAllOnOpen', true)
    )
      return;
    initialized.add(editor);
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (editor.document.isClosed) return;
    const folds = get(editor.document).filter(
      (fold) => fold.end.line > fold.start.line
    );
    // Clear manual ranges left by an older provider instance before applying
    // the current marker ranges. Otherwise deleted markers can stay folded.
    await vscode.commands.executeCommand('editor.unfoldAll');
    const model = stateFor(editor);
    model.collapsed.clear();
    if (!folds.length) {
      draw();
      return;
    }
    await vscode.commands.executeCommand('editor.foldAll');
    model.set(folds, true);
    model.level = 0;
    draw();
  };
  const get = (doc) => {
    let hit = cache.get(doc);
    if (!hit || hit.version !== doc.version) {
      const lines = Array.from(
        { length: doc.lineCount },
        (_, i) => doc.lineAt(i).text
      );
      hit = { version: doc.version, folds: parse(lines) };
      cache.set(doc, hit);
    }
    return hit.folds;
  };
  const closed = (editor) => {
    const folds = get(editor.document);
    const state = stateFor(editor);
    const tracked = state.getClosed(folds, editor.visibleRanges);
    const result = closedFolds(folds, editor.visibleRanges, tracked);
    state.set(result, true);
    return result.filter(
      (fold) =>
        !result.some(
          (parent) =>
            parent !== fold &&
            parent.start.line < fold.start.line &&
            parent.end.line >= fold.end.line
        )
    );
  };
  const draw = () => {
    for (const editor of vscode.window.visibleTextEditors)
      editor.setDecorations(
        decoration,
        closed(editor).map((fold) => ({
          range: new vscode.Range(fold.start.line, 0, fold.start.line, 0),
          renderOptions: {
            before: {
              contentText: `${fold.end.line - fold.start.line + 1} lines:`,
            },
          },
        }))
      );
  };
  context.subscriptions.push(
    vscode.languages.registerFoldingRangeProvider(
      { scheme: '*' },
      {
        onDidChangeFoldingRanges: change.event,
        provideFoldingRanges(doc) {
          return get(doc)
            .filter((fold) => fold.end.line > fold.start.line)
            .map(
              (fold) =>
                new vscode.FoldingRange(
                  fold.start.line,
                  fold.end.line,
                  vscode.FoldingRangeKind.Region
                )
            );
        },
      }
    )
  );

  const report = (error) => {
    output.appendLine(error.stack || error.message);
    vscode.window.showWarningMessage(error.message);
  };
  const register = (name, callback) =>
    context.subscriptions.push(
      vscode.commands.registerCommand(
        `gvimMarkerFolds.${name}`,
        async (...args) => {
          try {
            return await callback(...args);
          } catch (error) {
            report(error);
          }
        }
      )
    );
  const formatFor = (doc) =>
    template(
      doc.languageId,
      vscode.workspace
        .getConfiguration('gvimMarkerFolds')
        .get('commentStrings', {})
    );
  const editLines = (editor, edits) =>
    editor.edit(
      (builder) => {
        for (const [line, text] of edits)
          builder.replace(editor.document.lineAt(line).range, text);
      },
      { undoStopBefore: true, undoStopAfter: true }
    );

  // Vim must own its cursors while an operator is running. Escape would reset
  // the pending operator before runAction has finished recording it.
  async function finish(editor, line, state, character = 0) {
    const position = new vscode.Position(
      line,
      Math.min(character, editor.document.lineAt(line).text.length)
    );
    state.cursorStartPosition = position;
    state.cursorStopPosition = position;
    await state.setCurrentMode(0);
    editor.selection = new vscode.Selection(position, position);
  }

  async function create(editor, first, last, state, character = 0) {
    const doc = editor.document;
    const format = formatFor(doc);
    if (!format)
      throw new Error('此语言没有安全的 marker 注释格式；未修改文件。');
    const edits = new Map();
    edits.set(first, appendMarker(doc.lineAt(first).text, '{{{', format));
    edits.set(
      last,
      appendMarker(edits.get(last) ?? doc.lineAt(last).text, '}}}', format)
    );
    if (!(await editLines(editor, edits))) return;
    await finish(editor, first, state, character);
    change.fire();
    // editor.fold waits for the folding model refresh. Keeping the cursor at
    // the header avoids the editor reopening a range to reveal a stale cursor.
    if (last > first) {
      await vscode.commands.executeCommand('editor.fold', {
        selectionLines: [first],
      });
      stateFor(editor).set(
        get(doc).filter(
          (fold) => fold.start.line === first && fold.end.line === last
        ),
        true
      );
    }
    draw();
  }

  async function setFold(editor, fold, collapse) {
    await vscode.commands.executeCommand(
      collapse ? 'editor.fold' : 'editor.unfold',
      {
        selectionLines: [fold.start.line],
        levels: 1,
        direction: 'down',
      }
    );
    stateFor(editor).set([fold], collapse);
  }

  async function foldControl(state, command) {
    const editor = state.editor;
    const folds = get(editor.document).filter(
      (fold) => fold.end.line > fold.start.line
    );
    const model = stateFor(editor);
    const visibleClosed = closed(editor);
    const count = state.recordedState.count || 1;
    const visual = [2, 3, 4].includes(state.currentMode);
    const { first, last } = visual
      ? selectionLines(editor.selection, true)
      : {
          first: state.cursorStopPosition.line,
          last: state.cursorStopPosition.line,
        };
    const character = state.cursorStopPosition.character;
    if (command === 'editor.foldAll' || command === 'editor.unfoldAll') {
      await vscode.commands.executeCommand(command);
      const collapse = command === 'editor.foldAll';
      model.set(folds, collapse);
      model.level = collapse
        ? 0
        : Math.max(0, ...depths(folds).map((entry) => entry.depth));
      model.enabled = true;
    } else {
      const recursive = /Recursively$/.test(command);
      const selected = visual
        ? deletionTargets(folds, visibleClosed, first, last)
        : [atCursor(folds, visibleClosed, first)].filter(Boolean);
      for (let fold of selected) {
        let collapse =
          command === 'editor.fold' || command === 'editor.foldRecursively';
        if (
          command === 'editor.toggleFold' ||
          command === 'editor.toggleFoldRecursively'
        )
          collapse = !model.collapsed.has(key(fold));
        if (recursive) {
          const inside = folds.filter(
            (child) =>
              child.start.line >= fold.start.line &&
              child.end.line <= fold.end.line
          );
          // Open outer folds before children; close children before parents.
          for (const child of collapse ? [...inside].reverse() : inside)
            await setFold(editor, child, collapse);
        } else {
          for (let n = 0; n < count && fold; n++) {
            if (collapse && model.collapsed.has(key(fold))) {
              fold = folds
                .filter(
                  (parent) =>
                    parent.start.line <= fold.start.line &&
                    parent.end.line >= fold.end.line &&
                    !model.collapsed.has(key(parent))
                )
                .at(-1);
              if (!fold) break;
            }
            if (!collapse && !model.collapsed.has(key(fold))) break;
            await setFold(editor, fold, collapse);
            const containing = folds.filter(
              (parent) => parent.start.line <= first && parent.end.line >= first
            );
            fold = collapse
              ? containing
                  .filter((parent) => !model.collapsed.has(key(parent)))
                  .at(-1)
              : containing.find((parent) => model.collapsed.has(key(parent)));
          }
        }
      }
      if (command !== 'editor.unfold' && command !== 'editor.unfoldRecursively')
        model.enabled = true;
    }
    const containing = folds.find(
      (fold) =>
        model.collapsed.has(key(fold)) &&
        fold.start.line <= first &&
        fold.end.line >= first
    );
    await finish(editor, containing?.start.line ?? first, state, character);
    draw();
  }

  async function withHandler(callback) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !vimApi) return;
    const handler = await vimApi.getAndUpdateModeHandler();
    handler.internalSelectionsTracker.startIgnoringIntermediateSelections();
    try {
      await callback(handler.vimState);
      await handler.setCurrentMode(handler.vimState.currentMode);
      handler.updateView();
    } finally {
      handler.internalSelectionsTracker.stopIgnoringIntermediateSelections();
    }
  }

  async function remove(
    editor,
    { recursive = false, all = false, state } = {}
  ) {
    const doc = editor.document;
    const folds = get(doc);
    const visual = state
      ? [2, 3, 4].includes(state.currentMode)
      : !editor.selection.isEmpty;
    const { first, last } = visual
      ? selectionLines(editor.selection, true)
      : {
          first: editor.selection.active.line,
          last: editor.selection.active.line,
        };
    const targets = all
      ? folds
      : deletionTargets(folds, closed(editor), first, last, recursive);
    if (!targets.length) return;
    if (targets.some((fold) => fold.implicit || fold.shared))
      throw new Error('该折叠使用隐式或共享标记；为保留其他折叠，未删除。');
    const removals = new Map();
    for (const token of targets.flatMap((fold) => [fold.start, fold.end])) {
      const range = safeRemoval(
        doc.lineAt(token.line).text,
        token,
        formatFor(doc)
      );
      if (!range) throw new Error('无法安全删除该 marker；未修改文件。');
      if (!removals.has(token.line)) removals.set(token.line, []);
      removals.get(token.line).push(range);
    }
    const edits = new Map();
    for (const [line, ranges] of removals) {
      let text = doc.lineAt(line).text;
      const merged = [];
      for (const range of ranges.sort((a, b) => a.start - b.start)) {
        const previous = merged.at(-1);
        if (previous && previous.end >= range.start)
          previous.end = Math.max(previous.end, range.end);
        else merged.push({ ...range });
      }
      for (const range of merged.reverse())
        text = text.slice(0, range.start) + text.slice(range.end);
      edits.set(line, text);
    }
    // Removing a collapsed provider range leaves VS Code's manual collapse
    // state behind until the folding model is refreshed. Open each deleted
    // range first so the resulting view matches Vim's `zd` behavior.
    for (const fold of targets) {
      await vscode.commands.executeCommand('editor.unfold', {
        selectionLines: [fold.start.line],
        levels: 1,
        direction: 'down',
      });
    }
    if (!(await editLines(editor, edits))) return;
    await finish(editor, first, state, editor.selection.active.character);
    change.fire();
    draw();
  }

  register('createFold', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) return;
    const { first, last } = selectionLines(editor.selection, true);
    await withHandler((state) => create(editor, first, last, state));
  });
  for (const [name, options] of [
    ['deleteFold', {}],
    ['deleteFoldRecursive', { recursive: true }],
    ['deleteAllFolds', { all: true }],
  ])
    register(name, async () => {
      await withHandler((state) => remove(state.editor, { ...options, state }));
    });
  register('toggleFoldRecursive', () =>
    withHandler((state) => foldControl(state, 'editor.toggleFoldRecursively'))
  );
  async function viewCursor(state) {
    const line = state.cursorStopPosition.line;
    const model = stateFor(state.editor);
    for (const fold of get(state.editor.document).filter(
      (fold) =>
        model.collapsed.has(key(fold)) &&
        fold.start.line <= line &&
        fold.end.line >= line
    ))
      await setFold(state.editor, fold, false);
    draw();
  }
  register('viewCursor', () => withHandler(viewCursor));
  async function applyLevel(state, level) {
    const editor = state.editor;
    const model = stateFor(editor);
    const entries = depths(get(editor.document));
    const max = Math.max(0, ...entries.map((entry) => entry.depth));
    model.level = Math.max(0, Math.min(max, level ?? max));
    await vscode.commands.executeCommand('editor.unfoldAll');
    model.set(
      entries.map((entry) => entry.fold),
      false
    );
    for (const { fold, depth } of [...entries].reverse())
      if (depth > model.level) await setFold(editor, fold, true);
    model.enabled = true;
    draw();
  }
  for (const [name, delta] of [
    ['foldMore', -1],
    ['foldLess', 1],
  ])
    register(name, () =>
      withHandler(async (state) => {
        const level =
          stateFor(state.editor).level ??
          Math.max(
            0,
            ...depths(get(state.editor.document)).map((entry) => entry.depth)
          );
        await applyLevel(state, level + delta);
      })
    );
  for (const [name, reveal] of [
    ['updateFolds', true],
    ['resetFolds', false],
  ])
    register(name, () =>
      withHandler(async (state) => {
        change.fire();
        await applyLevel(state, stateFor(state.editor).level);
        if (reveal) await viewCursor(state);
      })
    );
  for (const name of ['disableFolds', 'enableFolds', 'toggleFolds'])
    register(name, () =>
      withHandler(async (state) => {
        const editor = state.editor;
        const model = stateFor(editor);
        const enable =
          name === 'enableFolds' || (name === 'toggleFolds' && !model.enabled);
        if (enable === model.enabled) return;
        if (!enable) {
          closed(editor);
          model.saved = new Set(model.collapsed);
          await vscode.commands.executeCommand('editor.unfoldAll');
          model.collapsed.clear();
        } else {
          for (const fold of [...get(editor.document)].reverse())
            if (model.saved.has(key(fold))) await setFold(editor, fold, true);
        }
        model.enabled = enable;
        draw();
      })
    );
  for (const name of ['nextFold', 'previousFold', 'foldStart', 'foldEnd'])
    register(name, () =>
      withHandler(async (state) => {
        const editor = state.editor;
        const target = navigationTarget(
          get(editor.document),
          closed(editor),
          state.cursorStopPosition.line,
          name
        );
        if (target === undefined) return;
        const position = new vscode.Position(
          target,
          editor.document.lineAt(target).firstNonWhitespaceCharacterIndex
        );
        const visual = [2, 3, 4].includes(state.currentMode);
        state.cursorStopPosition = position;
        if (!visual) state.cursorStartPosition = position;
        editor.selection = new vscode.Selection(
          state.cursorStartPosition,
          position
        );
      })
    );

  let attached = false;
  try {
    vimApi = await getVim(vscode);
    const attach = async () => {
      if (attached || !vscode.window.activeTextEditor) return;
      const handler = await vimApi.getAndUpdateModeHandler();
      if (!handler || attached) return;
      context.subscriptions.push(
        install(
          Object.getPrototypeOf(handler),
          async (state, start, end) => {
            try {
              await create(
                state.editor,
                start.line,
                end.line,
                state,
                start.character
              );
            } catch (error) {
              await finish(state.editor, start.line, state, start.character);
              report(error);
            }
          },
          async (state) => {
            try {
              await remove(state.editor, { state });
            } catch (error) {
              report(error);
            }
          },
          foldControl
        )
      );
      attached = true;
      output.appendLine('VSCodeVim 1.32.4 marker operator adapter active.');
    };
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(() => attach().catch(report))
    );
    await attach();
  } catch (error) {
    report(error);
  }
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(() => {
      change.fire();
      draw();
    }),
    vscode.window.onDidChangeVisibleTextEditors(draw),
    vscode.window.onDidChangeTextEditorVisibleRanges(draw)
  );
  for (const editor of vscode.window.visibleTextEditors)
    initializeFolds(editor).catch(report);
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) initializeFolds(editor).catch(report);
    })
  );
  draw();
}
module.exports = { activate };
