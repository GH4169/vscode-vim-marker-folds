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
  for (let line = 0; line < lines.length; line++) {
    for (const match of lines[line].matchAll(/(\{\{\{|\}\}\})(\d*)/g)) {
      const opening = match[1] === '{{{',
        level = match[2] ? Number(match[2]) : null,
        token = { line, column: match.index, length: match[0].length, level };
      if (opening) {
        if (level !== null)
          while (stack.length && (stack.at(-1).level ?? Infinity) >= level) {
            const start = stack.pop();
            if (line - 1 > start.line)
              folds.push({ start, end: { line: line - 1 }, implicit: true });
          }
        stack.push(token);
      } else if (level !== null) {
        // A numbered close may close several levels. Shared closes are never deleted.
        const eligible = [];
        while (stack.length && (stack.at(-1).level ?? Infinity) >= level)
          eligible.push(stack.pop());
        for (const start of eligible)
          if (line > start.line)
            folds.push({ start, end: token, shared: eligible.length > 1 });
      } else {
        const start = stack.pop();
        if (start && line > start.line) folds.push({ start, end: token });
      }
    }
  }
  for (const start of stack)
    if (start.line < lines.length - 1)
      folds.push({ start, end: { line: lines.length - 1 }, implicit: true });
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
  const clean = text.replace(/\s+$/, '');
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
  return clean + (clean ? ' ' : '') + prefix + marker + suffix;
}
function safeRemoval(text, token, format) {
  if (!format || !token || token.column === undefined) return null;
  const [prefix, suffix] = format.split('%s');
  if (suffix === undefined) return null;
  const before = text.slice(0, token.column),
    after = text.slice(token.column + token.length);
  if (after.trim() !== suffix.trim()) return null;
  // Remove only an otherwise empty marker comment, never an explanatory comment.
  if (!before.trimEnd().endsWith(prefix.trim())) return null;
  const commentStart = before.lastIndexOf(prefix.trim());
  const code = before.slice(0, commentStart);
  return { start: code.trimEnd().length, end: text.length };
}
function innermost(folds, line) {
  return folds
    .filter((f) => f.start.line <= line && f.end.line >= line)
    .sort((a, b) => a.end.line - a.start.line - (b.end.line - b.start.line))[0];
}
module.exports = { parse, template, appendMarker, safeRemoval, innermost };
