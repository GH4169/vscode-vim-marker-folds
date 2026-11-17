#!/usr/bin/env bash
set -euo pipefail
root_dir="$(cd -- "$(dirname -- "$0")/.." && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/marker-folds-test.XXXXXX")"
chmod 700 "$test_dir"
mkdir -p "$test_dir/user/User" "$test_dir/extensions" "$test_dir/workspace" "$root_dir/test-results"
mkdir -p "$test_dir/user/User/globalStorage/vscodevim.vim"
printf '%s\n' '{"version":"1.0","registers":[]}' > "$test_dir/user/User/globalStorage/vscodevim.vim/.registers"
cp "$root_dir/config/settings.json" "$test_dir/user/User/settings.json"
cp -a "${EDITOR_TOOLS_TEST_VIM:-$HOME/.cache/editor-tools/integration/extensions/vscodevim.vim-1.32.4}" "$test_dir/extensions/"
mkdir -p "$test_dir/extensions/test.verilog-1.0.0"
printf '%s\n' '{"name":"verilog","publisher":"test","version":"1.0.0","engines":{"vscode":"*"},"contributes":{"languages":[{"id":"verilog","extensions":[".v"]}]}}' > "$test_dir/extensions/test.verilog-1.0.0/package.json"
export MARKER_FOLDS_TEST_WORKSPACE="$test_dir/workspace" MARKER_FOLDS_TEST_RESULTS="$root_dir/test-results"
export MARKER_FOLDS_TEST_SOURCE="${MARKER_FOLDS_TEST_SOURCE:-$HOME/project/openc910/C910_RTL_FACTORY/gen_rtl/lsu/rtl/ct_lsu_pfu.v}"
export MARKER_FOLDS_TEST_CDP_PORT="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"
printf '%s\n' "$test_dir" > "$root_dir/test-results/LAST_SESSION"
unset ELECTRON_RUN_AS_NODE VSCODE_IPC_HOOK_CLI VSCODE_IPC_HOOK VSCODE_CWD NODE_OPTIONS
export DONT_PROMPT_WSL_INSTALL=1
timeout 180 "$HOME/.local/bin/codex-desktop" run "${EDITOR_TOOLS_TEST_CODE:-$HOME/.local/share/editor-tools/code-linux-1.145.2}/code" \
  --no-sandbox --disable-gpu --disable-workspace-trust --skip-welcome --skip-release-notes \
  --remote-debugging-address=127.0.0.1 --remote-debugging-port="$MARKER_FOLDS_TEST_CDP_PORT" \
  --user-data-dir "$test_dir/user" --extensions-dir "$test_dir/extensions" \
  --extensionDevelopmentPath="$root_dir" --extensionDevelopmentPath="$root_dir/../vscode-vim-sv-match" \
  --extensionTestsPath="$root_dir/test/integration.js" "$test_dir/workspace" > "$root_dir/test-results/code.log" 2>&1
