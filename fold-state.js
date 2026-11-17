'use strict';

const key = (fold) => `${fold.start.line}:${fold.end.line}`;

class FoldState {
  constructor() {
    this.collapsed = new Set();
    this.saved = new Set();
    this.enabled = true;
    this.level = undefined;
  }

  getClosed(folds, visibleRanges) {
    const current = new Set(folds.map(key));
    this.collapsed = new Set(
      [...this.collapsed].filter((id) => current.has(id))
    );
    // A fully visible interior proves a tracked fold has been opened by a
    // gutter click, search, cursor reveal or another editor command.
    for (const fold of folds) {
      if (
        visibleRanges.some(
          (range) =>
            range.start.line <= fold.start.line &&
            range.end.line > fold.start.line
        )
      )
        this.collapsed.delete(key(fold));
    }
    return folds.filter((fold) => this.collapsed.has(key(fold)));
  }

  set(folds, collapsed) {
    for (const fold of folds) {
      if (collapsed) this.collapsed.add(key(fold));
      else this.collapsed.delete(key(fold));
    }
  }
}

function depths(folds) {
  const stack = [];
  return folds.map((fold) => {
    while (stack.length && stack.at(-1).end.line < fold.end.line) stack.pop();
    while (stack.length && stack.at(-1).end.line < fold.start.line) stack.pop();
    stack.push(fold);
    return { fold, depth: stack.length };
  });
}

function navigationTarget(folds, closed, line, command) {
  const visible = folds.filter(
    (fold) =>
      !closed.some(
        (parent) =>
          parent !== fold &&
          parent.start.line < fold.start.line &&
          parent.end.line >= fold.end.line
      )
  );
  if (command === 'nextFold')
    return visible.find((fold) => fold.start.line > line)?.start.line;
  if (command === 'previousFold') {
    const candidates = visible.filter((fold) => fold.end.line < line);
    const fold = candidates.sort((a, b) => b.end.line - a.end.line)[0];
    return fold && (closed.includes(fold) ? fold.start.line : fold.end.line);
  }
  const edge = command === 'foldStart' ? 'start' : 'end';
  return folds
    .filter(
      (fold) =>
        fold.start.line <= line &&
        fold.end.line >= line &&
        fold[edge].line !== line
    )
    .sort(
      (a, b) => a.end.line - a.start.line - (b.end.line - b.start.line)
    )[0]?.[edge].line;
}

module.exports = { FoldState, depths, navigationTarget, key };
