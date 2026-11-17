'use strict';
function closedFolds(folds, visibleRanges, known = []) {
  const gaps = new Set();
  for (let i = 0; i + 1 < visibleRanges.length; i++)
    gaps.add(visibleRanges[i].end.line + ':' + visibleRanges[i + 1].start.line);
  return folds.filter(
    (f) =>
      gaps.has(f.start.line + ':' + (f.end.line + 1)) ||
      known.some(
        (range) =>
          range.start.line === f.start.line && range.end.line === f.end.line
      )
  );
}
module.exports = { closedFolds };
