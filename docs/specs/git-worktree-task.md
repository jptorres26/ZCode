# 在新 Git worktree 中开始任务

> 英文版：[git-worktree-task.en.md](git-worktree-task.en.md)。本文件为规范来源，两者保持同步。

## 背景

Codex desktop 可以让任务在独立的 worktree 中运行，互不干扰当前检出。ZCode 只有“新建分支并切换”（在当前检出上
切换），没有创建 worktree 的入口；Agent 只能自己通过 bash 调用 `git worktree`。本规范复用既有的分支对话框、
workspace 打开与草稿转移，只新增一个 Git 服务方法。

## 接口与状态所有者

- worktree 的事实来源是 Git 本身；ZCode 不另存 worktree 列表。
- `IGitService.createWorktree({ workspacePath, branchName }): Promise<GitCreateWorktreeResult>`，
  由 `createGitService` → `GitCliRepo.createWorktree`（实现位于 `git/repo/gitWorktree.ts`）完成：
  - 成功：`{ ok: true, branchName, worktreePath, workspacePath }`；失败：`{ ok: false, branchName, issues }`，
    `issues` 复用 `GitBranchMutationIssue`（非法分支名、分支已存在、未知错误）。
- 新 workspace 只是一个新路径：身份 key 仍为 `workspaceIdentity?.trim() || workspacePath`，不新增协议字段。

## 服务规则

1. 仓库不可用时报错；分支名非法或已存在时返回对应 issue，不创建 worktree。worktree 从 HEAD 新建、不触碰当前检出，
   因此当前检出中的冲突或进行中的 merge/rebase 不构成阻塞。
2. worktree 根目录：`<ZCode 数据目录>/worktrees/<仓库目录名>-<仓库根路径 sha256 前 8 位>/<分支名 slug>`，
   slug 把 `[A-Za-z0-9._-]` 以外的字符替换为 `-`；目录已存在时依次追加 `-2`、`-3`…（最多 99）。
   放在仓库外，避免出现在原仓库的文件树与 `git status` 中。
3. 执行 `git worktree add -b <branch> <path> HEAD`：新分支从当前 HEAD 创建。**未提交的改动不会带入新 worktree**。
4. 若原 workspace 是仓库的子目录，返回的 `workspacePath` 为新 worktree 中对应的同一子目录。
5. 失败时解析 git 输出为 issue；成功后使原 workspace 的缓存失效。

## 交互

- 仅本地 workspace 的草稿输入框分支切换器底部显示“在新 worktree 中开始…”（远程 workspace 需要远程身份构造，
  本期不提供）。
- 复用“新建分支”对话框（`mode="worktree"` 切换文案），说明新 worktree 基于当前提交、不包含未提交改动。
- 成功后：`requestV4ComposerDraftWorkspaceTransfer` 把当前草稿转移到新路径，再
  `handleStartDraftInWorkspace(新路径, undefined, "project")` 打开它并进入草稿；失败时对话框保持打开并以 toast
  显示第一条 issue。
- 文案 `git.worktree.*`，`en-US` 与 `zh-CN` 同步提供。

## 不在本期

- 删除 / 清理 worktree、在 worktree 与本地检出之间移交改动、创建后自动运行 setup 脚本（可接入项目操作）。

## 验收

- `packages/services/test/gitWorktree.test.ts`（真实临时仓库）：创建成功且检出新分支、子目录 workspace 映射、
  重名目录追加后缀、已存在分支与非法分支名返回 issue 且不创建目录、未提交改动不带入。
- Web 开发服务 + Playwright：在草稿分支菜单中选择“在新 worktree 中开始…”，输入分支名后打开新 workspace，
  草稿文本随之转移，`git worktree list` 显示新条目。
