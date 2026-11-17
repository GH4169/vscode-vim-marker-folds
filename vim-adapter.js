'use strict';

const path = require('node:path');

async function getVim(vscode) {
  const extension = vscode.extensions.getExtension('vscodevim.vim');
  if (extension?.packageJSON.version !== '1.32.4')
    throw new Error('Marker 折叠操作符需要 VSCodeVim 1.32.4。');
  await extension.activate();
  const api = require(
    path.resolve(extension.extensionPath, extension.packageJSON.main)
  );
  if (typeof api.getAndUpdateModeHandler !== 'function')
    throw new Error('VSCodeVim 操作符接口已变化。');
  return api;
}

function isFoldOperator(action) {
  return action?.commandName === 'editor.createFoldingRangeFromSelection';
}

// Use Vim's own operator ranges, counts, text objects, cancellation and replay.
// Only replace the final edit; never patch the installed VSCodeVim bundle.
function install(proto, create, remove, control) {
  const executeOperator = proto.executeOperator;
  const runAction = proto.runAction;
  const repeatPatches = new Map();
  if (typeof executeOperator !== 'function' || typeof runAction !== 'function')
    throw new Error('VSCodeVim 操作符接口已变化。');

  async function wrappedOperator(...args) {
    const operator = this.vimState.recordedState.operator;
    if (!isFoldOperator(operator)) return executeOperator.apply(this, args);
    const original = operator.run;
    operator.run = async (state, start, end) => {
      await create(state, start, end);
    };
    try {
      return await executeOperator.apply(this, args);
    } finally {
      operator.run = original;
    }
  }

  async function wrappedAction(recorded, action) {
    if (isFoldOperator(action)) {
      const operatorProto = Object.getPrototypeOf(action);
      if (!repeatPatches.has(operatorProto)) {
        repeatPatches.set(
          operatorProto,
          operatorProto.doesRepeatedOperatorApply
        );
        // Unlike dd, zff means zf followed by the f{char} motion in Vim.
        operatorProto.doesRepeatedOperatorApply = () => false;
      }
    }
    const folding =
      control &&
      [
        'editor.fold',
        'editor.unfold',
        'editor.toggleFold',
        'editor.foldRecursively',
        'editor.unfoldRecursively',
        'editor.foldAll',
        'editor.unfoldAll',
      ].includes(action.commandName);
    if (!folding && action.commandName !== 'editor.removeManualFoldingRanges')
      return runAction.call(this, recorded, action);
    const original = action.exec;
    action.exec = async (_position, state) => {
      if (folding) await control(state, action.commandName);
      else await remove(state);
    };
    try {
      return await runAction.call(this, recorded, action);
    } finally {
      action.exec = original;
    }
  }

  proto.executeOperator = wrappedOperator;
  proto.runAction = wrappedAction;
  return {
    dispose() {
      if (proto.executeOperator === wrappedOperator)
        proto.executeOperator = executeOperator;
      if (proto.runAction === wrappedAction) proto.runAction = runAction;
      for (const [operatorProto, original] of repeatPatches)
        operatorProto.doesRepeatedOperatorApply = original;
    },
  };
}

module.exports = { getVim, install, isFoldOperator };
