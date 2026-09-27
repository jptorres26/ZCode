# Review 面板文件级 Git 操作（暂存 / 取消暂存 / 丢弃）

> 英文版：[git-review-pane-file-actions.en.md](git-review-pane-file-actions.en.md)。本文件为规范来源，两者保持同步。

## 背景与目标

Review 面板（`packages/ui/src/GitPane.tsx`）目前只能查看变更。`IGitService` 已提供
`stagePaths` / `unstagePaths` / `discardPaths`，但 UI 只接了占位 toast（`useGitActions`）。
本规范让用户在 Review 面板内按文件或批量完成暂存、取消暂存和丢弃，与 Codex desktop 的
review 面板能力对齐，同时修正服务端在重命名、未跟踪文件、冲突文件和无提交仓库上的错误行为。

## 状态所有者与单一路径

- Git 仓库状态的唯一所有者是真实的 index / worktree。UI 不保存乐观的“已暂存”副本。
- 写入路径唯一：`GitPane` → `useServices().gitService.{stagePaths,unstagePaths,discardPaths}`
  → `createGitService` → `GitCliRepo.{stage,unstage,discard}`。不新增 RPC、不新增 IPC。
- 读取路径不变：变更完成（成功或失败）后调用既有 `onRefresh`，由 `useGitRepository`
  的 `refreshToken` 重新拉取一次 `gitService.refresh` 快照。
- 远程 workspace 复用面板所在 `ServiceProvider` 的 `gitService`，与 `GitActionMenu`
  的提交/推送路径一致；`useGitRepository` 判定 workspace RPC 不可用时面板不渲染操作。

```text
用户点击 ──> GitPane(单个 in-flight 锁) ──> [丢弃: 确认弹框] ──> gitService.xxxPaths
                                                                │
                      toast(失败) <── catch ─────────────────────┤
                                                                ▼
                                          finally: 释放锁 → onRefresh() → useGitRepository 重拉
```

事件顺序约束：同一面板同时最多一个变更请求；请求结束后才触发刷新，刷新结果以
`gitState.revision` 为准，旧的 diff 缓存随 revision 清空（既有逻辑）。

## 可用操作矩阵

| 来源 (source) | 分区 (section) | 行内操作                       | 批量操作（面板头部）         |
| ------------- | -------------- | ------------------------------ | ---------------------------- |
| `unstaged`    | `unstaged`     | 暂存、丢弃（恢复工作区）       | 全部暂存、全部丢弃           |
| `unstaged`    | `untracked`    | 暂存、丢弃（删除未跟踪文件）   | 同上                         |
| `unstaged`    | `conflicted`   | 暂存（标记已解决）；不提供丢弃 | 全部暂存；全部丢弃跳过冲突项 |
| `staged`      | `staged`       | 取消暂存、丢弃（恢复到 HEAD）  | 全部取消暂存、全部丢弃       |
| `branch`      | `branch`       | 无（只读对比）                 | 无                           |
| `last-turn`   | `last-turn`    | 无（只读）                     | 无                           |

仓库加载中、出错、Git 不可用或不是仓库时，不渲染任何操作。数据集 `readonly === true`
时不渲染任何操作。

## 服务端语义（`GitCliRepo`）

- `stage(paths)`：`git add -- <paths>`（不变）。
- 路径分类：先执行 `git status --porcelain=v2 -z --untracked-files=normal -- <paths>`
  （完全未跟踪的大目录只返回一条 `dir/`，避免输出超限）。按路径裁剪的 status 无法识别重命名，
  需要重命名原路径时另读不裁剪的 `git diff --cached --name-status -z -M --diff-filter=R`。
  状态里不存在的路径（已干净、被忽略或已删除）没有可操作的变更，直接跳过，保证重复请求幂等。
- 输入路径只解析父目录的真实路径（兼容工作区路径中的符号链接），最后一段保持字面：变更本身是符号链接时，
  暂存与丢弃作用于链接本身，绝不作用于链接目标（否则丢弃一个指向目录的未跟踪链接会清空目标目录）。
- `unstage(paths)`：
  - 已暂存的重命名要把原路径一并传给 `git restore --staged`，否则原路径的删除仍留在暂存区。
  - 仓库尚无提交（HEAD 不存在）时改用 `git rm --cached -r -q -- <paths>`，保留工作区文件。
- `discard(paths, staged)`：
  - 冲突路径直接报错 `Cannot discard paths with unresolved conflicts.`，不做部分执行。
  - 未跟踪路径用 `git clean -f -q -- <paths>` 删除；不使用 `-x`，被忽略的文件不受影响。只用一个 `-f`：嵌套的 Git 仓库
    不会被删除（其中可能有未推送的提交，确认文案也没有说明会删除仓库），而 git 仍以 0 退出；因此清理后重新读取这些
    路径的状态，仍有未跟踪内容时报错并列出这些路径，界面按失败提示。
  - 已跟踪路径：`staged=false` 用 `git restore --worktree`；`staged=true` 用
    `git restore --source=HEAD --staged --worktree`，重命名同时恢复原路径。
  - 已暂存删除（`D.`）而同一路径上又有重新创建的未跟踪文件或目录时：`staged=true` 拒绝整个丢弃并列出这些路径
    （恢复 HEAD 版本会静默覆盖重新创建的内容），由用户先移走或删除它；`staged=false` 跳过只匹配到已暂存删除的路径
    （index 中没有该路径，工作区一侧没有可恢复的内容），只删除重新创建的未跟踪内容，保留已暂存的删除。
  - 仓库尚无提交且 `staged=true` 时用 `git rm -f -r -q -- <paths>`（新文件从 index 与工作区删除）。
- 所有分支在执行后调用既有 `invalidate(workspacePath)`。

## 交互与视觉

- 每个文件行右侧显示图标按钮（`Button size="icon-sm" variant="ghost"`，带
  `aria-label` 与 `ControlHintTooltip`）：指针设备在行 hover / 键盘聚焦时显示，
  触屏（`hover: none`）常显，满足手机 Web 不隐藏核心操作的要求。
- 行的右键菜单同步提供相同操作，与按钮复用同一可用性判断。
- 右键菜单第一项为“打开文件”：经侧栏既有的 `onOpenCodeViewer` 以
  `{ type: "file", title: 文件名, path: 绝对路径 }` 在应用内文件预览中打开当前工作区版本；
  已删除的文件、工作区中已不存在的文件（如 `MD`：index 中已修改、工作区中已删除，kind 按 index 一侧为 modified；
  分支对比中本地已删除的文件；服务端标出 `isMissingInWorkingTree`）、折叠显示的未跟踪目录（`dir/`）与子模块（工作区中是目录；服务端按 porcelain v2 的工作区模式 `<mW>`、
  分支对比按 `diff --raw` 新一侧的模式为 160000 标出 `isSubmodule`，子模块被换成普通文件后仍可预览）都没有可预览的文件，禁用该项；宿主未提供 `onOpenCodeViewer` 时不显示。它是只读操作，所有来源都可用。
- 面板头部在刷新按钮左侧提供批量操作（`size="lg" variant="ghost"`）。
  头部放不下来源选择器与操作组时，操作组整体换到下一行并右对齐，不得与来源选择器重叠（手机 Web 侧栏约 200px 宽）。
- 任何丢弃（单个或批量）都先弹出确认框（`confirmVariant="destructive"`），文案写明
  文件数量、不可撤销；会把文件从磁盘删除时（未跟踪文件，或 staged 来源中新增的文件）
  额外写明删除数量。status 输出超限后改为折叠模式时，整个未跟踪目录只显示为一条 `dir/`，而丢弃会递归删除
  目录内全部文件：这类条目按“目录”单独计数，文案写明“N 个未跟踪目录（连同目录内全部内容）”，不按一个文件计。
- 请求进行中所有操作按钮禁用；失败时 toast 显示服务端错误信息，并以
  `logger.warn` 记录（不记录文件内容）。
- 文案使用 `git.fileAction.*` i18n key，`en-US` 与 `zh-CN` 同步提供。

## 验收场景

1. 在 `unstaged` 来源点击某文件“暂存”，刷新后该文件出现在 `staged` 来源。
2. 在 `staged` 来源对一个已暂存的重命名点击“取消暂存”，原文件不再显示为已暂存删除。
3. 对未跟踪文件点击“丢弃”并确认，文件被删除；取消确认则不发生任何写入。
4. 对已暂存的重命名点击“丢弃”并确认，工作区恢复原文件且新路径消失。
5. 冲突文件不显示“丢弃”；服务端收到冲突路径的丢弃请求时报错且不修改任何文件。
6. 无提交仓库中“取消暂存”保留工作区文件。
7. `branch` / `last-turn` 来源不显示暂存、取消暂存或丢弃操作。
8. 右键某文件选择“打开文件”，侧栏新增该文件的预览标签；已删除文件的该项为禁用。

自动化覆盖：`packages/services/test/gitPathMutations.test.ts`（真实临时仓库覆盖 2–6）、
`packages/ui/test/gitPaneFileActions.test.ts`（操作矩阵与批量路径选择）。
场景 1/3 的界面交互通过 Web 开发服务 + Playwright 手动验证，结果记录在 PR 描述中。
