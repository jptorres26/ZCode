# 推送后创建拉取请求（Pull / Merge Request）链接

> 英文版：[git-pull-request-link.en.md](git-pull-request-link.en.md)。本文件为规范来源，两者保持同步。

## 背景

Codex desktop 在推送后可以直接发起 PR。ZCode 只有提交与推送，没有 PR 入口。
本规范在推送成功后提供“创建拉取请求”，在托管平台的网页上打开预填好分支的新建 PR 页面。
不调用任何托管平台 API、不需要令牌，也不在客户端保存凭据。

## 状态所有者与接口

- 推送目标的唯一依据是刚完成的推送本身：`GitCliRepo.push` 以 `git push --porcelain` 执行，成功后从其输出计算链接，
  随推送结果返回 `GitPushResult.pullRequestLink: GitPullRequestLink | null`；远程 workspace 经既有通用代理转发。
  不另设查询方法，也不在服务端重新实现 git 的推送规则（`pushRemote`、`pushDefault`、`push.default`、
  `remote.<name>.push` refspec、`pushurl`、`pushInsteadOf` 等）：以前按配置推算推送目标，每漏掉一条规则，
  链接就指向不存在的分支或错误的仓库。
- `GitPullRequestLink`：`{ provider: "github" | "gitlab" | "bitbucket"; url; headBranch; baseBranch | null }`。
- URL 构造是 `@zcode/shared` 中的纯函数 `buildGitPullRequestLink`，便于单测。

## 解析规则

1. 只有 HEAD 在分支上（非 detached）时才能推送，因此总有当前分支名。
2. 源分支：porcelain 输出中每条引用一行 `<flag>\t<from>:<to>\t<summary>`。取 `from` 为 `refs/heads/<当前分支>`
   （或来自推送 refspec 的 `HEAD`）、`to` 以 `refs/heads/` 开头、且未被拒绝（`!`）或删除（`-`）的第一行，去掉
   `refs/heads/` 前缀；没有这样的行（当前分支没有被推送，如 `remote.<name>.push` 不包含它）时返回 `null`。
   链接指向推送到的仓库，托管平台在其页面上选择目标仓库。
3. 远程地址：该行所在段落的 `To <url>`，即 git 实际推送到的地址（已应用 `pushurl`、`insteadOf` / `pushInsteadOf`，
   git 已去掉其中的用户信息）。支持 `https://`、`http://`、`ssh://`、
   `git://` 与 scp 形式 `user@host:owner/repo.git`。网页地址一律去掉用户名、密码与令牌；
   ssh / git / scp 形式转为 `https://host/...` 并丢弃 ssh 端口；这些形式的主机可能是 ssh 别名：
   `github.com-work` 这类“已知平台主机-后缀”还原为规范主机，不含点的裸别名无法推断网页主机，返回 `null`；http(s) 保留原端口与协议。
   路径至少两段、不含空段或 `..`，去掉末尾 `.git` 与 `/`。主机名只接受 `[A-Za-z0-9.-]`。
4. 平台：主机为 `github.com` 或包含 `github` → GitHub；`gitlab.com` 或包含 `gitlab` → GitLab；
   `bitbucket.org` → Bitbucket；其它返回 `null`（不猜测未知平台的 URL 格式）。
5. 目标分支：推送所用远程的 `git symbolic-ref --quiet --short refs/remotes/<remote>/HEAD` 去掉远程前缀；远程为
   `--set-upstream <remote>` 中的远程，不带参数的推送则为 git 按当前分支解析的推送远程
   （`git for-each-ref --format=%(push:remotename) refs/heads/<branch>`）。该远程的 fetch 地址（`git remote get-url <remote>`）
   与推送到的地址必须是同一个仓库（主机与路径相同，不区分大小写）才取：配置了 `pushurl`（从上游拉取、推送到 fork）时
   remote HEAD 是上游的默认分支，fork 中可能没有它。取不到或不是同一个仓库时为 `null`，由平台使用推送到的仓库的默认分支。源分支与目标分支相同时返回 `null`。
6. URL：
   - GitHub：`/<path>/compare/<base>...<head>?expand=1`（无 base 时 `/compare/<head>?expand=1`）；
   - GitLab：`/<path>/-/merge_requests/new?merge_request[source_branch]=<head>[&merge_request[target_branch]=<base>]`；
   - Bitbucket：`/<path>/pull-requests/new?source=<head>[&dest=<base>]`。
7. 分支名按 URL 组件编码，GitHub 路径中保留 `/`。

## 交互

- 推送成功（推送弹窗或“提交并推送”）后，UI 使用推送结果中的链接；存在时成功 toast 带“创建拉取请求”
  （GitLab 为“创建合并请求”）操作并延长显示时间，点击经 `IPlatformService.openExternal` 打开。
- 链接计算失败时为 `null`，不影响推送结果与提示。
- 文案 `git.actionMenu.pullRequest.*`，`en-US` 与 `zh-CN` 同步提供。

## 验收

- `packages/ui/test/gitPullRequestLink.test.ts`：各类远程地址、凭据剥离、未知平台、同名分支、编码。
- `packages/services/test/gitPullRequestLink.test.ts`：porcelain 输出解析；真实临时仓库经 `core.sshCommand`
  把 GitHub 的 ssh 地址转到本地裸仓库后推送，覆盖首次推送（`--set-upstream`）、fork（`pushDefault` / `pushRemote`）、
  `pushurl`、`push.default`、`remote.<name>.push`（含 `HEAD:<分支>`）与当前分支未被推送的情况。
- Web 开发服务 + Playwright：同样转到本地裸仓库推送后，toast 出现操作并打开正确 URL。
