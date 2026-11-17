'use strict';
const comments = {
  verilog: '// %s',
  systemverilog: '// %s',
  javascript: '// %s',
  javascriptreact: '// %s',
  typescript: '// %s',
  typescriptreact: '// %s',
  c: '// %s',
  cpp: '// %s',
  java: '// %s',
  rust: '// %s',
  go: '// %s',
  csharp: '// %s',
  python: '# %s',
  shellscript: '# %s',
  ruby: '# %s',
  yaml: '# %s',
  toml: '# %s',
  makefile: '# %s',
  perl: '# %s',
  r: '# %s',
  lua: '-- %s',
  sql: '-- %s',
  haskell: '-- %s',
  vim: '" %s',
  html: '<!-- %s -->',
  xml: '<!-- %s -->',
  css: '/* %s */',
  scss: '// %s',
  markdown: '<!-- %s -->',
};
function parse(lines) {
  const stack = [],
    folds = [];
  const close = (end, implicit = false) => {
    const start = stack.pop();
    if (start && end.line >= start.line)
      folds.push({
        start,
        end,
        implicit: implicit || start.synthetic,
        shared: start.shared,
      });
  };
  for (let line = 0; line < lines.length; line++) {
    for (const match of lines[line].matchAll(/(\{\{\{|\}\}\})(\d*)/g)) {
      const opening = match[1] === '{{{',
        level = match[2] ? Math.min(20, Number(match[2])) : null,
        token = { line, column: match.index, length: match[0].length, level };
      if (level === 0) continue;
      if (opening) {
        if (level === null) stack.push(token);
        else {
          while (stack.length >= level) close({ line: line - 1 }, true);
          const shared = level - stack.length > 1;
          while (stack.length < level) stack.push({ ...token, shared });
        }
      } else if (level !== null) {
        while (stack.length < level) stack.push({ line, synthetic: true });
        const shared = stack.length > level;
        while (stack.length > level)
          close({ ...token, line: line - 1, shared: true }, true);
        close({ ...token, shared });
      } else close(token);
    }
  }
  while (stack.length) close({ line: lines.length - 1 }, true);
  for (const fold of folds) fold.shared ||= fold.end.shared;
  return folds.sort(
    (a, b) => a.start.line - b.start.line || b.end.line - a.end.line
  );
}
function template(language, overrides = {}) {
  return Object.hasOwn(overrides, language)
    ? overrides[language]
    : comments[language];
}
function appendMarker(text, marker, format) {
  if (!format || format.split('%s').length !== 2)
    throw new Error('此语言没有可安全写入的注释格式。');
  const [prefix, suffix] = format.split('%s');
  const clean = text.trimEnd();
  if (suffix && clean.endsWith(suffix.trim())) {
    // Keep a block comment valid by inserting before its existing terminator.
    if (!clean.includes(prefix.trim()))
      throw new Error('无法安全追加到块注释。');
    return (
      clean.slice(0, clean.length - suffix.trim().length).trimEnd() +
      ' ' +
      marker +
      ' ' +
      suffix.trim()
    );
  }
  return (
    text + (text && !/\s$/.test(text) ? ' ' : '') + prefix + marker + suffix
  );
}
function safeRemoval(text, token, format) {
  if (!format || !token || token.column === undefined) return null;
  const [prefix, suffix] = format.split('%s');
  if (suffix === undefined) return null;
  const before = text.slice(0, token.column),
    after = text.slice(token.column + token.length);
  const commentStart = before.lastIndexOf(prefix.trim());
  if (commentStart < 0) return null;
  // Keep named folds and neighboring markers; remove only the marker itself.
  if (
    after.trim() !== suffix.trim() ||
    !before.trimEnd().endsWith(prefix.trim())
  )
    return { start: token.column, end: token.column + token.length };
  const code = before.slice(0, commentStart);
  return { start: code.trimEnd().length, end: text.length };
}
function innermost(folds, line) {
  return folds
    .filter((f) => f.start.line <= line && f.end.line >= line)
    .sort((a, b) => a.end.line - a.start.line - (b.end.line - b.start.line))[0];
}
function selectionLines(selection, visual = false) {
  const first = selection.start.line;
  let last = selection.end.line;
  if (!visual && selection.end.character === 0 && last > first) last--;
  return { first, last };
}

function atCursor(folds, closed, line) {
  return (
    closed.find((f) => f.start.line <= line && f.end.line >= line) ||
    innermost(folds, line)
  );
}

function deletionTargets(folds, closed, first, last, recursive = false) {
  const selected = new Set();
  for (let line = first; line <= last; line++) {
    const fold = atCursor(folds, closed, line);
    if (!fold) continue;
    selected.add(fold);
    line = Math.min(last, fold.end.line);
  }
  if (!recursive) return [...selected];
  return folds.filter((f) =>
    [...selected].some(
      (outer) =>
        outer.start.line <= f.start.line && outer.end.line >= f.end.line
    )
  );
}

module.exports = {
  parse,
  template,
  appendMarker,
  safeRemoval,
  innermost,
  selectionLines,
  atCursor,
  deletionTargets,
};
