import { parseProjectActionsConfig, type ProjectActionsConfig } from "@zcode/shared";
import { PlayIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/components/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useIsOfficeMode } from "@/hooks/useInterfaceMode.js";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { getErrorKindForLog } from "@/lib/errorMessage.js";
import { readWorkspaceConfigFile } from "@/lib/workspaceConfigFile.js";
import { logger } from "@/logger.js";
import { WINDOWS_CAPTION_CONTROL_CLASS } from "@/windowCaptionControls.js";

type ActionsState =
  | { status: "loading" }
  | { status: "ready"; config: ProjectActionsConfig }
  | { status: "unreadable" };

/**
 * 标题栏“运行操作”菜单：每次打开时读取 `<workspace>/.zcode/config.json` 的 actions，点击才运行。
 * 规范：docs/specs/project-actions.md
 */
export function WorkspaceProjectActionsMenu({
  workspaceAbsPath,
  workspaceIdentity,
  remoteSessionId,
  remoteTarget,
  disabledReason,
  onRunAction,
  useWindowsCaptionSpacing = false,
}: {
  workspaceAbsPath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  remoteTarget?: unknown;
  disabledReason?: string;
  onRunAction: (action: { name: string; command: string }) => void;
  useWindowsCaptionSpacing?: boolean;
}) {
  const { intl } = useZCodeIntl();
  const isOfficeMode = useIsOfficeMode();
  const { fileService } = useWorkspaceServices(
    workspaceAbsPath,
    remoteSessionId,
    workspaceIdentity,
    remoteTarget,
  );
  const [state, setState] = useState<ActionsState>({ status: "loading" });
  const requestIdRef = useRef(0);
  const openRef = useRef(false);
  const label = intl.formatMessage({ id: "projectActions.trigger" });

  const loadActions = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setState({ status: "loading" });
    let next: ActionsState;
    try {
      const file = await readWorkspaceConfigFile(fileService, workspaceAbsPath);
      next =
        file.status === "too-large"
          ? { status: "ready", config: { actions: [], error: "too-large" } }
          : { status: "ready", config: parseProjectActionsConfig(file.content) };
    } catch (error) {
      logger.warn("[ProjectActions] 读取 .zcode/config.json 失败", {
        errorKind: getErrorKindForLog(error),
      });
      next = { status: "unreadable" };
    }
    // 连续快速打开时只采用最后一次读取的结果。
    if (requestId === requestIdRef.current) {
      setState(next);
    }
  }, [fileService, workspaceAbsPath, workspaceIdentity, remoteSessionId]);

  // 修复原因：切换 workspace 时该组件保持挂载，请求编号不变；旧 workspace 较慢的读取在切换后完成仍会被采用，
  // 菜单开着时点选会在新 workspace 中执行旧 workspace 仓库里定义的命令。
  // 修复依据：workspace 变化（loadActions 随之重建）时作废进行中的读取并回到 loading；菜单开着就按新 workspace 重新读取。
  useEffect(() => {
    requestIdRef.current += 1;
    setState({ status: "loading" });
    if (openRef.current) void loadActions();
  }, [loadActions]);

  if (isOfficeMode) return null;

  const hint = (id: string) => (
    <p className="px-2 py-1.5 text-ui-sm text-foreground-subtle">{intl.formatMessage({ id })}</p>
  );
  const actions = state.status === "ready" ? state.config.actions : [];

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        openRef.current = open;
        if (open) void loadActions();
      }}
    >
      <ControlHintTooltip title={disabledReason ?? label} side="bottom">
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-md"
            className={cn(
              "text-foreground hover:bg-hover hover:text-foreground [app-region:no-drag]",
              useWindowsCaptionSpacing && WINDOWS_CAPTION_CONTROL_CLASS,
            )}
            aria-label={label}
            disabled={Boolean(disabledReason)}
            data-project-actions-trigger
          >
            <PlayIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
      </ControlHintTooltip>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>{intl.formatMessage({ id: "projectActions.title" })}</DropdownMenuLabel>
        {state.status === "loading" ? hint("projectActions.loading") : null}
        {state.status === "ready" && state.config.error === "too-large"
          ? hint("projectActions.tooLarge")
          : null}
        {state.status === "unreadable" ||
        (state.status === "ready" &&
          state.config.error !== undefined &&
          state.config.error !== "too-large")
          ? hint("projectActions.invalid")
          : null}
        {state.status === "ready" && !state.config.error && actions.length === 0
          ? hint("projectActions.empty")
          : null}
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.id}
            className="flex-col items-start gap-0.5"
            onSelect={() => onRunAction({ name: action.name, command: action.command })}
          >
            <span className="text-ui-base text-foreground">{action.name}</span>
            {/* 修复原因：截断显示会让仓库配置把后续命令藏在长空白之后；完整展示即将执行的命令（菜单整体可滚动）。 */}
            <span className="w-full font-mono text-ui-sm break-all whitespace-pre-wrap text-foreground-subtle">
              {action.command}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
