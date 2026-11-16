'use strict';
const vscode = require('vscode');
const {
  parse,
  template,
  appendMarker,
  safeRemoval,
  innermost,
} = require('./folds');
const { closedFolds } = require('./line-counts');
function activate(context) {
  const change = new vscode.EventEmitter(),
    decoration = vscode.window.createTextEditorDecorationType({
      before: {
        color: new vscode.ThemeColor('editorCodeLens.foreground'),
        margin: '0 0.7em 0 0',
      },
    });
  context.subscriptions.push(change, decoration);
  const lines = (doc) =>
    Array.from({ length: doc.lineCount }, (_, i) => doc.lineAt(i).text);
  const cache = new WeakMap();
  const get = (doc) => {
    let hit = cache.get(doc);
    if (!hit || hit.version !== doc.version) {
      hit = { version: doc.version, folds: parse(lines(doc)) };
      cache.set(doc, hit);
    }
    return hit.folds;
  };
  const draw = () => {
    for (const editor of vscode.window.visibleTextEditors)
      editor.setDecorations(
        decoration,
        closedFolds(get(editor.document), editor.visibleRanges).map((f) => ({
          range: new vscode.Range(f.start.line, 0, f.start.line, 0),
          renderOptions: {
            before: { contentText: f.end.line - f.start.line + 1 + ' lines:' },
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
          return get(doc).map(
            (f) =>
              new vscode.FoldingRange(
                f.start.line,
                f.end.line,
                vscode.FoldingRangeKind.Region
              )
          );
        },
      }
    )
  );
  const register = (id, fn) =>
    context.subscriptions.push(
      vscode.commands.registerCommand('gvimMarkerFolds.' + id, async () => {
        try {
          await fn();
        } catch (e) {
          vscode.window.showWarningMessage(e.message);
        }
      })
    );
  register('createFold', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) return;
    let first = editor.selection.start.line,
      last = editor.selection.end.line;
    if (editor.selection.end.character === 0 && last > first) last--;
    if (first >= last) return;
    const doc = editor.document,
      format = template(
        doc.languageId,
        vscode.workspace
          .getConfiguration('gvimMarkerFolds')
          .get('commentStrings', {})
      );
    if (!format)
      throw new Error('此语言没有安全的 marker 注释格式；未修改文件。');
    const edits = [first, last].map((n, i) => ({
      range: doc.lineAt(n).range,
      text: appendMarker(doc.lineAt(n).text, i ? ' }}}'.trim() : '{{{', format),
    }));
    if (
      !(await editor.edit(
        (builder) => {
          for (const e of edits) builder.replace(e.range, e.text);
        },
        { undoStopBefore: true, undoStopAfter: true }
      ))
    )
      return;
    await vscode.commands.executeCommand('extension.vim_escape');
    const pos = new vscode.Position(first, 0);
    editor.selection = new vscode.Selection(pos, pos);
    change.fire();
    await vscode.commands.executeCommand('editor.fold', {
      selectionLines: [first],
    });
    draw();
  });
  register('deleteFold', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const doc = editor.document,
      fold = innermost(get(doc), editor.selection.active.line);
    if (!fold) return;
    if (fold.implicit || fold.shared)
      throw new Error('该折叠使用隐式或共享结束标记；为保留其他折叠，未删除。');
    const format = template(
      doc.languageId,
      vscode.workspace
        .getConfiguration('gvimMarkerFolds')
        .get('commentStrings', {})
    );
    const edits = [fold.start, fold.end].map((token) => ({
      line: token.line,
      range: safeRemoval(doc.lineAt(token.line).text, token, format),
    }));
    if (edits.some((e) => !e.range))
      throw new Error('标记注释含额外文字或格式不安全；未删除。');
    await editor.edit(
      (builder) => {
        for (const e of edits)
          builder.delete(
            new vscode.Range(e.line, e.range.start, e.line, e.range.end)
          );
      },
      { undoStopBefore: true, undoStopAfter: true }
    );
    change.fire();
    draw();
  });
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(() => {
      change.fire();
      draw();
    }),
    vscode.window.onDidChangeVisibleTextEditors(draw),
    vscode.window.onDidChangeTextEditorVisibleRanges(draw)
  );
  draw();
}
module.exports = { activate };
