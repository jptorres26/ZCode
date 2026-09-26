import { useCallback, useState } from "react";
import type { GitCreateWorktreeResult } from "@zcode/shared";
import { toast } from "@/components/ui/toast.js";
import {
  getPrimaryGitBranchIssue,
  resolveGitBranchIssueMessageId,
} from "@/git-branch-switcher/display.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { getErrorMessage } from "@/lib/errorMessage.js";
import { logger } from "@/logger.js";

type CreatedWorktree = Extract<GitCreateWorktreeResult, { ok: true }>;

/** 新建 worktree；失败以 toast 提示并返回 null。规范：docs/specs/git-worktree-task.md */
export function useGitWorktreeCreate(workspacePath: string) {
  const { gitService } = useServices();
  const { intl } = useZCodeIntl();
  const [pending, setPending] = useState(false);

  const create = useCallback(
    async (branchName: string): Promise<CreatedWorktree | null> => {
      setPending(true);
      try {
        const result = await gitService.createWorktree({ workspacePath, branchName });
        if (result.ok) {
          return result;
        }
        const issue = getPrimaryGitBranchIssue(result.issues);
        const messageId = resolveGitBranchIssueMessageId(issue);
        toast(
          messageId
            ? intl.formatMessage({ id: messageId }, { branchName: result.branchName ?? "" })
            : intl.formatMessage(
                { id: "git.worktree.error.createFailed" },
                { error: issue?.detail?.trim() || issue?.message || "" },
              ),
        );
        return null;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        logger.warn("[GitWorktree] 创建 worktree 失败", {
          workspacePath,
          branchName,
          error: message,
        });
        toast(intl.formatMessage({ id: "git.worktree.error.createFailed" }, { error: message }));
        return null;
      } finally {
        setPending(false);
      }
    },
    [gitService, intl, workspacePath],
  );

  return { pending, create };
}
