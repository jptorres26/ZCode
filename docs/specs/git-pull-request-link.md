# 推送后创建拉取请求（Pull / Merge Request）链接

> 英文版：[git-pull-request-link.en.md](git-pull-request-link.en.md)。本文件为规范来源，两者保持同步。

## 背景

Codex desktop 在推送后可以直接发起 PR。ZCode 只有提交与推送，没有 PR 入口。
本规范在推送成功后提供“创建拉取请求”，在托管平台的网页上打开预填好分支的新建 PR 页面。
不调用任何托管平台 API、不需要令牌，也不在客户端保存凭据。

## 状态所有者与接口

- Git 远程信息的所有者是仓库配置；新增只读方法
  `IGitService.getPullRequestLink({ workspacePath }): Promise<GitPullRequestLink | null>`，
  由 `createGitService` → `GitCliRepo.getPullRequestLink` 实现，远程 workspace 经既有通用代理转发。
- `GitPullRequestLink`：`{ provider: "github" | "gitlab" | "bitbucket"; url; headBranch; baseBranch | null }`。
- URL 构造是 `@zcode/shared` 中的纯函数 `buildGitPullRequestLink`，便于单测。

## 解析规则

1. 仅当 HEAD 在分支上（非 detached）时计算。
2. 上游：`branch.<name>.remote` 与 `branch.<name>.merge`（去掉 `refs/heads/` 前缀）得到远程名和远端分支名；
   没有上游返回 `null`。
3. 远程地址：`git remote get-url <remote>`（已应用 `insteadOf`）。支持 `https://`、`http://`、`ssh://`、
   `git://` 与 scp 形式 `user@host:owner/repo.git`。网页地址一律去掉用户名、密码与令牌；
   ssh / git / scp 形式转为 `https://host/...` 并丢弃 ssh 端口；http(s) 保留原端口与协议。
   路径至少两段、不含空段或 `..`，去掉末尾 `.git` 与 `/`。主机名只接受 `[A-Za-z0-9.-]`。
4. 平台：主机为 `github.com` 或包含 `github` → GitHub；`gitlab.com` 或包含 `gitlab` → GitLab；
   `bitbucket.org` → Bitbucket；其它返回 `null`（不猜测未知平台的 URL 格式）。
5. 目标分支：`git symbolic-ref --quiet --short refs/remotes/<remote>/HEAD` 去掉远程前缀；
   取不到时为 `null`，由平台使用默认分支。源分支与目标分支相同时返回 `null`。
6. URL：
   - GitHub：`/<path>/compare/<base>...<head>?expand=1`（无 base 时 `/compare/<head>?expand=1`）；
   - GitLab：`/<path>/-/merge_requests/new?merge_request[source_branch]=<head>[&merge_request[target_branch]=<base>]`；
   - Bitbucket：`/<path>/pull-requests/new?source=<head>[&dest=<base>]`。
7. 分支名按 URL 组件编码，GitHub 路径中保留 `/`。

## 交互

- 推送成功（推送弹窗或“提交并推送”）后，UI 查询一次链接；存在时成功 toast 带“创建拉取请求”
  （GitLab 为“创建合并请求”）操作并延长显示时间，点击经 `IPlatformService.openExternal` 打开。
- 查询失败只记日志，不影响推送结果提示。
- 文案 `git.actionMenu.pullRequest.*`，`en-US` 与 `zh-CN` 同步提供。

## 验收

- `packages/ui/test/gitPullRequestLink.test.ts`：各类远程地址、凭据剥离、未知平台、同名分支、编码。
- `packages/services/test/gitPullRequestLink.test.ts`：真实临时仓库中的上游、默认分支与无上游场景。
- Web 开发服务 + Playwright：推送到本地裸仓库（`pushurl`）且 fetch 地址为 GitHub 时，toast 出现操作并打开正确 URL。
