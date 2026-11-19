# GVim marker 折叠

以合法注释写入 {{{ / }}}，提供专用 FoldingRangeProvider 和折叠行数装饰。

按用户 gVim 的 `foldmethod=marker`、默认 `foldlevel=0` 和 `nnoremap zo za` 实现手工折叠。打开文档时默认收起所有 marker 折叠；Normal 的 `zf` 等待后续 motion，使用 VSCodeVim 原生范围、次数、文本对象和取消流程；Visual 选区包含最后一行。创建/删除各为一次编辑，可用 Vim `u` / `Ctrl+R` 撤销重做。

| 按键 | 行为 |
| --- | --- |
| `zf%`、`zf2j`、`2zfj`、`zfi(`、`zfG` | 按 motion 范围写入 marker 并闭合；支持反向 `%`、`.` 重复 |
| `[count]zF` | 折叠从当前行开始的指定行数 |
| Visual `zf` | 折叠选区；字符、整行、矩形选区均按行处理 |
| `zd`、`zD`、`zE` | 删除当前一层 / 递归删除 / 删除所有 marker；闭合外层的 `zd` 保留内层 |
| `zo`、`zc`、`za` | 切换 / 收起 / 切换；`zo` 与本机 Vim 的自定义映射一致 |
| `zO`、`zC`、`zA` | 递归展开 / 收起 / 切换 |
| `zR`、`zM`、`zr`、`zm` | 全部展开 / 收起 / 降低一层折叠 / 增加一层折叠 |
| `zn`、`zN`、`zi` | 临时禁用 / 恢复 / 切换，保留原有闭合状态 |
| `zv`、`zx`、`zX` | 展开光标处折叠 / 按层级刷新并显示光标 / 按层级刷新 |
| `zj`、`zk`、`[z`、`]z` | 下一折叠开始 / 上一折叠结束 / 当前折叠开始 / 结束 |

Normal 的 `zf`、`zd` 使用同名非递归 `after`，覆盖旧命令映射并交回原生动作；Normal `zo` 映射为 `za`，保留 VSCodeVim 的折叠切换处理；`zF` 等价于 `zf_`，避免 VSCodeVim 将 `zff` 误当作重复操作符而吃掉 `f{char}` motion。SV 关键字 `zf%` 需要同级 `local.vim-sv-match` 0.1.2；括号 `%` 使用原生匹配。

## 安装

这是独立 Git 仓库，可单独上传 GitHub。构建仅依赖 Bash、Python 3 标准库；逻辑模块使用 Node 18+。安装位置为实际运行 VS Code 窗口的 UI 端，当前部署目标为 Windows Code 1.145.2 + WSL Ubuntu 26.04。

```sh
bash package.sh
code --install-extension dist/local.gvim-marker-folds-0.2.0.vsix --force
```

Windows 上建议用 Windows Code CLI 安装。WSL 的 `code` 默认可能转交远程端，不要据此误判 UI 扩展安装位置。`package.json` 声明 `extensionKind: ["ui"]`。

`config/settings.json` 和 `config/keybindings.json` 是本功能配置片段，必须按键/映射合并，不能整份覆盖已有配置。完整键位与保留 JSONC 注释的合并、备份、回滚工具见同级独立仓库 `vscode-custom-keybindings`。安装后由用户在合适时机 Reload Window；本脚本不会重启编辑器。

## 测试

```sh
node --test test/*.test.js
bash test/run-integration.sh
```

本地回归使用 `codex-desktop run` 在独立桌面 `:97` 启动隔离的 Linux Code、用户配置、扩展目录和工作区。`ct_lsu_pfu.v` 只读入测试副本；原文件不改。路径可用 `MARKER_FOLDS_TEST_SOURCE` 指定，`MARKER_FOLDS_TEST_FILTER` 可筛选用例。Linux Code 和 VSCodeVim 路径可通过 `EDITOR_TOOLS_TEST_CODE` / `EDITOR_TOOLS_TEST_VIM` 指定。

2026-11-17：13 项逻辑检查通过，包含调用本机 Vim 9.1 对照 numbered / unnumbered marker 的层级；35 项真实 VS Code 折叠检查通过，包含实际 RTL 副本、正反向 `%`、取消、次数、文本对象、Visual、嵌套、EOF、撤销重做、保存重开与分屏独立状态。另在同级 `vscode-custom-keybindings` 运行 21 项联合回归通过。

2026-11-16 的联合结果：SV、Visual、分屏搜索、颜色标记次数/固定坐标、marker 一次撤销、Enter、快速分屏、Leader 共存、局部编辑区/终端限制均通过 Linux Code 1.145.2 集成检查。**这不等于 Windows 拼音和真实 Codex 提交已验收。** 原始结果在联合仓库的 `test-results/`，该目录不加入 Git。

## 停用与卸载

```sh
code --uninstall-extension local.gvim-marker-folds
```

在统一键位仓库执行受保护回滚，或仅删本仓库 config 中对应的键/映射。若安装后用户继续编辑了配置，回滚器拒绝覆盖后续修改，应根据备份合并恢复。

## 兼容范围和限制

必须合并 config/settings.json 并设置默认 provider，支持 VSCodeVim 1.32.4。没有 marker 不生成语法折叠。VS Code 折叠占位符和 gVim 的 `foldtext` 外观有区别；单行 marker 会写入但不隐藏。VS Code 无法分别显示开始于同一行的多层折叠。

保留语言合法注释，JSON 等无注释格式的语言拒绝创建。`zd` 删除 marker 时保留解释文字。隐式结束/共用编号标记的单层删除继续拒绝，避免误删别层。常用成对 marker 的行为已对照；未实现 Vim Ex `:fold` / `:foldopen` / `:folddo*` 等命令。

行数根据真实可见缺口与本插件命令观察到的闭合状态显示，包含 EOF；仅凭视口末行不猜测折叠。完全由鼠标在 EOF 收起、尚无已知闭合状态时可能不显示行数，折叠本身仍正常。

备份、测试日志、运行副本、VSIX、编译产物不纳入 Git。没有复制浏览器/Codex 凭据。源码按 MIT 许可提供。
